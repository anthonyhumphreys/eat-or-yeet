import { createHash, createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const NOTION_VERSION = "2025-09-03";
const MAX_BODY_BYTES = 32 * 1024;
const MAX_NOTION_RESPONSE_BYTES = 256 * 1024;
const MAX_WARNING_OUTPUT_CHARS = 1_900;
const WARNING_OMISSION_NOTE = "[Additional notice details omitted to fit this field; open the official notice for full scope.]";
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
    batchCode?: PropertyConfig;
    lotCode?: PropertyConfig;
    producer?: PropertyConfig;
    countryOfOrigin?: PropertyConfig;
    establishmentNumber?: PropertyConfig;
    approvalNumber?: PropertyConfig;
    retailer?: PropertyConfig;
    useBy?: PropertyConfig;
    bestBefore?: PropertyConfig;
    productionDate?: PropertyConfig;
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

export type ReviewRelationshipEvidence = { association: "source_group" | "ungrouped"; reasons: string[] };
export type ReviewNotice = { title: string; url?: string; date?: string; reason?: string; relationshipGroups?: ReviewRelationshipEvidence[]; relationshipCount?: number; relationshipsShown?: number; relationshipsComplete?: boolean };
export type ReviewResponse = {
  status: "related_warnings" | "no_related_warnings" | "unable_to_review" | "skipped";
  notices: ReviewNotice[];
  warnings?: string[];
  qualification?: string;
  coverageSummary?: string;
  noticeTotal?: number;
};
export type ShoppingPacket = {
  batchCode?: string | null;
  lotCode?: string | null;
  producer?: string | null;
  countryOfOrigin?: string | null;
  establishmentNumber?: string | null;
  approvalNumber?: string | null;
  retailer?: string | null;
  dates?: { useBy?: string | null; bestBefore?: string | null; productionDate?: string | null };
};
export type ShoppingItem = { id: string; name: string; brand?: string; barcode?: string; bought: boolean; packet?: ShoppingPacket };
export interface ReviewClient {
  review(item: ShoppingItem, region: string, signal: AbortSignal): Promise<ReviewResponse>;
  close?(): Promise<void>;
}
export interface WorkerStore {
  acceptEvent(eventId: string, pageId: string, dueAt: number, now: number): "accepted" | "duplicate" | "full";
  duePages(now: number, limit: number): Array<{ pageId: string; generation: number; claimToken: string }>;
  nextDue(): number | undefined;
  current(pageId: string): { fingerprint: string; busy: boolean } | undefined;
  schedule(pageId: string, dueAt: number, touchedAt: number): void;
  markReviewed(pageId: string, generation: number, claimToken: string, fingerprint: string, reviewedAt: number): void;
  release(pageId: string, generation: number, claimToken: string, touchedAt: number): void;
  finish(pageId: string, generation: number, claimToken: string, now: number): void;
  cleanup(before: number): void;
  close(): void;
}

/** Durable bounded event-ID and work queue state; it never stores item fields or credentials. */
export class SqliteWorkerStore implements WorkerStore {
  readonly #db: DatabaseSync;
  readonly #maxDedupeRows: number;
  readonly #maxPendingPages: number;
  constructor(path: string, options: { maxPendingPages?: number; maxDedupeRows?: number } = {}) {
    this.#maxPendingPages = options.maxPendingPages ?? MAX_PENDING_PAGES;
    this.#maxDedupeRows = options.maxDedupeRows ?? MAX_DEDUPE_ROWS;
    if (!Number.isInteger(this.#maxPendingPages) || this.#maxPendingPages < 1 || this.#maxPendingPages > MAX_PENDING_PAGES
      || !Number.isInteger(this.#maxDedupeRows) || this.#maxDedupeRows < 1 || this.#maxDedupeRows > MAX_DEDUPE_ROWS) {
      throw new WorkerError("Worker queue limits must be positive integers within the configured maximum", "invalid_config");
    }
    this.#db = new DatabaseSync(path);
    this.#db.exec(`PRAGMA journal_mode=WAL;
      PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS seen_events (id TEXT PRIMARY KEY, page_id TEXT NOT NULL, seen_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS pending_pages (page_id TEXT PRIMARY KEY, due_at INTEGER NOT NULL, busy_until INTEGER NOT NULL DEFAULT 0, pending INTEGER NOT NULL DEFAULT 1, generation INTEGER NOT NULL DEFAULT 0, claimed_generation INTEGER, claim_token TEXT, last_fingerprint TEXT, last_reviewed_at INTEGER, touched_at INTEGER NOT NULL);`);
    const columns = new Set((this.#db.prepare("PRAGMA table_info(pending_pages)").all() as Array<{ name: string }>).map((column) => column.name));
    if (!columns.has("generation")) this.#db.exec("ALTER TABLE pending_pages ADD COLUMN generation INTEGER NOT NULL DEFAULT 0");
    if (!columns.has("claimed_generation")) this.#db.exec("ALTER TABLE pending_pages ADD COLUMN claimed_generation INTEGER");
    if (!columns.has("claim_token")) this.#db.exec("ALTER TABLE pending_pages ADD COLUMN claim_token TEXT");
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
      if (eventCount.count >= this.#maxDedupeRows || (!pending?.pending && pageCount.count >= this.#maxPendingPages)) {
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
  duePages(now: number, limit: number): Array<{ pageId: string; generation: number; claimToken: string }> {
    const db = this.#db;
    db.exec("BEGIN IMMEDIATE");
    try {
      const pages = db.prepare("SELECT page_id AS pageId,generation FROM pending_pages WHERE pending=1 AND due_at <= ? AND busy_until <= ? ORDER BY due_at LIMIT ?").all(now, now, limit) as Array<{ pageId: string; generation: number }>;
      const claims = pages.map((page) => ({ ...page, claimToken: randomUUID() }));
      const claim = db.prepare("UPDATE pending_pages SET busy_until=?,claimed_generation=generation,claim_token=? WHERE page_id=? AND generation=?");
      for (const page of claims) claim.run(now + 10 * 60_000, page.claimToken, page.pageId, page.generation);
      db.exec("COMMIT");
      return claims;
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
    const result = this.#db.prepare(`INSERT INTO pending_pages(page_id,due_at,busy_until,pending,generation,touched_at)
      SELECT ?,?,0,1,1,? WHERE EXISTS (SELECT 1 FROM pending_pages WHERE page_id=? AND pending=1)
        OR (SELECT COUNT(*) FROM pending_pages WHERE pending=1) < ?
      ON CONFLICT(page_id) DO UPDATE SET due_at=excluded.due_at,pending=1,generation=pending_pages.generation+1,touched_at=excluded.touched_at`)
      .run(pageId, dueAt, touchedAt, pageId, this.#maxPendingPages);
    if (result.changes === 0) throw new WorkerError("Worker pending queue is full", "temporary");
  }
  /**
   * Replaces queued membership with the complete selected unbought-page list.
   * The caller must stop and drain every worker using this store first: this
   * operation clears abandoned claims, so it must never run alongside live work.
   * Event deduplication and previously completed fingerprints remain intact.
   */
  reconcilePages(pageIds: readonly string[], dueAt: number, touchedAt: number): void {
    if (pageIds.length > this.#maxPendingPages || new Set(pageIds).size !== pageIds.length) {
      throw new WorkerError("Reconciled pages must be unique and within the pending queue limit", "invalid_config");
    }
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      this.#db.prepare("UPDATE pending_pages SET pending=0,busy_until=0,claimed_generation=NULL,claim_token=NULL,touched_at=? WHERE pending=1 OR busy_until>0 OR claim_token IS NOT NULL").run(touchedAt);
      for (const pageId of pageIds) this.schedule(pageId, dueAt, touchedAt);
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }
  markReviewed(pageId: string, generation: number, claimToken: string, fingerprint: string, reviewedAt: number): void {
    this.#db.prepare("UPDATE pending_pages SET last_fingerprint=?,last_reviewed_at=?,busy_until=0,claimed_generation=NULL,claim_token=NULL,pending=CASE WHEN generation=? THEN 0 ELSE 1 END,touched_at=? WHERE page_id=? AND claimed_generation=? AND claim_token=?").run(fingerprint, reviewedAt, generation, reviewedAt, pageId, generation, claimToken);
  }
  release(pageId: string, generation: number, claimToken: string, touchedAt: number): void { this.#db.prepare("UPDATE pending_pages SET busy_until=0,claimed_generation=NULL,claim_token=NULL,pending=1,touched_at=? WHERE page_id=? AND claimed_generation=? AND claim_token=?").run(touchedAt, pageId, generation, claimToken); }
  finish(pageId: string, generation: number, claimToken: string, now: number): void { this.#db.prepare("UPDATE pending_pages SET busy_until=0,claimed_generation=NULL,claim_token=NULL,pending=CASE WHEN generation=? THEN 0 ELSE 1 END,touched_at=? WHERE page_id=? AND claimed_generation=? AND claim_token=?").run(generation, now, pageId, generation, claimToken); }
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
  properties?: Record<string, { id?: string; type?: string; title?: Array<{ plain_text?: string }>; rich_text?: Array<{ plain_text?: string }>; checkbox?: boolean; select?: { name?: string } | null; date?: { start?: string; end?: string | null } | null }>;
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
  readonly #token: string | (() => Promise<string>);
  readonly #fetch: Fetcher;
  #inFlight = 0;
  #lastRequestAt = 0;
  #queue: Array<() => void> = [];
  constructor(token: string | (() => Promise<string>), fetcher: Fetcher = fetch) { this.#token = token; this.#fetch = fetcher; }
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
        const token = typeof this.#token === "string" ? this.#token : await this.#token();
        response = await this.#fetch(`https://api.notion.com/v1${path}`, {
          ...init,
          signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
          headers: { Authorization: `Bearer ${token}`, "Notion-Version": NOTION_VERSION, "Content-Type": "application/json", ...init.headers },
        });
      } catch (error) {
        if (error instanceof WorkerError) throw error;
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
    const reservedAt = Math.max(Date.now(), this.#lastRequestAt + NOTION_INTERVAL_MS);
    this.#lastRequestAt = reservedAt;
    const spacing = reservedAt - Date.now();
    try { if (spacing > 0) await sleep(spacing, signal); }
    catch (error) { this.#release(); throw error; }
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
      throw classifyMcpToolResultError(result) ?? new WorkerError("Review MCP tool was unavailable");
    }
    let payload: unknown = result.structuredContent;
    const content = result.content.find((part) => part.type === "text");
    if (payload === undefined && content?.type === "text") {
      try { payload = JSON.parse(content.text) as unknown; } catch { throw new WorkerError("Review MCP returned invalid JSON"); }
    }
    if (!isRecord(payload) || !Array.isArray(payload.items)) throw new WorkerError("Review MCP response schema was not recognized");
    const itemResult = payload.items.find((entry) => isRecord(entry) && entry.id === item.id);
    return parseReviewResponse(itemResult, { qualification: payload.qualification, coverage: payload.coverage });
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
  /** Includes installation settings, such as region, in durable review fingerprints. */
  fingerprintNamespace?: string;
  /** Synchronous activation admission; throwing rejects startup before processing queued rows. */
  onReady?: () => void;
  onPaused?: (code: WorkerError["code"]) => void;
  log?: (message: string) => void;
};

export type ShoppingWorkerEvent = {
  id: string;
  type: "page.created" | "page.properties_updated";
  pageId: string;
  updatedProperties: string[];
};
export type ShoppingWorker = {
  server: Server;
  start(options?: { listen?: boolean }): Promise<void>;
  stop(): Promise<void>;
  enqueue(event: ShoppingWorkerEvent): "accepted" | "duplicate" | "ignored" | "full" | "paused";
  state(): { ready: boolean; paused: boolean };
};

export function createShoppingWebhookWorker(dependencies: WorkerDependencies): ShoppingWorker {
  const { config, notion, reviewer, store } = dependencies;
  validateConfig(config);
  const now = dependencies.now ?? Date.now;
  const delay = dependencies.delay ?? sleep;
  const debounceMs = dependencies.debounceMs ?? DEBOUNCE_MS;
  const controller = new AbortController();
  let pumpTimer: NodeJS.Timeout | undefined;
  let pumpDeadline: number | undefined;
  let started = false;
  let paused = false;
  let ready = false;
  let active = 0;
  const activeTasks = new Set<Promise<void>>();
  let stopPromise: Promise<void> | undefined;
  let listenPromise: Promise<void> | undefined;
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
    let acceptance: ReturnType<ShoppingWorker["enqueue"]>;
    try { acceptance = enqueue({ ...event, type: event.type }); }
    catch {
      respond(response, 503, { error: "queue_unavailable" });
      return;
    }
    if (acceptance === "ignored") { respond(response, 200, { accepted: false }); return; }
    if (acceptance === "paused") { respond(response, 503, { error: "worker_paused" }); return; }
    if (acceptance === "full") { respond(response, 503, { error: "queue_full" }); return; }
    respond(response, 202, { accepted: acceptance === "accepted" });
  });
  function enqueue(event: ShoppingWorkerEvent): ReturnType<ShoppingWorker["enqueue"]> {
    if (event.type !== "page.created" && event.type !== "page.properties_updated") return "ignored";
    if (event.type === "page.properties_updated" && !event.updatedProperties.some((id) => inputPropertyIds(config).has(decodePropertyId(id)))) return "ignored";
    if (paused || controller.signal.aborted) return "paused";
    const acceptedAt = now();
    store.cleanup(acceptedAt - DEDUPE_MS);
    const acceptance = store.acceptEvent(event.id, event.pageId, acceptedAt + debounceMs, acceptedAt);
    if (acceptance === "accepted") kick(debounceMs);
    return acceptance;
  }
  function parseWorkerRow(page: NotionPage): ReturnType<typeof parseRow> {
    const row = parseRow(page, config);
    if (row && dependencies.fingerprintNamespace !== undefined) {
      row.fingerprint = createHash("sha256").update(JSON.stringify([dependencies.fingerprintNamespace, row.fingerprint])).digest("hex");
    }
    return row;
  }
  function pause(code: WorkerError["code"], message: string): void {
    if (paused) return;
    paused = true;
    ready = false;
    log(message);
    try { dependencies.onPaused?.(code); }
    catch { log("Shopping worker pause callback failed."); }
  }
  function kick(waitMs = 150): void {
    schedulePumpAt(now() + waitMs);
  }
  function schedulePumpAt(deadline: number): void {
    if (controller.signal.aborted) return;
    if (pumpTimer && pumpDeadline !== undefined && pumpDeadline <= deadline) return;
    if (pumpTimer) clearTimeout(pumpTimer);
    pumpDeadline = deadline;
    pumpTimer = setTimeout(() => {
      pumpTimer = undefined;
      pumpDeadline = undefined;
      void runPumpSafely();
    }, Math.max(0, deadline - now()));
    pumpTimer.unref();
  }
  async function runPumpSafely(): Promise<void> {
    try { await pump(); }
    catch {
      if (!controller.signal.aborted) {
        log("Shopping queue maintenance failed; retrying later.");
        schedulePumpAt(now() + 60_000);
      }
    }
  }
  async function pump(): Promise<void> {
    if (controller.signal.aborted || paused || !ready) return;
    store.cleanup(now() - DEDUPE_MS);
    const slots = MAX_NOTION_CONCURRENCY - active;
    if (slots > 0) {
      for (const { pageId, generation, claimToken } of store.duePages(now(), slots)) {
        active += 1;
        const task = processPage(pageId, generation, claimToken).catch(() => {
          if (!controller.signal.aborted) log("Shopping row processing failed (worker_error).");
        }).finally(() => { activeTasks.delete(task); active -= 1; kick(); });
        activeTasks.add(task);
        void task;
      }
    }
    if (active > 0) schedulePumpAt(now() + 500);
    else {
      const nextDue = store.nextDue();
      if (nextDue !== undefined) schedulePumpAt(Math.max(now() + 150, nextDue));
    }
  }
  async function processPage(pageId: string, generation: number, claimToken: string): Promise<void> {
    try {
      const page = await notion.getPage(pageId, controller.signal);
      assertSelectedDatabase(page, config);
      const row = parseWorkerRow(page);
      if (!row || row.bought || !row.item.name.trim()) { store.finish(pageId, generation, claimToken, now()); return; }
      if (store.current(pageId)?.fingerprint === row.fingerprint) { store.finish(pageId, generation, claimToken, now()); return; }
      const result = row.invalidPacket
        ? { status: "unable_to_review" as const, notices: [], warnings: ["A configured packet detail is invalid or outside the accepted format. Correct the row and try again."] }
        : canReviewItem(row.item)
          ? await reviewer.review(row.item, config.region, controller.signal)
          : { status: "unable_to_review" as const, notices: [], warnings: ["The configured item name, brand, or barcode is outside the review tool's accepted format. Correct the row and try again."] };
      const latest = await notion.getPage(pageId, controller.signal);
      assertSelectedDatabase(latest, config);
      const latestRow = parseWorkerRow(latest);
      if (!latestRow || latestRow.bought || latestRow.fingerprint !== row.fingerprint) {
        if (latestRow && !latestRow.bought && latestRow.item.name.trim()) store.schedule(pageId, now() + debounceMs, now());
        store.finish(pageId, generation, claimToken, now());
        return;
      }
      const writeProperties = buildWriteProperties(config, result, row.fingerprint, now());
      // Check immediately before every write attempt, including each bounded 429/5xx retry.
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
        const preflight = await notion.getPage(pageId, controller.signal);
        assertSelectedDatabase(preflight, config);
        const current = parseWorkerRow(preflight);
        if (!current || current.bought || current.fingerprint !== row.fingerprint) {
          if (current && !current.bought && current.item.name.trim()) store.schedule(pageId, now() + debounceMs, now());
          store.finish(pageId, generation, claimToken, now());
          return;
        }
        try { await notion.patchPage(pageId, writeProperties, controller.signal); store.markReviewed(pageId, generation, claimToken, row.fingerprint, now()); return; }
        catch (error) {
          if (!(error instanceof WorkerError) || error.code !== "temporary" || attempt === MAX_RETRIES) throw error;
          if ((error.retryAfterMs ?? 0) > MAX_IN_PROCESS_RETRY_AFTER_MS) {
            store.schedule(pageId, now() + Math.min(error.retryAfterMs ?? 0, MAX_DURABLE_RETRY_AFTER_MS), now());
            store.finish(pageId, generation, claimToken, now());
            return;
          }
          await delay(error.retryAfterMs ?? 400 * (2 ** attempt) + randomInt(250), controller.signal);
        }
      }
    } catch (error) {
      if (controller.signal.aborted) { store.release(pageId, generation, claimToken, now()); return; }
      if (error instanceof WorkerError && error.code === "out_of_scope") { store.finish(pageId, generation, claimToken, now()); return; }
      if (error instanceof WorkerError && (error.code === "revoked" || error.code === "missing_property" || error.code === "invalid_config")) {
        store.release(pageId, generation, claimToken, now());
        pause(error.code, error.code === "revoked" ? "Notion access stopped; worker paused." : "Notion resource or property configuration changed; worker paused.");
        return;
      } else if (!controller.signal.aborted) {
        log(`Shopping row processing failed (${error instanceof WorkerError ? error.code : "network_or_parse_error"}).`);
        const retryAfterMs = error instanceof WorkerError && error.retryAfterMs !== undefined
          ? Math.min(Math.max(0, error.retryAfterMs), MAX_DURABLE_RETRY_AFTER_MS)
          : 60_000;
        store.schedule(pageId, now() + retryAfterMs, now());
      }
      store.finish(pageId, generation, claimToken, now());
    }
  }
  async function validateStartup(): Promise<void> {
    let attempt = 0;
    while (!controller.signal.aborted && !paused) {
      try {
        await validateSelectedDataSource(notion, config, controller.signal);
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof WorkerError && ["revoked", "missing_property", "invalid_config", "out_of_scope"].includes(error.code)) {
          pause(error.code, error.code === "revoked" ? "Notion access stopped; worker paused." : "Selected data source or configured properties are invalid; worker paused.");
          return;
        }
        const backoff = Math.min(1_000 * (2 ** Math.min(attempt, 6)), 60_000);
        const requested = error instanceof WorkerError ? error.retryAfterMs ?? 0 : 0;
        const waitMs = Math.min(Math.max(backoff, requested), MAX_DURABLE_RETRY_AFTER_MS);
        attempt += 1;
        log("Notion startup validation is temporarily unavailable; retrying.");
        try { await delay(waitMs, controller.signal); } catch { return; }
        continue;
      }
      if (controller.signal.aborted) return;
      try { dependencies.onReady?.(); }
      catch (error) {
        ready = false;
        paused = true;
        throw error;
      }
      if (controller.signal.aborted) return;
      ready = true;
      return;
    }
  }
  return {
    server,
    enqueue,
    state: () => ({ ready, paused }),
    async start(options = {}) {
      if (started || controller.signal.aborted) return;
      started = true;
      if (options.listen !== false) {
        listenPromise = new Promise<void>((resolve, reject) => {
          server.once("error", reject);
          server.listen(config.listenPort, config.listenHost, () => { server.removeListener("error", reject); resolve(); });
        });
        await listenPromise;
      }
      await validateStartup();
      kick(); // Resume durable due work after process restart; no workspace scan/poll is performed.
    },
    async stop() {
      if (stopPromise) return await stopPromise;
      stopPromise = (async () => {
      controller.abort(new Error("worker_stopped"));
      ready = false;
      if (pumpTimer) clearTimeout(pumpTimer);
      pumpTimer = undefined;
      pumpDeadline = undefined;
      // Host resolution can finish after shutdown begins, so settle the listen attempt first.
      if (listenPromise) await listenPromise.catch(() => undefined);
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
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
export function inputFingerprint(item: ShoppingItem, bought: boolean, packetFingerprint?: unknown): string {
  const input = { name: item.name.trim(), brand: item.brand?.trim() ?? "", barcode: item.barcode?.trim() ?? "", bought };
  return createHash("sha256").update(JSON.stringify(packetFingerprint === undefined ? input : { ...input, packet: packetFingerprint })).digest("hex");
}
/** Classifies an MCP tool result without trusting its content text or payload. */
export function classifyMcpToolResultError(result: { [key: string]: unknown; isError?: unknown; _meta?: unknown }): WorkerError | undefined {
  if (!result.isError) return undefined;
  const metadata = isRecord(result._meta) && isRecord(result._meta.publicError) ? result._meta.publicError : undefined;
  if (!metadata) return new WorkerError("Review MCP tool was unavailable");

  const retryAfterSeconds = metadata.retryAfterSeconds;
  const retryAfterMs = typeof retryAfterSeconds === "number" && Number.isFinite(retryAfterSeconds)
    ? Math.min(Math.max(0, retryAfterSeconds * 1_000), MAX_DURABLE_RETRY_AFTER_MS)
    : undefined;
  if (metadata.recoverable === true || (metadata.recoverable === undefined && metadata.code === "quota_exceeded")) {
    return new WorkerError("Review MCP returned a recoverable tool error", "temporary", retryAfterMs);
  }
  if (metadata.recoverable === false) return new WorkerError("Review MCP rejected the configured tool request", "invalid_config");
  if (metadata.code === "unavailable" || metadata.code === "interrupted" || metadata.code === "INTERNAL_ERROR") {
    return new WorkerError("Review MCP tool was unavailable");
  }
  return new WorkerError("Review MCP rejected the configured tool request", "invalid_config");
}
function canReviewItem(item: ShoppingItem): boolean {
  const barcode = item.barcode?.trim();
  return item.id.length <= 100 && item.name.trim().length > 0 && item.name.trim().length <= 200 && (item.brand === undefined || (item.brand.trim().length > 0 && item.brand.trim().length <= 200)) && (barcode === undefined || (barcode.length <= 300 && isValidGtin(barcode)));
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

function parseRow(page: NotionPage, config: ShoppingWorkerConfig): { item: ShoppingItem; bought: boolean; fingerprint: string; invalidPacket: boolean } | undefined {
  if (!page.properties) throw new WorkerError("Notion page properties are absent", "missing_property");
  const value = (property: PropertyConfig | undefined): NonNullable<NotionPage["properties"]>[string] | undefined => {
    if (!property) return undefined;
    const entry = Object.values(page.properties ?? {}).find((candidate) => decodePropertyId(candidate.id ?? "") === decodePropertyId(property.id));
    if (!entry || entry.type !== property.kind) throw new WorkerError("Configured Notion property is missing or has changed type", "missing_property");
    return entry;
  };
  const rawText = (property: PropertyConfig | undefined): string | undefined => {
    if (!property) return undefined;
    const entry = value(property);
    return (entry?.title ?? entry?.rich_text ?? []).map((part) => part.plain_text ?? "").join("");
  };
  const text = (property: PropertyConfig | undefined): string | undefined => rawText(property)?.slice(0, 500);
  const item: ShoppingItem = { id: page.id, name: text(config.notionProperties.item) ?? "", bought: false };
  const brand = text(config.notionProperties.brand), barcode = text(config.notionProperties.barcode);
  if (brand?.trim()) item.brand = brand.trim();
  if (barcode?.trim()) item.barcode = barcode.trim();
  const boughtProperty = config.notionProperties.bought;
  const bought = boughtProperty ? value(boughtProperty)?.checkbox === true : false;
  const packet = parsePacket(config.notionProperties, value, rawText);
  const outputProperties = [config.notionProperties.relatedWarnings, config.notionProperties.reviewStatus, config.notionProperties.reviewedAt, config.notionProperties.inputFingerprint];
  outputProperties.forEach((property) => value(property));
  item.bought = bought;
  if (packet.packet) item.packet = packet.packet;
  return { item, bought, fingerprint: inputFingerprint(item, bought, packet.fingerprint), invalidPacket: packet.invalid };
}

function parsePacket(
  properties: ShoppingWorkerConfig["notionProperties"],
  value: (property: PropertyConfig | undefined) => NonNullable<NotionPage["properties"]>[string] | undefined,
  rawText: (property: PropertyConfig | undefined) => string | undefined,
): { packet?: ShoppingPacket; fingerprint?: unknown; invalid: boolean } {
  const textFields = ["batchCode", "lotCode", "producer", "countryOfOrigin", "establishmentNumber", "approvalNumber", "retailer"] as const;
  const dateFields = ["useBy", "bestBefore", "productionDate"] as const;
  const configuredText = textFields.filter((field) => properties[field]);
  const configuredDates = dateFields.filter((field) => properties[field]);
  if (configuredText.length === 0 && configuredDates.length === 0) return { invalid: false };

  const packet: ShoppingPacket = {};
  const fingerprint: Record<string, unknown> = {};
  let invalid = false;
  for (const field of configuredText) {
    const raw = rawText(properties[field]) ?? "";
    const trimmed = raw.trim();
    if (trimmed.length > 300) invalid = true;
    packet[field] = trimmed || null;
    fingerprint[field] = trimmed || null;
  }
  if (configuredDates.length) {
    const dates: NonNullable<ShoppingPacket["dates"]> = {};
    const dateFingerprint: Record<string, unknown> = {};
    for (const field of configuredDates) {
      const property = properties[field]!;
      const entry = value(property);
      const start = entry?.date?.start ?? null;
      const end = entry?.date?.end ?? null;
      if (start !== null && !isCalendarDate(start)) invalid = true;
      if (end !== null && end !== "") invalid = true;
      dates[field] = start;
      dateFingerprint[field] = { start, end };
    }
    packet.dates = dates;
    fingerprint.dates = dateFingerprint;
  }
  return { packet, fingerprint, invalid };
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day;
}
function buildWriteProperties(config: ShoppingWorkerConfig, review: ReviewResponse, fingerprint: string, reviewedAt: number): Record<string, unknown> {
  const labels = config.statusLabels;
  const status = review.status === "related_warnings" ? labels.found : review.status === "no_related_warnings" ? labels.none : labels.unable;
  const sourceQualifications = [review.qualification, ...(review.warnings ?? [])].filter((value): value is string => Boolean(value));
  const qualifications = sourceQualifications.slice(0, 2).map((value) => value.slice(0, 500));
  const noticeCount = review.noticeTotal;
  const countQualification = noticeCount !== undefined && noticeCount > review.notices.length
    ? `Showing ${review.notices.length} of ${noticeCount} warning notices; ${noticeCount - review.notices.length} more omitted.`
    : "";
  const prefixes = [...qualifications, review.coverageSummary, countQualification].filter((value): value is string => Boolean(value));
  const omissionNote = WARNING_OMISSION_NOTE;
  const compactNoticeLine = (notice: ReviewNotice): string => {
    const shortenedTitle = notice.title.length > 180;
    const title = notice.title.slice(0, 180) + (shortenedTitle ? "…" : "");
    const url = safeHttpsUrl(notice.url);
    const link = url ? ` ${url}` : notice.url ? " [official notice link omitted]" : " [official notice link unavailable]";
    return `${title}${link} [notice evidence omitted]`;
  };
  const compactFirstNotice = review.notices[0] ? compactNoticeLine(review.notices[0]) : "";
  const reservedSpace = compactFirstNotice ? compactFirstNotice.length + 1 : 0;
  const prefixBudget = Math.max(0, MAX_WARNING_OUTPUT_CHARS - reservedSpace - omissionNote.length - 2);
  const fittedPrefixes: string[] = [];
  let prefixLength = 0;
  let omitted = sourceQualifications.length > 2 || sourceQualifications.some((value) => value.length > 500) || review.notices.length > 5 || (noticeCount !== undefined && noticeCount > review.notices.length);
  for (const part of prefixes) {
    const separator = fittedPrefixes.length ? 1 : 0;
    const available = prefixBudget - prefixLength - separator;
    if (part.length <= available) {
      fittedPrefixes.push(part);
      prefixLength += separator + part.length;
      continue;
    }
    omitted = true;
    const marker = "… [qualification shortened]";
    if (available > marker.length + 1) fittedPrefixes.push(`${part.slice(0, available - marker.length)}${marker}`);
    break;
  }
  const prefix = fittedPrefixes.join("\n");
  const lines: string[] = [];
  let remaining = MAX_WARNING_OUTPUT_CHARS - prefix.length - (prefix ? 1 : 0) - omissionNote.length - 1;
  for (const notice of review.notices.slice(0, 5)) {
    const titleWasShortened = notice.title.length > 180;
    const title = notice.title.slice(0, 180) + (titleWasShortened ? "…" : "");
    const dateWasShortened = (notice.date?.length ?? 0) > 100;
    const date = notice.date ? ` (${notice.date.slice(0, 100)}${dateWasShortened ? "…" : ""})` : "";
    const incomplete = notice.relationshipsComplete === false || (notice.relationshipCount !== undefined && notice.relationshipsShown !== undefined && notice.relationshipCount > notice.relationshipsShown);
    const incompleteText = incomplete ? "Some affected product groups are omitted; inspect the official notice." : "";
    const evidence = notice.relationshipGroups?.length
      ? notice.relationshipGroups.map((group, index) => `Group ${index + 1}: ${group.reasons.join(", ")}`).join("; ")
      : notice.reason ?? "";
    const detailsOmittedText = "… [additional grouped evidence omitted]";
    const reasonWasShortened = evidence.length > 800;
    const reasonText = `${evidence.slice(0, 800)}${reasonWasShortened ? detailsOmittedText : ""}${incompleteText ? ` ${incompleteText}` : ""}`;
    const reason = reasonText ? ` — ${reasonText}` : "";
    const url = safeHttpsUrl(notice.url);
    const urlNote = notice.url && !url ? " [official notice link omitted]" : "";
    const shorteningNote = titleWasShortened || dateWasShortened ? " [notice details shortened]" : "";
    const baseLine = `${title}${date}${reason}${urlNote}${shorteningNote}`;
    const line = `${baseLine}${url ? ` ${url}` : ""}`;
    const separator = prefix || lines.length ? 1 : 0;
    if (line.length + separator <= remaining) {
      lines.push(line);
      remaining -= line.length + separator;
      omitted ||= titleWasShortened || dateWasShortened || reasonWasShortened || Boolean(urlNote);
      continue;
    }
    omitted = true;
    const compact = compactNoticeLine(notice);
    if (compact.length + separator <= remaining) {
      lines.push(compact);
      remaining -= compact.length + separator;
    }
  }
  const parts = [...(prefix ? [prefix] : []), ...lines];
  if (omitted) parts.push(omissionNote);
  const text = parts.join("\n");
  const p = config.notionProperties;
  return {
    [decodePropertyId(p.relatedWarnings.id)]: { rich_text: text ? [{ type: "text", text: { content: text } }] : [] },
    [decodePropertyId(p.reviewStatus.id)]: { select: { name: status } },
    [decodePropertyId(p.reviewedAt.id)]: { date: { start: new Date(reviewedAt).toISOString() } },
    [decodePropertyId(p.inputFingerprint.id)]: { rich_text: [{ type: "text", text: { content: fingerprint } }] },
  };
}
export function parseReviewResponse(value: unknown, context: { qualification: unknown; coverage: unknown }): ReviewResponse {
  if (!isRecord(value) || !["related_warnings", "no_related_warnings", "unable_to_review", "skipped"].includes(String(value.status)) || typeof value.qualification !== "string" || typeof context.qualification !== "string" || !Array.isArray(value.relatedWarnings)) throw new WorkerError("Review MCP response schema was not recognized");
  const coverage = summarizeCoverage(context.coverage);
  const noticeTotal = typeof value.total === "number" && Number.isSafeInteger(value.total) && value.total >= 0 ? value.total : undefined;
  if (noticeTotal === undefined) throw new WorkerError("Review MCP response schema was not recognized");
  const status = value.status === "related_warnings" ? "related_warnings" : value.status === "no_related_warnings" ? "no_related_warnings" : value.status === "skipped" ? "skipped" : "unable_to_review";
  const notices = value.relatedWarnings.filter(isRecord).slice(0, 5).flatMap((entry) => {
    if (!isRecord(entry.warning)) return [];
    const warning = entry.warning;
    const relationships = Array.isArray(entry.relationships) ? entry.relationships : [];
    const relationshipGroups = relationships.filter(isRecord).map((relationship) => ({
      association: relationship.association === "source_group" ? "source_group" as const : "ungrouped" as const,
      reasons: Array.isArray(relationship.reasons) ? relationship.reasons.filter(isRecord).map((part) => typeof part.evidence === "string" ? part.evidence.slice(0, 200) : "").filter(Boolean) : [],
    })).filter((relationship) => relationship.reasons.length > 0);
    const relationshipCount = typeof entry.relationshipCount === "number" && Number.isSafeInteger(entry.relationshipCount) ? entry.relationshipCount : undefined;
    const relationshipsComplete = typeof entry.relationshipsComplete === "boolean" ? entry.relationshipsComplete : undefined;
    const officialSource = isRecord(warning.officialSource) ? warning.officialSource : undefined;
    return [{ title: typeof warning.title === "string" ? warning.title : "Related published warning", ...(typeof officialSource?.url === "string" ? { url: officialSource.url } : {}), ...(typeof warning.publishedAt === "string" ? { date: warning.publishedAt } : {}), relationshipGroups, ...(relationshipCount !== undefined ? { relationshipCount } : {}), relationshipsShown: relationshipGroups.length, ...(relationshipsComplete !== undefined ? { relationshipsComplete } : {}) }];
  });
  return { status, notices, warnings: [value.qualification], qualification: context.qualification, coverageSummary: coverage, noticeTotal };
}

function summarizeCoverage(value: unknown): string {
  if (!isRecord(value) || (value.region !== "UK" && value.region !== "US") || typeof value.healthy !== "boolean" || !Array.isArray(value.sources) || (value.checkedAt !== null && typeof value.checkedAt !== "string")) {
    throw new WorkerError("Review MCP response schema was not recognized");
  }
  const sources = value.sources.filter(isRecord).map((source) => {
    const name = typeof source.name === "string" ? source.name.replace(/[\r\n]/g, " ").slice(0, 32) : "Source";
    const state = ["healthy", "stale", "failed", "missing"].includes(String(source.status)) ? String(source.status) : "unknown";
    return `${name}: ${state}`;
  });
  const shownSources = sources.slice(0, 2);
  const checkedAt = typeof value.checkedAt === "string" && Number.isFinite(Date.parse(value.checkedAt)) ? `; checked ${value.checkedAt.slice(0, 10)}` : "; check time unavailable";
  const additionalSources = sources.length > shownSources.length ? `; ${sources.length - shownSources.length} more source statuses omitted` : "";
  return `Source coverage (${value.region}): ${value.healthy ? "current" : "incomplete"}${checkedAt}${shownSources.length ? `; ${shownSources.join(", ")}` : ""}${additionalSources}.`;
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
  const richTextPacketFields = [p.batchCode, p.lotCode, p.producer, p.countryOfOrigin, p.establishmentNumber, p.approvalNumber, p.retailer];
  const datePacketFields = [p.useBy, p.bestBefore, p.productionDate];
  if (!["title", "rich_text"].includes(p.item.kind) || (p.brand && p.brand.kind !== "rich_text") || (p.barcode && p.barcode.kind !== "rich_text") || richTextPacketFields.some((property) => property && property.kind !== "rich_text") || datePacketFields.some((property) => property && property.kind !== "date") || p.relatedWarnings.kind !== "rich_text" || p.inputFingerprint.kind !== "rich_text" || p.reviewStatus.kind !== "select" || p.reviewedAt.kind !== "date" || (p.bought && p.bought.kind !== "checkbox")) throw new WorkerError("Configured Notion property types do not match worker operations", "invalid_config");
}
function inputPropertyIds(config: ShoppingWorkerConfig): Set<string> {
  const p = config.notionProperties;
  return new Set([p.item, p.brand, p.barcode, p.bought, p.batchCode, p.lotCode, p.producer, p.countryOfOrigin, p.establishmentNumber, p.approvalNumber, p.retailer, p.useBy, p.bestBefore, p.productionDate].filter((value): value is PropertyConfig => value !== undefined).map((value) => decodePropertyId(value.id)));
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
  try { const url = new URL(value); const normalized = url.toString(); return url.protocol === "https:" && normalized.length <= 300 ? normalized : undefined; } catch { return undefined; }
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
