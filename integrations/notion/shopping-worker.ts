import { createHash, createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const NOTION_VERSION = "2025-09-03";
const MAX_BODY_BYTES = 32 * 1024;
const MAX_NOTION_RESPONSE_BYTES = 256 * 1024;
const DEBOUNCE_MS = 3_000;
const DEDUPE_MS = 25 * 60 * 60 * 1_000;
const NOTION_INTERVAL_MS = 334;
const MAX_NOTION_CONCURRENCY = 2;
const MAX_RETRIES = 3;
const MAX_IN_PROCESS_RETRY_AFTER_MS = 60_000;
const MAX_DURABLE_RETRY_AFTER_MS = 24 * 60 * 60 * 1_000;
const REQUEST_TIMEOUT_MS = 8_000;
const MCP_REQUEST_TIMEOUT_MS = 15_000;
const MAX_DEDUPE_ROWS = 50_000;
const MAX_PENDING_PAGES = 10_000;

export type PropertyConfig = { id: string; kind: "title" | "rich_text" | "checkbox" | "select" | "date" };
export type ShoppingWorkerConfig = {
  listenHost: string;
  listenPort: number;
  statePath: string;
  notionApiToken: string;
  notionWebhookVerificationToken: string;
  notionDataSourceId: string;
  notionDatabaseId: string;
  notionProperties: {
    item: PropertyConfig;
    brand?: PropertyConfig;
    barcode?: PropertyConfig;
    bought?: PropertyConfig;
    relatedWarnings: PropertyConfig;
    reviewStatus: PropertyConfig;
    reviewedAt: PropertyConfig;
    inputFingerprint: PropertyConfig;
  };
  reviewMcpUrl: string;
  reviewConnectionKey: string;
  reviewToolName?: string;
  region: string;
  statusLabels: { found: string; none: string; unable: string };
};

export type ReviewNotice = { title: string; url?: string; date?: string; reason?: string; relationshipCount?: number; relationshipsShown?: number; relationshipsComplete?: boolean };
export type ReviewResponse = {
  status: "related_warnings" | "no_related_warnings" | "unable_to_review" | "skipped";
  notices: ReviewNotice[];
  warnings?: string[];
};
export type ShoppingItem = { id: string; name: string; brand?: string; barcode?: string; bought: boolean };
export interface ReviewClient {
  review(item: ShoppingItem, region: string, signal: AbortSignal): Promise<ReviewResponse>;
  close?(): Promise<void>;
}
export interface WorkerStore {
  acceptEvent(eventId: string, pageId: string, dueAt: number, now: number): "accepted" | "duplicate" | "full";
  duePages(now: number, limit: number): Array<{ pageId: string }>;
  nextDue(): number | undefined;
  current(pageId: string): { fingerprint: string; busy: boolean } | undefined;
  schedule(pageId: string, dueAt: number, touchedAt: number): void;
  markReviewed(pageId: string, fingerprint: string, reviewedAt: number): void;
  release(pageId: string, touchedAt: number): void;
  finish(pageId: string, now: number): void;
  cleanup(before: number): void;
  close(): void;
}

/** Durable bounded event-ID and work queue state; it never stores item fields or credentials. */
export class SqliteWorkerStore implements WorkerStore {
  readonly #db: DatabaseSync;
  constructor(path: string) {
    this.#db = new DatabaseSync(path);
    this.#db.exec(`PRAGMA journal_mode=WAL;
      PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS seen_events (id TEXT PRIMARY KEY, page_id TEXT NOT NULL, seen_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS pending_pages (page_id TEXT PRIMARY KEY, due_at INTEGER NOT NULL, busy_until INTEGER NOT NULL DEFAULT 0, pending INTEGER NOT NULL DEFAULT 1, last_fingerprint TEXT, last_reviewed_at INTEGER, touched_at INTEGER NOT NULL);`);
  }
  acceptEvent(eventId: string, pageId: string, dueAt: number, now: number): "accepted" | "duplicate" | "full" {
    const eventHash = createHash("sha256").update(eventId).digest("hex");
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      if (this.#db.prepare("SELECT 1 FROM seen_events WHERE id=?").get(eventHash)) {
        this.#db.exec("ROLLBACK");
        return "duplicate";
      }
      const pending = this.#db.prepare("SELECT pending FROM pending_pages WHERE page_id=?").get(pageId) as { pending: number } | undefined;
      const eventCount = this.#db.prepare("SELECT COUNT(*) AS count FROM seen_events").get() as { count: number };
      const pageCount = this.#db.prepare("SELECT COUNT(*) AS count FROM pending_pages WHERE pending=1").get() as { count: number };
      if (eventCount.count >= MAX_DEDUPE_ROWS || (!pending?.pending && pageCount.count >= MAX_PENDING_PAGES)) {
        this.#db.exec("ROLLBACK");
        return "full";
      }
      const result = this.#db.prepare("INSERT OR IGNORE INTO seen_events(id,page_id,seen_at) VALUES(?,?,?)").run(eventHash, pageId, now);
      if (result.changes === 0) {
        this.#db.exec("ROLLBACK");
        return "duplicate";
      }
      this.schedule(pageId, dueAt, now);
      this.#db.exec("COMMIT");
      return "accepted";
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }
  duePages(now: number, limit: number): Array<{ pageId: string }> {
    const db = this.#db;
    db.exec("BEGIN IMMEDIATE");
    try {
      const pages = db.prepare("SELECT page_id AS pageId FROM pending_pages WHERE pending=1 AND due_at <= ? AND busy_until <= ? ORDER BY due_at LIMIT ?").all(now, now, limit) as Array<{ pageId: string }>;
      const claim = db.prepare("UPDATE pending_pages SET busy_until=? WHERE page_id=?");
      for (const page of pages) claim.run(now + 10 * 60_000, page.pageId);
      db.exec("COMMIT");
      return pages;
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  nextDue(): number | undefined {
    const row = this.#db.prepare("SELECT MIN(MAX(due_at,busy_until)) AS dueAt FROM pending_pages WHERE pending=1").get() as { dueAt: number | null };
    return row?.dueAt ?? undefined;
  }
  current(pageId: string): { fingerprint: string; busy: boolean } | undefined {
    const row = this.#db.prepare("SELECT last_fingerprint AS fingerprint,busy_until FROM pending_pages WHERE page_id=?").get(pageId) as { fingerprint: string | null; busy_until: number } | undefined;
    return row ? { fingerprint: row.fingerprint ?? "", busy: row.busy_until > Date.now() } : undefined;
  }
  schedule(pageId: string, dueAt: number, touchedAt: number): void {
    this.#db.prepare("INSERT INTO pending_pages(page_id,due_at,busy_until,pending,touched_at) VALUES(?,?,0,1,?) ON CONFLICT(page_id) DO UPDATE SET due_at=excluded.due_at,pending=1,touched_at=excluded.touched_at").run(pageId, dueAt, touchedAt);
  }
  markReviewed(pageId: string, fingerprint: string, reviewedAt: number): void {
    this.#db.prepare("UPDATE pending_pages SET last_fingerprint=?,last_reviewed_at=?,busy_until=0,pending=CASE WHEN due_at <= ? THEN 0 ELSE 1 END,touched_at=? WHERE page_id=?").run(fingerprint, reviewedAt, reviewedAt, reviewedAt, pageId);
  }
  release(pageId: string, touchedAt: number): void { this.#db.prepare("UPDATE pending_pages SET busy_until=0,pending=1,touched_at=? WHERE page_id=?").run(touchedAt, pageId); }
  finish(pageId: string, now: number): void { this.#db.prepare("UPDATE pending_pages SET busy_until=0,pending=CASE WHEN due_at <= ? THEN 0 ELSE 1 END,touched_at=? WHERE page_id=?").run(now, now, pageId); }
  cleanup(before: number): void {
    this.#db.prepare("DELETE FROM seen_events WHERE seen_at < ?").run(before);
    this.#db.prepare("DELETE FROM pending_pages WHERE pending=0 AND touched_at < ?").run(before);
  }
  close(): void { this.#db.close(); }
}

export class WorkerError extends Error {
  readonly code: "revoked" | "missing_property" | "out_of_scope" | "invalid_config" | "temporary";
  readonly retryAfterMs?: number;
  constructor(message: string, code: "revoked" | "missing_property" | "out_of_scope" | "invalid_config" | "temporary" = "temporary", retryAfterMs?: number) {
    super(message);
    this.name = "WorkerError";
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}
type NotionPage = {
  id: string;
  parent?: { type?: string; database_id?: string; data_source_id?: string };
  properties?: Record<string, { id?: string; type?: string; title?: Array<{ plain_text?: string }>; rich_text?: Array<{ plain_text?: string }>; checkbox?: boolean; select?: { name?: string } | null; date?: { start?: string } | null }>;
};
export interface NotionClient {
  getPage(pageId: string, signal: AbortSignal): Promise<NotionPage>;
  getDataSource(dataSourceId: string, signal: AbortSignal): Promise<{ id: string; parent?: { database_id?: string }; properties?: Record<string, { id?: string; type?: string; select?: { options?: Array<{ name: string }> } }> }>;
  patchPage(pageId: string, properties: Record<string, unknown>, signal: AbortSignal): Promise<void>;
  close?(): Promise<void>;
}
type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

/** Minimal Notion REST client with connection pacing, a shared concurrency ceiling and bounded retries. */
export class NotionRestClient implements NotionClient {
  readonly #token: string;
  readonly #fetch: Fetcher;
  #inFlight = 0;
  #lastRequestAt = 0;
  #queue: Array<() => void> = [];
  constructor(token: string, fetcher: Fetcher = fetch) { this.#token = token; this.#fetch = fetcher; }
  async getPage(pageId: string, signal: AbortSignal): Promise<NotionPage> {
    return await this.#request(`/pages/${encodeURIComponent(pageId)}`, { method: "GET" }, signal) as NotionPage;
  }
  async getDataSource(dataSourceId: string, signal: AbortSignal): Promise<{ id: string; parent?: { database_id?: string }; properties?: Record<string, { id?: string; type?: string; select?: { options?: Array<{ name: string }> } }> }> {
    return await this.#request(`/data_sources/${encodeURIComponent(dataSourceId)}`, { method: "GET" }, signal) as { id: string; parent?: { database_id?: string }; properties?: Record<string, { id?: string; type?: string; select?: { options?: Array<{ name: string }> } }> };
  }
  async patchPage(pageId: string, properties: Record<string, unknown>, signal: AbortSignal): Promise<void> {
    await this.#request(`/pages/${encodeURIComponent(pageId)}`, { method: "PATCH", body: JSON.stringify({ properties }) }, signal);
  }
  async #request(path: string, init: RequestInit, signal: AbortSignal): Promise<unknown> {
    const method = init.method ?? "GET";
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      await this.#acquire(signal);
      let response: Response;
      try {
        response = await this.#fetch(`https://api.notion.com/v1${path}`, {
          ...init,
          signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
          headers: { Authorization: `Bearer ${this.#token}`, "Notion-Version": NOTION_VERSION, "Content-Type": "application/json", ...init.headers },
        });
      } catch (error) {
        if (method === "PATCH") throw new WorkerError("Notion write transport failed", "temporary");
        if (attempt === MAX_RETRIES || signal.aborted) throw error;
        await sleep(retryDelay(undefined, attempt), signal);
        continue;
      } finally { this.#release(); }
      if (response.ok) return method === "GET" ? await readJsonLimited(response, MAX_NOTION_RESPONSE_BYTES) : undefined;
      if (method === "PATCH" && (response.status === 429 || response.status === 529)) {
        const retryAt = retryAfterMilliseconds(response.headers.get("retry-after")) ?? retryDelay(undefined, 0);
        await response.body?.cancel();
        throw new WorkerError("Notion write was rate limited", "temporary", retryAt);
      }
      const retryable = response.status === 429 || response.status === 529 || [500, 502, 503, 504].includes(response.status);
      if (method === "PATCH" && retryable) {
        const retryAfterMs = retryAfterMilliseconds(response.headers.get("retry-after"));
        await response.body?.cancel();
        throw new WorkerError("Notion write requires a fresh preflight before retry", "temporary", retryAfterMs);
      }
      if (!retryable || attempt === MAX_RETRIES) {
        if (response.status === 401 || response.status === 403) throw new WorkerError("Notion access was revoked or denied", "revoked");
        if (response.status === 404) throw new WorkerError("Notion resource is unavailable", path.startsWith("/pages/") ? "out_of_scope" : "missing_property");
        if (response.status === 400) throw new WorkerError("Notion rejected the configured request; check selected database and property configuration", "invalid_config");
        throw new WorkerError(`Notion request failed (${response.status})`, "temporary");
      }
      if (response.status === 429 && await isBlocked(response)) throw new WorkerError("Notion blocked this integration's API access", "revoked");
      const requestedWait = retryAfterMilliseconds(response.headers.get("retry-after"));
      if (requestedWait !== undefined && requestedWait > MAX_IN_PROCESS_RETRY_AFTER_MS) {
        await response.body?.cancel();
        throw new WorkerError("Notion rate limit requires a durable retry", "temporary", requestedWait);
      }
      const wait = retryDelay(response.headers.get("retry-after"), attempt);
      await response.body?.cancel();
      await sleep(wait, signal);
    }
    throw new WorkerError("Notion request retries exhausted");
  }
  async #acquire(signal: AbortSignal): Promise<void> {
    if (this.#inFlight >= MAX_NOTION_CONCURRENCY) await new Promise<void>((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      this.#queue.push(() => { signal.removeEventListener("abort", abort); resolve(); });
    });
    this.#inFlight += 1;
    const spacing = this.#lastRequestAt + NOTION_INTERVAL_MS - Date.now();
    try { if (spacing > 0) await sleep(spacing, signal); }
    catch (error) { this.#release(); throw error; }
    this.#lastRequestAt = Date.now();
  }
  #release(): void { this.#inFlight = Math.max(0, this.#inFlight - 1); this.#queue.shift()?.(); }
}

