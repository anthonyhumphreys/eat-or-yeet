import type { D1DatabaseSession } from "@cloudflare/workers-types";
import schema from "./schema";
import { browseContent, browseStatements } from "./lib/browse_projection";
import type { Doc, RecordValue, TableNames } from "./model";
import type { Id } from "./values";

export type SqlDatabase = Pick<D1DatabaseSession, "prepare" | "batch">;
type StoredRow = { id: string; table_name: TableNames; payload: string; created_at: number };
type Predicate = { field: string; operator: "=" | "<" | "<=" | ">" | ">="; value: string | number | boolean | undefined };
type PendingJob = { id: string; operation: string; args: unknown; due: number };

function fieldSql(field: string) {
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(field)) throw new Error("Invalid indexed field");
  return `json_extract(payload, '$.${field}')`;
}
function decode<T extends TableNames>(row: StoredRow): Doc<T> {
  const value: unknown = JSON.parse(row.payload);
  const parsed = schema[row.table_name].validator.parse(value) as RecordValue<T>;
  return { ...parsed, _id: row.id as Id<T>, _creationTime: row.created_at };
}
function scalar(value: string | number | boolean | undefined) { return typeof value === "boolean" ? Number(value) : value; }

class IndexRange<T extends TableNames> {
  readonly predicates: Predicate[] = [];
  private compare(field: keyof RecordValue<T> & string, operator: Predicate["operator"], value: string | number | boolean | undefined) {
    this.predicates.push({ field, operator, value });
    return this;
  }
  eq(field: keyof RecordValue<T> & string, value: string | number | boolean | undefined) { return this.compare(field, "=", value); }
  lt(field: keyof RecordValue<T> & string, value: string | number) { return this.compare(field, "<", value); }
  lte(field: keyof RecordValue<T> & string, value: string | number) { return this.compare(field, "<=", value); }
  gt(field: keyof RecordValue<T> & string, value: string | number) { return this.compare(field, ">", value); }
  gte(field: keyof RecordValue<T> & string, value: string | number) { return this.compare(field, ">=", value); }
}

