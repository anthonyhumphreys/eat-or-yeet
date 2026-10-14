import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { D1PreparedStatement, D1Result, D1Meta } from "@cloudflare/workers-types";
import type { SqlDatabase } from "../backend/database";

// SQLite runs the same migration and expression-index SQL as D1. Separate
// workerd integration tests exercise the actual provider binding and Worker.
export function sqliteD1(): SqlDatabase {
  const connection = new DatabaseSync(":memory:");
  const meta = (): D1Meta & Record<string, unknown> => ({ changed_db: false, changes: 0, duration: 0, last_row_id: 0, rows_read: 0, rows_written: 0, size_after: 0 });
  class Statement implements D1PreparedStatement {
    constructor(readonly sql: string, readonly params: SQLInputValue[] = []) {}
    bind(...values: unknown[]) { return new Statement(this.sql, values.map((value) => {
      if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "bigint" || value instanceof Uint8Array) return value;
      throw new Error("Unsupported SQL parameter");
    })); }
    execute<T>(): D1Result<T> { return { success: true, results: connection.prepare(this.sql).all(...this.params) as T[], meta: meta() }; }
    async all<T>(): Promise<D1Result<T>> { return this.execute<T>(); }
    async first<T>(column?: string): Promise<T | null> {
      const row = connection.prepare(this.sql).get(...this.params);
      return (column ? row?.[column] : row) as T ?? null;
    }
    run<T>() { return this.all<T>(); }
    raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
    raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
    async raw<T>(options?: { columnNames?: boolean }): Promise<T[]> {
      const statement = connection.prepare(this.sql);
      statement.setReturnArrays(true);
      const rows = statement.all(...this.params);
      return (options?.columnNames ? [statement.columns().map((column) => column.name), ...rows] : rows) as T[];
    }
  }
  return {
    prepare: (sql) => new Statement(sql),
    async batch<T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      connection.exec("BEGIN IMMEDIATE");
      try {
        const results: D1Result<T>[] = [];
        for (const statement of statements) {
          if (!(statement instanceof Statement)) throw new Error("Unknown test SQL statement");
          results.push(statement.execute<T>());
        }
        connection.exec("COMMIT");
        return results;
      } catch (error) { connection.exec("ROLLBACK"); throw error; }
    },
  };
}