/** Official MCP SDK 2.3.1 streamable-HTTP adapter. */
export class McpReviewClient implements ReviewClient {
  readonly #client: Client;
  readonly #transport: StreamableHTTPClientTransport;
  readonly #toolName: string;
  constructor(url: string, connectionKey: string, toolName = "review_shopping_items") {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") throw new WorkerError("Review MCP URL must use HTTPS", "invalid_config");
    this.#toolName = toolName;
    this.#client = new Client({ name: "eat-or-yeet-notion-shopping", version: "1.0.0" });
    this.#transport = new StreamableHTTPClientTransport(parsed, { requestInit: { headers: { Authorization: `Bearer ${connectionKey}` } } });
  }
  async connect(): Promise<void> { await this.#client.connect(this.#transport); }
  async review(item: ShoppingItem, region: string, signal: AbortSignal): Promise<ReviewResponse> {
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(MCP_REQUEST_TIMEOUT_MS)]);
    let result: Awaited<ReturnType<Client["callTool"]>>;
    try { result = await this.#client.callTool({ name: this.#toolName, arguments: { region, items: [item] } }, { signal: requestSignal }); }
    catch (error) {
      if (isRecord(error) && isRecord(error.data) && [401, 403].includes(Number(error.data.status))) throw new WorkerError("Review MCP access was revoked or denied", "revoked");
      throw new WorkerError("Review MCP transport failed");
    }
    if (result.isError) {
      const publicError = isRecord(result._meta?.publicError) ? result._meta.publicError : undefined;
      if (publicError?.code === "quota_exceeded" && typeof publicError.retryAfterSeconds === "number" && Number.isFinite(publicError.retryAfterSeconds)) {
        const retryAfterMs = Math.min(Math.max(0, publicError.retryAfterSeconds * 1_000), MAX_DURABLE_RETRY_AFTER_MS);
        throw new WorkerError("Review MCP quota requires a durable retry", "temporary", retryAfterMs);
      }
      if (publicError && publicError.code !== "unavailable" && publicError.code !== "interrupted") throw new WorkerError("Review MCP rejected the configured tool request", "invalid_config");
      throw new WorkerError("Review MCP tool was unavailable");
    }
    let payload: unknown = result.structuredContent;
    const content = result.content.find((part) => part.type === "text");
    if (payload === undefined && content?.type === "text") {
      try { payload = JSON.parse(content.text) as unknown; } catch { throw new WorkerError("Review MCP returned invalid JSON"); }
    }
    if (!isRecord(payload) || !Array.isArray(payload.items)) throw new WorkerError("Review MCP response schema was not recognized");
    const itemResult = payload.items.find((entry) => isRecord(entry) && entry.id === item.id);
    return parseReviewResponse(itemResult);
  }
  async close(): Promise<void> { await this.#client.close(); }
}

export type WorkerDependencies = {
  config: ShoppingWorkerConfig;
  notion: NotionClient;
  reviewer: ReviewClient;
  store: WorkerStore;
  now?: () => number;
  delay?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Test seam; production defaults to the fixed 3-second debounce. */
  debounceMs?: number;
  log?: (message: string) => void;
};

export function createShoppingWebhookWorker(dependencies: WorkerDependencies): { server: Server; start(): Promise<void>; stop(): Promise<void> } {
  const { config, notion, reviewer, store } = dependencies;
  validateConfig(config);
  const now = dependencies.now ?? Date.now;
  const delay = dependencies.delay ?? sleep;
  const debounceMs = dependencies.debounceMs ?? DEBOUNCE_MS;
  const controller = new AbortController();
  let pumpTimer: NodeJS.Timeout | undefined;
  let started = false;
  let paused = false;
  let active = 0;
  const activeTasks = new Set<Promise<void>>();
  let stopPromise: Promise<void> | undefined;
  const log = dependencies.log ?? (() => undefined);
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/webhooks/notion") { respond(response, 404, { error: "not_found" }); return; }
    let raw: Buffer;
    try { raw = await readBody(request, MAX_BODY_BYTES); }
    catch (error) { respond(response, error instanceof RangeError ? 413 : 400, { error: "invalid_body" }); return; }
    let payload: unknown;
    try { payload = JSON.parse(raw.toString("utf8")) as unknown; } catch { respond(response, 400, { error: "invalid_json" }); return; }
    // The initial Notion verification request is a one-time challenge; the operator transfers it to the secret store.
    if (isRecord(payload) && typeof payload.verification_token === "string" && payload.verification_token.length <= 512) {
      respond(response, 200, { verification_token: payload.verification_token });
      return;
    }
    const signature = request.headers["x-notion-signature"];
    if (typeof signature !== "string" || !verifySignature(raw, signature, config.notionWebhookVerificationToken)) {
      respond(response, 401, { error: "invalid_signature" });
      return;
    }
    const event = parseWebhook(payload);
    if (!event) { respond(response, 400, { error: "invalid_event" }); return; }
    if (event.type !== "page.created" && event.type !== "page.properties_updated") { respond(response, 200, { accepted: false }); return; }
    if (event.type === "page.properties_updated" && !event.updatedProperties.some((id) => inputPropertyIds(config).has(id))) {
      respond(response, 200, { accepted: false }); return;
    }
    if (paused) { respond(response, 503, { error: "worker_paused" }); return; }
    let acceptance: ReturnType<WorkerStore["acceptEvent"]>;
    try {
      store.cleanup(now() - DEDUPE_MS);
      acceptance = store.acceptEvent(event.id, event.pageId, now() + debounceMs, now());
    } catch {
      respond(response, 503, { error: "queue_unavailable" });
      return;
    }
    if (acceptance === "full") { respond(response, 503, { error: "queue_full" }); return; }
    respond(response, 202, { accepted: acceptance === "accepted" });
    if (acceptance === "accepted") kick(debounceMs);
  });
  function kick(waitMs = 150): void {
    if (controller.signal.aborted) return;
    if (pumpTimer) clearTimeout(pumpTimer);
    pumpTimer = setTimeout(() => { void pump(); }, waitMs);
    pumpTimer.unref();
  }
  async function pump(): Promise<void> {
    if (controller.signal.aborted || paused) return;
    store.cleanup(now() - DEDUPE_MS);
    const slots = MAX_NOTION_CONCURRENCY - active;
    if (slots > 0) {
      for (const { pageId } of store.duePages(now(), slots)) {
        active += 1;
        const task = processPage(pageId).finally(() => { activeTasks.delete(task); active -= 1; kick(); });
        activeTasks.add(task);
        void task;
      }
    }
    if (active > 0) pumpTimer = setTimeout(() => { void pump(); }, 500);
    else {
      const nextDue = store.nextDue();
      if (nextDue !== undefined) pumpTimer = setTimeout(() => { void pump(); }, Math.max(150, nextDue - now()));
    }
  }
  async function processPage(pageId: string): Promise<void> {
    try {
      const page = await notion.getPage(pageId, controller.signal);
      assertSelectedDatabase(page, config);
      const row = parseRow(page, config);
      if (!row || row.bought || !row.item.name.trim()) { store.finish(pageId, now()); return; }
      if (store.current(pageId)?.fingerprint === row.fingerprint) { store.finish(pageId, now()); return; }
      const result = canReviewItem(row.item)
        ? await reviewer.review(row.item, config.region, controller.signal)
        : { status: "unable_to_review" as const, notices: [], warnings: ["The configured item name, brand, or barcode is outside the review tool's accepted format. Correct the row and try again."] };
      const latest = await notion.getPage(pageId, controller.signal);
      assertSelectedDatabase(latest, config);
      const latestRow = parseRow(latest, config);
      if (!latestRow || latestRow.bought || latestRow.fingerprint !== row.fingerprint) {
        if (latestRow && !latestRow.bought && latestRow.item.name.trim()) store.schedule(pageId, now() + debounceMs, now());
        store.finish(pageId, now());
        return;
      }
      const writeProperties = buildWriteProperties(config, result, row.fingerprint, now());
      // Check immediately before every write attempt, including each bounded 429/5xx retry.
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
        const preflight = await notion.getPage(pageId, controller.signal);
        assertSelectedDatabase(preflight, config);
        const current = parseRow(preflight, config);
        if (!current || current.bought || current.fingerprint !== row.fingerprint) {
          if (current && !current.bought && current.item.name.trim()) store.schedule(pageId, now() + debounceMs, now());
          store.finish(pageId, now());
          return;
        }
        try { await notion.patchPage(pageId, writeProperties, controller.signal); store.markReviewed(pageId, row.fingerprint, now()); return; }
        catch (error) {
          if (!(error instanceof WorkerError) || error.code !== "temporary" || attempt === MAX_RETRIES) throw error;
          if ((error.retryAfterMs ?? 0) > MAX_IN_PROCESS_RETRY_AFTER_MS) {
            store.schedule(pageId, now() + Math.min(error.retryAfterMs ?? 0, MAX_DURABLE_RETRY_AFTER_MS), now());
            store.finish(pageId, now());
            return;
          }
          await delay(error.retryAfterMs ?? 400 * (2 ** attempt) + randomInt(250), controller.signal);
        }
      }
    } catch (error) {
      if (controller.signal.aborted) { store.release(pageId, now()); return; }
      if (error instanceof WorkerError && error.code === "out_of_scope") { store.finish(pageId, now()); return; }
      if (error instanceof WorkerError && (error.code === "revoked" || error.code === "missing_property" || error.code === "invalid_config")) {
        paused = true;
        log(error.code === "revoked" ? "Notion access stopped; worker paused." : "Notion resource or property configuration changed; worker paused.");
      } else if (!controller.signal.aborted) {
        log(`Shopping row processing failed (${error instanceof WorkerError ? error.code : "network_or_parse_error"}).`);
        const retryAfterMs = error instanceof WorkerError && error.retryAfterMs !== undefined
          ? Math.min(Math.max(0, error.retryAfterMs), MAX_DURABLE_RETRY_AFTER_MS)
          : 60_000;
        store.schedule(pageId, now() + retryAfterMs, now());
      }
      store.finish(pageId, now());
    }
  }
  return {
    server,
    async start() {
      if (started) return;
      started = true;
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(config.listenPort, config.listenHost, () => { server.removeListener("error", reject); resolve(); });
      });
      try { await validateSelectedDataSource(notion, config, controller.signal); }
      catch (error) {
        paused = true;
        log(error instanceof WorkerError && error.code === "revoked" ? "Notion access stopped; worker paused." : "Selected data source or configured properties could not be validated; worker paused.");
      }
      kick(); // Resume durable due work after process restart; no workspace scan/poll is performed.
    },
    async stop() {
      if (stopPromise) return await stopPromise;
      stopPromise = (async () => {
      controller.abort(new Error("worker_stopped"));
      if (pumpTimer) clearTimeout(pumpTimer);
      if (started) await new Promise<void>((resolve) => server.close(() => resolve()));
      await Promise.allSettled([...activeTasks]);
      await Promise.allSettled([notion.close?.(), reviewer.close?.()]);
      store.close();
      })();
      await stopPromise;
    },
  };
}