// JSON records preserve imported identifiers and optional fields. All query
// predicates use declared SQLite expression indexes, not table scans in JS.
export class Database {
  readonly changes = new Map<string, StoredRow | null>();
  readonly jobs: PendingJob[] = [];
  private readonly prefetchedIds = new Map<string, StoredRow | null>();
  readonly prefetchedIndexes = new Map<string, StoredRow[]>();
  constructor(readonly sql: SqlDatabase, private readonly writable = false) {}
  async preloadIds(ids: string[]) {
    const unique = [...new Set(ids)];
    if (!unique.length) return;
    if (unique.length > 100) throw new Error("Too many records to preload");
    const rows = await this.sql.prepare(`SELECT id, table_name, payload, created_at FROM records WHERE id IN (${unique.map(() => "?").join(",")})`).bind(...unique).all<StoredRow>();
    unique.forEach(id => this.prefetchedIds.set(id, null));
    rows.results.forEach(row => this.prefetchedIds.set(row.id, row));
  }
  async preloadIndex<T extends TableNames>(table: T, index: string, keys: Partial<RecordValue<T>>[]) {
    const fields = schema[table].indexes[index];
    if (!fields || keys.some(key => Object.keys(key).length !== fields.length || fields.some(field => !(field in key)))) throw new Error("Preload requires a complete declared index");
    if (!keys.length) return;
    if (keys.length * fields.length > 100) throw new Error("Too many indexed records to preload");
    const values = keys.map(key => fields.map(field => key[field as keyof RecordValue<T>]));
    if (values.flat().some(value => !["string", "number", "boolean"].includes(typeof value))) throw new Error("Preloaded index keys must be scalar");
    const clause = fields.map(field => `${fieldSql(field)} = ?`).join(" AND ");
    const rows = await this.sql.prepare(`SELECT id, table_name, payload, created_at FROM records WHERE table_name='${table}' AND (${keys.map(() => `(${clause})`).join(" OR ")})`).bind(...values.flat().map(value => scalar(value as string | number | boolean))).all<StoredRow>();
    for (const key of values) this.prefetchedIndexes.set(JSON.stringify([table, fields, key]), []);
    for (const row of rows.results) {
      const doc = decode(row);
      const key = JSON.stringify([table, fields, fields.map(field => doc[field as keyof typeof doc])]);
      this.prefetchedIndexes.get(key)?.push(row);
      this.prefetchedIds.set(row.id, row);
    }
  }
  query<T extends TableNames>(table: T) { return new IndexedQuery(this, table); }
  async get<T extends TableNames>(id: Id<T>): Promise<Doc<T> | null>;
  async get<T extends TableNames>(table: T, id: Id<T>): Promise<Doc<T> | null>;
  async get<T extends TableNames>(tableOrId: T | Id<T>, suppliedId?: Id<T>): Promise<Doc<T> | null> {
    const id = suppliedId ?? tableOrId as Id<T>;
    const expected = suppliedId ? tableOrId : undefined;
    if (this.changes.has(id)) {
      const row = this.changes.get(id);
      return row && (!expected || row.table_name === expected) ? decode<T>(row) : null;
    }
    const row = this.prefetchedIds.has(id) ? this.prefetchedIds.get(id) : await this.sql.prepare("SELECT id, table_name, payload, created_at FROM records WHERE id = ?").bind(id).first<StoredRow>();
    return row && (!expected || row.table_name === expected) ? decode<T>(row) : null;
  }
  private writeAllowed() { if (!this.writable) throw new Error("Queries cannot modify backend state"); }
  async insert<T extends TableNames>(table: T, value: RecordValue<T>): Promise<Id<T>> {
    this.writeAllowed();
    const id = `${table}:${crypto.randomUUID()}` as Id<T>;
    this.changes.set(id, { id, table_name: table, payload: JSON.stringify(schema[table].validator.parse(value)), created_at: Date.now() });
    return id;
  }
  async restoreRows(table: TableNames, rows: Array<{ id: string; createdAt: number; value: unknown }>) {
    this.writeAllowed();
    if (!rows.length) return;
    if (new Set(rows.map((row) => row.id)).size !== rows.length) throw new Error("Duplicate imported identifier");
    const existing = await this.sql.prepare(`SELECT id, table_name FROM records WHERE id IN (${rows.map(() => "?").join(",")})`).bind(...rows.map((row) => row.id)).all<{ id: string; table_name: TableNames }>();
    if (existing.results.some((row) => row.table_name !== table)) throw new Error("Imported identifier belongs to another table");
    for (const { id, createdAt, value } of rows) {
      this.changes.set(id, { id, table_name: table, created_at: createdAt, payload: JSON.stringify(schema[table].validator.parse(value)) });
    }
  }
  async patch<T extends TableNames>(id: Id<T>, patch: Partial<RecordValue<T>>) {
    this.writeAllowed();
    const current = await this.get(id);
    if (!current) throw new Error("Record not found");
    const { _id, _creationTime, ...value } = current;
    const body: Record<string, unknown> = { ...value, ...patch };
    for (const [key, item] of Object.entries(body)) if (item === undefined) delete body[key];
    const saved = this.changes.get(id) ?? await this.sql.prepare("SELECT table_name FROM records WHERE id = ?").bind(id).first<{ table_name: T }>();
    if (!saved) throw new Error("Record not found");
    this.changes.set(id, { id: _id, table_name: saved.table_name, payload: JSON.stringify(schema[saved.table_name].validator.parse(body)), created_at: _creationTime });
  }
  async delete(id: Id<TableNames>) { this.writeAllowed(); this.changes.set(id, null); }
  schedule(operation: string, args: unknown, delay: number) {
    this.writeAllowed();
    if (!Number.isFinite(delay) || delay < 0) throw new Error("Invalid job delay");
    const id = crypto.randomUUID();
    this.jobs.push({ id, operation, args, due: Date.now() + delay });
    return id;
  }
  async commit(expectedRevision: number) {
    if (!this.changes.size && !this.jobs.length) return;
    const browseWrites = [];
    for (const row of this.changes.values()) {
      if (row?.table_name !== "incidentMatchData") continue;
      const match = decode<"incidentMatchData">(row);
      const source = await this.get("incidents",match.incidentId);
      const content = browseContent(match,source?.originalSourceData);
      // Keep generic matching-row edits and their search projection consistent.
      row.payload = JSON.stringify({...JSON.parse(row.payload),...content});
      browseWrites.push(...browseStatements(this.sql,match,content));
    }
    const token = crypto.randomUUID();
    const statements = [
      this.sql.prepare("UPDATE transaction_state SET revision = revision + 1, token = ? WHERE id = 1 AND revision = ?").bind(token, expectedRevision),
      this.sql.prepare("INSERT OR REPLACE INTO transaction_assertion(id, valid) VALUES (1, (SELECT token = ? FROM transaction_state WHERE id = 1))").bind(token),
      ...Array.from(this.changes, ([id, row]) => row
        ? this.sql.prepare("INSERT INTO records(id, table_name, payload, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload").bind(row.id, row.table_name, row.payload, row.created_at)
        : this.sql.prepare("DELETE FROM records WHERE id = ?").bind(id)),
      ...browseWrites,
      ...this.jobs.map((job) => this.sql.prepare("INSERT INTO job_outbox(id, operation, args, due_at) VALUES (?, ?, ?, ?)").bind(job.id, job.operation, JSON.stringify(job.args), job.due)),
    ];
    // D1 batches roll back every statement on failure. The CHECK assertion
    // prevents reads from one revision being committed after another writer.
    await this.sql.batch(statements);
  }
}

