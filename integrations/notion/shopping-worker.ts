import { createHash, randomInt, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { MAX_DURABLE_RETRY_AFTER_MS, MAX_IN_PROCESS_RETRY_AFTER_MS, MAX_NOTION_CONCURRENCY, MAX_RETRIES, WorkerError, assertSelectedDatabase, buildWriteProperties, canReviewItem, decodePropertyId, inputPropertyIds, isRecord, parseRow, parseWebhook, sleep, validateConfig, validateSelectedDataSource, verifySignature, type NotionClient, type NotionPage, type ReviewClient, type ShoppingWorkerConfig, type ShoppingWorkerEvent } from "./shopping-core.ts";

export * from "./shopping-core.ts";

const MAX_BODY_BYTES = 32 * 1024;
const DEBOUNCE_MS = 3_000;
const DEDUPE_MS = 25 * 60 * 60 * 1_000;
const MAX_DEDUPE_ROWS = 50_000;
const MAX_PENDING_PAGES = 10_000;

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