export function verifySignature(rawBody: Uint8Array, signature: string, verificationToken: string): boolean {
  if (!/^sha256=[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = `sha256=${createHmac("sha256", verificationToken).update(rawBody).digest("hex")}`;
  const supplied = Buffer.from(signature, "utf8"), calculated = Buffer.from(expected, "utf8");
  return supplied.length === calculated.length && timingSafeEqual(supplied, calculated);
}
export function inputFingerprint(item: ShoppingItem, bought: boolean): string {
  return createHash("sha256").update(JSON.stringify({ name: item.name.trim(), brand: item.brand?.trim() ?? "", barcode: item.barcode?.trim() ?? "", bought })).digest("hex");
}
function canReviewItem(item: ShoppingItem): boolean {
  const barcode = item.barcode?.trim();
  return item.id.length <= 100 && item.name.trim().length > 0 && item.name.trim().length <= 200 && (item.brand === undefined || (item.brand.trim().length > 0 && item.brand.trim().length <= 200)) && (barcode === undefined || (barcode.length <= 14 && isValidGtin(barcode)));
}
function isValidGtin(value: string): boolean {
  if (!/^[\d\s-]+$/.test(value)) return false;
  const digits = value.replace(/[\s-]/g, "");
  if (![8, 12, 13, 14].includes(digits.length)) return false;
  const body = digits.slice(0, -1);
  const expected = Number(digits.at(-1));
  const sum = [...body].reverse().reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === expected;
}

function parseRow(page: NotionPage, config: ShoppingWorkerConfig): { item: ShoppingItem; bought: boolean; fingerprint: string } | undefined {
  if (!page.properties) throw new WorkerError("Notion page properties are absent", "missing_property");
  const value = (property: PropertyConfig | undefined): NonNullable<NotionPage["properties"]>[string] | undefined => {
    if (!property) return undefined;
    const entry = Object.values(page.properties ?? {}).find((candidate) => decodePropertyId(candidate.id ?? "") === decodePropertyId(property.id));
    if (!entry || entry.type !== property.kind) throw new WorkerError("Configured Notion property is missing or has changed type", "missing_property");
    return entry;
  };
  const text = (property: PropertyConfig | undefined): string | undefined => {
    if (!property) return undefined;
    const entry = value(property);
    return (entry?.title ?? entry?.rich_text ?? []).map((part) => part.plain_text ?? "").join("").slice(0, 500);
  };
  const item: ShoppingItem = { id: page.id, name: text(config.notionProperties.item) ?? "", bought: false };
  const brand = text(config.notionProperties.brand), barcode = text(config.notionProperties.barcode);
  if (brand?.trim()) item.brand = brand.trim();
  if (barcode?.trim()) item.barcode = barcode.trim();
  const boughtProperty = config.notionProperties.bought;
  const bought = boughtProperty ? value(boughtProperty)?.checkbox === true : false;
  const outputProperties = [config.notionProperties.relatedWarnings, config.notionProperties.reviewStatus, config.notionProperties.reviewedAt, config.notionProperties.inputFingerprint];
  outputProperties.forEach((property) => value(property));
  item.bought = bought;
  return { item, bought, fingerprint: inputFingerprint(item, bought) };
}
function buildWriteProperties(config: ShoppingWorkerConfig, review: ReviewResponse, fingerprint: string, reviewedAt: number): Record<string, unknown> {
  const labels = config.statusLabels;
  const status = review.status === "related_warnings" ? labels.found : review.status === "no_related_warnings" ? labels.none : labels.unable;
  const lines = review.notices.slice(0, 5).map((notice) => {
    const date = notice.date ? ` (${notice.date.slice(0, 40)})` : "";
    const incomplete = notice.relationshipsComplete === false || (notice.relationshipCount !== undefined && notice.relationshipsShown !== undefined && notice.relationshipCount > notice.relationshipsShown);
    const reasonText = [notice.reason, incomplete ? "Some affected product groups are omitted; inspect the official notice." : undefined].filter(Boolean).join(" ");
    const reason = reasonText ? ` — ${reasonText.slice(0, 180)}` : "";
    const url = safeHttpsUrl(notice.url);
    return `${notice.title.slice(0, 180)}${date}${reason}${url ? ` ${url}` : ""}`;
  });
  const warnings = (review.warnings ?? []).slice(0, 4).map((warning) => warning.slice(0, 180));
  const text = [...lines, ...warnings].join("\n").slice(0, 1_900);
  const p = config.notionProperties;
  return {
    [decodePropertyId(p.relatedWarnings.id)]: { rich_text: text ? [{ type: "text", text: { content: text } }] : [] },
    [decodePropertyId(p.reviewStatus.id)]: { select: { name: status } },
    [decodePropertyId(p.reviewedAt.id)]: { date: { start: new Date(reviewedAt).toISOString() } },
    [decodePropertyId(p.inputFingerprint.id)]: { rich_text: [{ type: "text", text: { content: fingerprint } }] },
  };
}
function parseReviewResponse(value: unknown): ReviewResponse {
  if (!isRecord(value) || !["related_warnings", "no_related_warnings", "unable_to_review", "skipped"].includes(String(value.status)) || typeof value.qualification !== "string" || !Array.isArray(value.relatedWarnings)) throw new WorkerError("Review MCP response schema was not recognized");
  const status = value.status === "related_warnings" ? "related_warnings" : value.status === "no_related_warnings" ? "no_related_warnings" : value.status === "skipped" ? "skipped" : "unable_to_review";
  const notices = value.relatedWarnings.filter(isRecord).slice(0, 5).flatMap((entry) => {
    if (!isRecord(entry.warning)) return [];
    const warning = entry.warning;
    const relationships = Array.isArray(entry.relationships) ? entry.relationships : [];
    const reason = relationships.filter(isRecord).flatMap((relationship) => Array.isArray(relationship.reasons) ? relationship.reasons.filter(isRecord).map((part) => typeof part.evidence === "string" ? part.evidence : "") : []).filter(Boolean).slice(0, 4).join(", ");
    const relationshipCount = typeof entry.relationshipCount === "number" && Number.isSafeInteger(entry.relationshipCount) ? entry.relationshipCount : undefined;
    const relationshipsComplete = typeof entry.relationshipsComplete === "boolean" ? entry.relationshipsComplete : undefined;
    return [{ title: typeof warning.title === "string" ? warning.title : "Related published warning", ...(typeof warning.websiteUrl === "string" ? { url: warning.websiteUrl } : {}), ...(typeof warning.publishedAt === "string" ? { date: warning.publishedAt } : {}), ...(reason ? { reason } : {}), ...(relationshipCount !== undefined ? { relationshipCount } : {}), relationshipsShown: relationships.length, ...(relationshipsComplete !== undefined ? { relationshipsComplete } : {}) }];
  });
  return { status, notices, warnings: [value.qualification] };
}
function parseWebhook(value: unknown): { id: string; type: string; pageId: string; updatedProperties: string[] } | undefined {
  if (!isRecord(value) || typeof value.id !== "string" || value.id.length > 80 || !isRecord(value.entity) || value.entity.type !== "page" || typeof value.entity.id !== "string" || value.entity.id.length > 80 || typeof value.type !== "string" || typeof value.timestamp !== "string" || value.timestamp.length > 64 || !Number.isFinite(Date.parse(value.timestamp))) return undefined;
  const data = isRecord(value.data) ? value.data : {};
  const updated = Array.isArray(data.updated_properties) ? data.updated_properties.filter((id): id is string => typeof id === "string" && id.length <= 128).slice(0, 100).map(decodePropertyId) : [];
  return { id: value.id, type: value.type, pageId: value.entity.id, updatedProperties: updated };
}
function decodePropertyId(value: string): string { try { return decodeURIComponent(value); } catch { return value; } }
function validateConfig(config: ShoppingWorkerConfig): void {
  const required = [config.statePath, config.notionApiToken, config.notionWebhookVerificationToken, config.notionDataSourceId, config.notionDatabaseId, config.reviewMcpUrl, config.reviewConnectionKey];
  if (required.some((value) => !value || value.includes("placeholder"))) throw new WorkerError("Missing required owner-managed configuration", "invalid_config");
  if (config.region !== "UK" && config.region !== "US") throw new WorkerError("Review region must be UK or US", "invalid_config");
  if (!Number.isInteger(config.listenPort) || config.listenPort < 0 || config.listenPort > 65_535 || !config.listenHost) throw new WorkerError("Invalid webhook listen address", "invalid_config");
  if (Object.values(config.statusLabels).some((label) => !label.trim() || label.length > 100)) throw new WorkerError("Review status labels must be non-empty and at most 100 characters", "invalid_config");
  const properties = Object.values(config.notionProperties).filter((value): value is PropertyConfig => value !== undefined);
  if (properties.some((property) => !property.id) || new Set(properties.map((property) => decodePropertyId(property.id))).size !== properties.length) throw new WorkerError("Property IDs must be present and distinct", "invalid_config");
  const p = config.notionProperties;
  if (!["title", "rich_text"].includes(p.item.kind) || p.relatedWarnings.kind !== "rich_text" || p.inputFingerprint.kind !== "rich_text" || p.reviewStatus.kind !== "select" || p.reviewedAt.kind !== "date" || (p.bought && p.bought.kind !== "checkbox")) throw new WorkerError("Configured Notion property types do not match worker operations", "invalid_config");
}
function inputPropertyIds(config: ShoppingWorkerConfig): Set<string> {
  const p = config.notionProperties;
  return new Set([p.item, p.brand, p.barcode, p.bought].filter((value): value is PropertyConfig => value !== undefined).map((value) => decodePropertyId(value.id)));
}
function assertSelectedDatabase(page: NotionPage, config: ShoppingWorkerConfig): void {
  if (page.parent?.data_source_id !== config.notionDataSourceId || (page.parent.database_id && page.parent.database_id !== config.notionDatabaseId)) throw new WorkerError("Page is outside selected Notion data source", "out_of_scope");
}
async function validateSelectedDataSource(notion: NotionClient, config: ShoppingWorkerConfig, signal: AbortSignal): Promise<void> {
  const dataSource = await notion.getDataSource(config.notionDataSourceId, signal);
  if (dataSource.id !== config.notionDataSourceId || dataSource.parent?.database_id !== config.notionDatabaseId || !dataSource.properties) {
    throw new WorkerError("Configured data source does not belong to the selected database", "missing_property");
  }
  for (const property of Object.values(config.notionProperties).filter((value): value is PropertyConfig => value !== undefined)) {
    const schemaProperty = Object.values(dataSource.properties).find((candidate) => decodePropertyId(candidate.id ?? "") === decodePropertyId(property.id));
    if (!schemaProperty || schemaProperty.type !== property.kind) throw new WorkerError("Configured Notion property is missing or has changed type", "missing_property");
  }
  const status = Object.values(dataSource.properties).find((property) => decodePropertyId(property.id ?? "") === decodePropertyId(config.notionProperties.reviewStatus.id));
  const options = new Set(status?.select?.options?.map((option) => option.name) ?? []);
  if (![config.statusLabels.found, config.statusLabels.none, config.statusLabels.unable].every((label) => options.has(label))) {
    throw new WorkerError("Configured Review status labels are missing from the Notion select", "missing_property");
  }
}
function safeHttpsUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try { const url = new URL(value); return url.protocol === "https:" ? url.toString().slice(0, 300) : undefined; } catch { return undefined; }
}
async function isBlocked(response: Response): Promise<boolean> {
  try { const body = await response.clone().json() as { additional_data?: { rate_limit_reason?: string } }; return body.additional_data?.rate_limit_reason === "public_api_request_blocked"; } catch { return false; }
}
function retryDelay(value: string | null | undefined, attempt: number): number {
  const wait = retryAfterMilliseconds(value) ?? Math.min(2 ** attempt * 1_000, 30_000);
  return Math.min(wait + randomInt(250), MAX_IN_PROCESS_RETRY_AFTER_MS);
}
function retryAfterMilliseconds(value: string | null | undefined): number | undefined {
  if (value === null || value === undefined || !/^\d+$/.test(value)) return undefined;
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) ? Math.min(seconds * 1_000, MAX_DURABLE_RETRY_AFTER_MS) : MAX_DURABLE_RETRY_AFTER_MS;
}
async function readJsonLimited(response: Response, maxBytes: number): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel();
    throw new WorkerError("Notion response exceeded the configured size limit", "temporary");
  }
  if (!response.body) return undefined;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new WorkerError("Notion response exceeded the configured size limit", "temporary");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8")) as unknown; }
  catch { throw new WorkerError("Notion returned invalid JSON", "temporary"); }
}
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    signal.addEventListener("abort", abort, { once: true });
  });
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function respond(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}
async function readBody(request: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > maxBytes) throw new RangeError("request too large");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, size);
}