class IndexedQuery<T extends TableNames> {
  private fields: string[] = [];
  private predicates: Predicate[] = [];
  private direction: "asc" | "desc" = "asc";
  constructor(private readonly database: Database, private readonly table: T) {}
  withIndex(name: string, range?: (query: IndexRange<T>) => IndexRange<T>) {
    const fields = schema[this.table].indexes[name];
    if (!fields) throw new Error("Unknown database index");
    this.fields = fields;
    this.predicates = range?.(new IndexRange<T>()).predicates ?? [];
    if (this.predicates.some((predicate) => !fields.includes(predicate.field))) throw new Error("Query does not match its index");
    return this;
  }
  order(direction: "asc" | "desc") { this.direction = direction; return this; }
  private async rows(limit: number, offset = 0): Promise<Doc<T>[]> {
    if (!Number.isSafeInteger(limit) || limit < 0 || limit > 10001) throw new Error("Invalid query limit");
    const where = this.predicates.map((p) => p.value === undefined ? `${fieldSql(p.field)} IS NULL` : `${fieldSql(p.field)} ${p.operator} ?`).join(" AND ");
    const order = [...this.fields.map(fieldSql), "created_at", "id"].map((field) => `${field} ${this.direction}`).join(", ");
    // Table names come from the schema, never from a request, so SQLite can
    // choose the corresponding partial expression index.
    const sql = `SELECT id, table_name, payload, created_at FROM records WHERE table_name = '${this.table}'${where ? ` AND ${where}` : ""} ORDER BY ${order} LIMIT ? OFFSET ?`;
    const cached = offset === 0 && this.fields.length > 0 && this.predicates.length === this.fields.length && this.fields.every((field, i) => this.predicates[i].field === field && this.predicates[i].operator === "=")
      ? this.database.prefetchedIndexes.get(JSON.stringify([this.table, this.fields, this.predicates.map(p => p.value)])) : undefined;
    const persisted = cached ?? (await this.database.sql.prepare(sql).bind(...this.predicates.filter((p) => p.value !== undefined).map((p) => scalar(p.value)), limit + this.database.changes.size, offset).all<StoredRow>()).results;
    const rows = new Map(persisted.map((row) => [row.id, row]));
    for (const [id, row] of this.database.changes) {
      rows.delete(id);
      if (row?.table_name === this.table) rows.set(id, row);
    }
    const matching = Array.from(rows.values()).map(decode<T>).filter((row) => this.predicates.every((p) => {
      const value = row[p.field as keyof Doc<T>];
      if (p.value === undefined) return value === undefined;
      if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return false;
      const left = scalar(value)! , right = scalar(p.value)!;
      switch (p.operator) { case "=": return left === right; case "<": return left < right; case "<=": return left <= right; case ">": return left > right; case ">=": return left >= right; }
    }));
    const keys = [...this.fields, "_creationTime", "_id"];
    matching.sort((a, b) => {
      for (const key of keys) {
        const left = a[key as keyof Doc<T>] ?? "", right = b[key as keyof Doc<T>] ?? "";
        if (left === right) continue;
        if ((typeof left !== "string" && typeof left !== "number" && typeof left !== "boolean") || (typeof right !== "string" && typeof right !== "number" && typeof right !== "boolean")) throw new Error("Index fields must be scalar");
        const comparison = left < right ? -1 : 1;
        return this.direction === "asc" ? comparison : -comparison;
      }
      return 0;
    });
    return matching.slice(0, limit);
  }
  take(limit: number) { return this.rows(limit); }
  async first() { return (await this.rows(1))[0] ?? null; }
  async unique() {
    const rows = await this.rows(2);
    if (rows.length > 1) throw new Error("Duplicate indexed record");
    return rows[0] ?? null;
  }
  async collect() {
    const rows = await this.rows(10001);
    if (rows.length > 10000) throw new Error("Query exceeds the bounded collection limit");
    return rows;
  }
  async paginate(options: { numItems: number; cursor: string | null; maximumBytesRead?: number }) {
    const scope = JSON.stringify([this.table, this.fields, this.predicates, this.direction]);
    let offset = 0;
    if (options.cursor) {
      const cursor: unknown = JSON.parse(atob(options.cursor));
      if (!cursor || typeof cursor !== "object" || !("scope" in cursor) || !("offset" in cursor) || cursor.scope !== scope || !Number.isSafeInteger(cursor.offset) || Number(cursor.offset) < 0) throw new Error("Invalid database cursor");
      offset = Number(cursor.offset);
    }
    const rows = await this.rows(options.numItems + 1, offset);
    const page: Doc<T>[] = [];
    let bytes = 0;
    for (const row of rows.slice(0, options.numItems)) {
      const size = new TextEncoder().encode(JSON.stringify(row)).byteLength;
      if (bytes + size > (options.maximumBytesRead ?? 512 * 1024)) {
        if (!page.length) throw new Error("Record exceeds the database page budget");
        break;
      }
      page.push(row); bytes += size;
    }
    return { page, isDone: rows.length <= page.length, continueCursor: btoa(JSON.stringify({ scope, offset: offset + page.length })) };
  }
}

export async function revision(sql: SqlDatabase) {
  const state = await sql.prepare("SELECT revision FROM transaction_state WHERE id = 1").first<{ revision: number }>();
  if (!state) throw new Error("Backend migrations have not been applied");
  return state.revision;
}
