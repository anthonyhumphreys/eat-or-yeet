import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createShoppingWebhookWorker, inputFingerprint, NotionRestClient, SqliteWorkerStore, verifySignature, WorkerError, type NotionClient, type ReviewClient, type ReviewResponse, type ShoppingItem, type ShoppingWorkerConfig, type WorkerStore } from "../integrations/notion/shopping-worker";

const secret = "test-verification-token";
const databaseId = "database-1";
const sourceId = "source-1";
const ids = { item: "item", brand: "brand", bought: "bought", warnings: "warnings", status: "status", reviewed: "reviewed", fingerprint: "fingerprint" };
type TestProperty = { id: string; type: string; title?: Array<{ plain_text: string }>; rich_text?: Array<{ plain_text: string }>; checkbox?: boolean; select?: { name: string } | null; date?: { start: string } | null };
type TestPage = { id: string; parent: { database_id: string; data_source_id: string }; properties: Record<string, TestProperty> };
const property = (id: string, type: string, extra: Record<string, unknown> = {}) => ({ id, type, ...extra }) as TestProperty;

function makeConfig(port: number): ShoppingWorkerConfig {
  return {
    listenHost: "127.0.0.1", listenPort: port, statePath: ":memory:", notionApiToken: "notion-token", notionWebhookVerificationToken: secret,
    notionDataSourceId: sourceId, notionDatabaseId: databaseId,
    notionProperties: {
      item: { id: ids.item, kind: "title" }, brand: { id: ids.brand, kind: "rich_text" }, bought: { id: ids.bought, kind: "checkbox" },
      relatedWarnings: { id: ids.warnings, kind: "rich_text" }, reviewStatus: { id: ids.status, kind: "select" }, reviewedAt: { id: ids.reviewed, kind: "date" }, inputFingerprint: { id: ids.fingerprint, kind: "rich_text" },
    },
    reviewMcpUrl: "https://mcp.example.test/mcp", reviewConnectionKey: "connection-key", region: "UK", statusLabels: { found: "Related warnings found", none: "No related warnings found in covered data", unable: "Unable to review" },
  };
}

class MemoryStore implements WorkerStore {
  closed = false;
  readonly events = new Set<string>();
  readonly pages = new Map<string, { due: number; fingerprint: string; reviewedAt?: number; busy: boolean }>();
  acceptEvent(eventId: string, pageId: string, dueAt: number, _now: number): "accepted" | "duplicate" | "full" {
    void _now;
    if (this.events.has(eventId)) return "duplicate";
    this.events.add(eventId); this.schedule(pageId, dueAt, dueAt); return "accepted";
  }
  duePages(now: number, limit: number) {
    const due = [...this.pages].filter(([, value]) => value.due <= now && !value.busy).slice(0, limit);
    for (const [, value] of due) value.busy = true;
    return due.map(([pageId]) => ({ pageId }));
  }
  nextDue() { const due = [...this.pages.values()].filter((page) => !page.busy && page.due !== Infinity).map((page) => page.due); return due.length ? Math.min(...due) : undefined; }
  current(pageId: string) { const page = this.pages.get(pageId); return page ? { fingerprint: page.fingerprint, busy: page.busy } : undefined; }
  schedule(pageId: string, dueAt: number, _touchedAt: number) { void _touchedAt; const page = this.pages.get(pageId); this.pages.set(pageId, { due: dueAt, fingerprint: page?.fingerprint ?? "", reviewedAt: page?.reviewedAt, busy: page?.busy ?? false }); }
  markReviewed(pageId: string, fingerprint: string, reviewedAt: number) { const page = this.pages.get(pageId); this.pages.set(pageId, { due: page?.due !== undefined && page.due > reviewedAt ? page.due : Infinity, fingerprint, reviewedAt, busy: false }); }
  release(pageId: string, _touchedAt: number) { void _touchedAt; if (this.closed) throw new Error("store already closed"); const page = this.pages.get(pageId); if (page) page.busy = false; }
  finish(pageId: string, now: number) { if (this.closed) throw new Error("store already closed"); const page = this.pages.get(pageId); if (page) { page.busy = false; if (page.due <= now) page.due = Infinity; } }
  cleanup(before: number) { void before; }
  close() { this.closed = true; }
}

class FakeNotion implements NotionClient {
  readonly page = makePage();
  readonly patches: Array<Record<string, unknown>> = [];
  getPageCalls = 0;
  failGet: WorkerError | undefined;
  beforePatch?: () => void;
  patchError?: (attempt: number) => WorkerError | undefined;
  async getDataSource(dataSourceId: string) {
    expect(dataSourceId).toBe(sourceId);
    return { id: sourceId, parent: { database_id: databaseId }, properties: Object.fromEntries(Object.entries(ids).map(([name, id]) => [name, { id, type: name === "item" ? "title" : name === "brand" || name === "warnings" || name === "fingerprint" ? "rich_text" : name === "bought" ? "checkbox" : name === "status" ? "select" : "date", ...(name === "status" ? { select: { options: [{ name: "Related warnings found" }, { name: "No related warnings found in covered data" }, { name: "Unable to review" }] } } : {}) }])) };
  }
  async getPage(_pageId: string, _signal: AbortSignal) { void _pageId; void _signal; this.getPageCalls += 1; if (this.failGet) throw this.failGet; return structuredClone(this.page); }
  async patchPage(_pageId: string, properties: Record<string, unknown>) {
    this.beforePatch?.();
    const error = this.patchError?.(this.patches.length);
    if (error) throw error;
    this.patches.push(properties);
  }
}

class FakeReview implements ReviewClient {
  items: ShoppingItem[] = [];
  next: Promise<void> | undefined;
  async close() {}
  async review(item: ShoppingItem): Promise<ReviewResponse> {
    this.items.push(structuredClone(item));
    if (this.next) await this.next;
    return { status: "related_warnings", notices: [{ title: "Official notice", url: "https://example.gov/notice" }] };
  }
}

function makePage(): TestPage {
  return {
    id: "page-1", parent: { database_id: databaseId, data_source_id: sourceId }, properties: {
      Item: property(ids.item, "title", { title: [{ plain_text: "Milk" }] }), Brand: property(ids.brand, "rich_text", { rich_text: [] }),
      Bought: property(ids.bought, "checkbox", { checkbox: false }), Warnings: property(ids.warnings, "rich_text", { rich_text: [] }),
      Status: property(ids.status, "select", { select: null }), Reviewed: property(ids.reviewed, "date", { date: null }),
      Fingerprint: property(ids.fingerprint, "rich_text", { rich_text: [] }),
    },
  };
}

const workers: Array<ReturnType<typeof createShoppingWebhookWorker>> = [];
async function setup(options: { now?: () => number; review?: FakeReview; notion?: FakeNotion } = {}) {
  const notion = options.notion ?? new FakeNotion();
  const review = options.review ?? new FakeReview();
  const store = new MemoryStore();
  const logs: string[] = [];
  const worker = createShoppingWebhookWorker({ config: makeConfig(0), notion, reviewer: review, store, now: options.now, delay: async () => undefined, debounceMs: 10, log: (message) => logs.push(message) });
  workers.push(worker);
  await worker.start();
  const address = worker.server.address();
  if (!address || typeof address === "string") throw new Error("Expected local test server address");
  return { notion, review, store, worker, logs, url: `http://127.0.0.1:${address.port}/webhooks/notion` };
}
afterEach(async () => { await Promise.all(workers.splice(0).map((worker) => worker.stop())); });

function payload(id: string, type = "page.created", updatedProperties?: string[]) {
  return { id, timestamp: new Date().toISOString(), type, entity: { id: "page-1", type: "page" }, data: updatedProperties ? { updated_properties: updatedProperties } : {} };
}
async function send(url: string, value: unknown) {
  const body = JSON.stringify(value);
  const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  return await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-notion-signature": signature }, body });
}
async function eventually(predicate: () => boolean) {
  const until = Date.now() + 4_000;
  while (!predicate() && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 10));
  expect(predicate()).toBe(true);
}

describe("Notion shopping webhook worker", () => {
  it("does not acknowledge a failed durable enqueue and accepts its redelivery", async () => {
    const { store, review, url } = await setup();
    const accept = store.acceptEvent.bind(store);
    store.acceptEvent = () => { throw new Error("private datastore failure"); };
    const failed = await send(url, payload("retry-enqueue"));
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain("private datastore");
    expect(review.items).toHaveLength(0);
    store.acceptEvent = accept;
    expect((await send(url, payload("retry-enqueue"))).status).toBe(202);
    await eventually(() => review.items.length === 1);
  });
  it("durably deduplicates webhook IDs, claims due pages once, and expires IDs after the retry window", () => {
    const store = new SqliteWorkerStore(":memory:");
    try {
      expect(store.acceptEvent("event-1", "page-1", 4_000, 1_000)).toBe("accepted");
      expect(store.acceptEvent("event-1", "page-1", 4_000, 1_000)).toBe("duplicate");
      expect(store.nextDue()).toBe(4_000);
      expect(store.duePages(3_999, 2)).toEqual([]);
      expect(store.duePages(4_000, 2)).toEqual([{ pageId: "page-1" }]);
      expect(store.duePages(4_001, 2)).toEqual([]);
      store.finish("page-1", 4_001);
      expect(store.duePages(4_001, 2)).toEqual([]); // finishing acknowledges the claimed event
      expect(store.acceptEvent("event-1", "page-1", 90_000_000, 90_000_000)).toBe("duplicate");
      store.cleanup(100_000_000 - 25 * 60 * 60 * 1_000);
      expect(store.acceptEvent("event-1", "page-1", 100_000_000, 100_000_000)).toBe("accepted");
    } finally { store.close(); }
  });

  it("rolls back event deduplication when enqueue fails so delivery can recover", () => {
    class FailingEnqueueStore extends SqliteWorkerStore {
      failEnqueue = true;
      override schedule(pageId: string, dueAt: number, touchedAt: number): void {
        if (this.failEnqueue) throw new Error("injected enqueue failure");
        super.schedule(pageId, dueAt, touchedAt);
      }
    }
    const store = new FailingEnqueueStore(":memory:");
    try {
      expect(() => store.acceptEvent("event-retry-enqueue", "page-retry-enqueue", 2_000, 1_000)).toThrow("injected enqueue failure");
      expect(store.nextDue()).toBeUndefined();
      store.failEnqueue = false;
      expect(store.acceptEvent("event-retry-enqueue", "page-retry-enqueue", 2_000, 1_000)).toBe("accepted");
      expect(store.duePages(2_000, 1)).toEqual([{ pageId: "page-retry-enqueue" }]);
    } finally { store.close(); }
  });

  it("resumes a persisted leased page after restart when its claim expires", () => {
    const directory = mkdtempSync(join(tmpdir(), "notion-worker-"));
    const path = join(directory, "state.sqlite");
    let store = new SqliteWorkerStore(path);
    try {
      store.acceptEvent("event-claimed", "page-claimed", 1_000, 1_000);
      expect(store.duePages(1_000, 1)).toEqual([{ pageId: "page-claimed" }]);
      store.close(); // Simulate a process crash before finish().
      store = new SqliteWorkerStore(path);
      expect(store.nextDue()).toBe(601_000);
      expect(store.duePages(600_999, 1)).toEqual([]);
      expect(store.duePages(601_000, 1)).toEqual([{ pageId: "page-claimed" }]);
    } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
  });

  it("verifies the signature over exact raw body bytes with constant-time digest comparison", () => {
    const raw = Buffer.from('{"id":"unchanged raw body"}');
    const valid = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
    expect(verifySignature(raw, valid, secret)).toBe(true);
    expect(verifySignature(raw, valid.toUpperCase(), secret)).toBe(false);
    expect(verifySignature(Buffer.from(JSON.stringify(JSON.parse(raw.toString()))), valid, secret)).toBe(true);
    expect(verifySignature(Buffer.from('{ "id":"unchanged raw body"}'), valid, secret)).toBe(false);
  });

  it("deduplicates duplicate delivery and ignores output-only property events", async () => {
    const { url, review, store } = await setup();
    const first = await send(url, payload("evt-1"));
    const duplicate = await send(url, payload("evt-1"));
    const outputOnly = await send(url, payload("evt-output", "page.properties_updated", [ids.warnings, ids.status]));
    expect(first.status).toBe(202);
    expect(duplicate.status).toBe(202);
    expect(outputOnly.status).toBe(200);
    expect(store.events.size).toBe(1);
    expect(review.items).toHaveLength(0); // Debounce is still pending.
  });

  it("fetches and reviews the latest row after debounce; old/out-of-order signals cannot restore old fields", async () => {
    let currentTime = Date.now();
    const { url, notion, review, store } = await setup({ now: () => currentTime });
    await send(url, payload("evt-new"));
    notion.page.properties.Item.title = [{ plain_text: "Changed after event" }];
    await send(url, payload("evt-old", "page.properties_updated", [ids.item]));
    currentTime += 4_000;
    await eventually(() => notion.patches.length === 1);
    expect(review.items).toEqual([{ id: "page-1", name: "Changed after event", bought: false }]);
    expect(notion.patches[0]?.[ids.fingerprint]).toBeDefined();
    expect(store.current("page-1")?.fingerprint).toBe(inputFingerprint({ id: "page-1", name: "Changed after event", bought: false }, false));
  });

  it("discards an in-flight review after the shopper edits the input and schedules the newer value", async () => {
    let release!: () => void;
    const review = new FakeReview();
    review.next = new Promise<void>((resolve) => { release = resolve; });
    let currentTime = Date.now();
    const { url, notion, store } = await setup({ now: () => currentTime, review });
    await send(url, payload("evt-edit-run"));
    currentTime += 4_000;
    await eventually(() => review.items.length === 1);
    notion.page.properties.Item.title = [{ plain_text: "New input" }];
    release();
    await eventually(() => notion.getPageCalls >= 2);
    currentTime += 20;
    await eventually(() => review.items.length === 2);
    expect(notion.patches).toHaveLength(1);
    expect(notion.patches[0]?.[ids.fingerprint]).toEqual({ rich_text: [{ type: "text", text: { content: inputFingerprint({ id: "page-1", name: "New input", bought: false }, false) } }] });
    expect(review.items[1]).toEqual({ id: "page-1", name: "New input", bought: false });
    expect(store.current("page-1")?.fingerprint).not.toBe(inputFingerprint({ id: "page-1", name: "Milk", bought: false }, false));
  });

  it("skips bought and blank rows and never writes shopper properties", async () => {
    let currentTime = Date.now();
    const { url, notion, review } = await setup({ now: () => currentTime });
    notion.page.properties.Bought.checkbox = true;
    await send(url, payload("evt-bought"));
    currentTime += 4_000;
    await new Promise((resolve) => setTimeout(resolve, 175));
    expect(review.items).toHaveLength(0);
    notion.page.properties.Bought.checkbox = false;
    notion.page.properties.Item.title = [{ plain_text: "   " }];
    await send(url, payload("evt-blank"));
    currentTime += 4_000;
    await new Promise((resolve) => setTimeout(resolve, 175));
    expect(review.items).toHaveLength(0);
    expect(notion.patches).toHaveLength(0);
  });

  it("pauses cleanly on revoked access or missing configured output properties", async () => {
    let currentTime = Date.now();
    const notion = new FakeNotion();
    notion.failGet = new WorkerError("revoked", "revoked");
    const { url, store } = await setup({ now: () => currentTime, notion });
    await send(url, payload("evt-revoked"));
    currentTime += 4_000;
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(store.current("page-1")?.busy).toBe(false);
    const subsequent = await send(url, payload("evt-after-revoke"));
    expect(subsequent.status).toBe(503);
  });

  it("pauses after the private review MCP connection is revoked", async () => {
    let currentTime = Date.now();
    const review = new FakeReview();
    review.review = async () => { throw new WorkerError("revoked", "revoked"); };
    const { url, store } = await setup({ now: () => currentTime, review });
    await send(url, payload("evt-mcp-revoked"));
    currentTime += 4_000;
    await eventually(() => store.current("page-1")?.busy === false && store.pages.get("page-1")?.due === Infinity);
    expect((await send(url, payload("evt-after-mcp-revoke"))).status).toBe(503);
  });

  it("schedules MCP quota hints durably instead of retrying every minute", async () => {
    let currentTime = Date.now();
    let calls = 0;
    const review = new FakeReview();
    review.review = async () => { calls += 1; throw new WorkerError("quota", "temporary", 3 * 60 * 60 * 1_000); };
    const { url, store } = await setup({ now: () => currentTime, review });
    await send(url, payload("evt-mcp-quota"));
    currentTime += 4_000;
    await eventually(() => store.pages.get("page-1")?.due === currentTime + 3 * 60 * 60 * 1_000);
    expect(calls).toBe(1);
    expect(store.pages.get("page-1")?.busy).toBe(false);
  });

  it("waits for an aborted page task before closing SQLite on shutdown", async () => {
    let currentTime = Date.now();
    const notion = new FakeNotion();
    let started!: () => void;
    const pageStarted = new Promise<void>((resolve) => { started = resolve; });
    notion.getPage = async (_pageId: string, signal: AbortSignal) => await new Promise<TestPage>((_resolve, reject) => {
      started();
      if (signal.aborted) { reject(signal.reason); return; }
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
    const directory = mkdtempSync(join(tmpdir(), "notion-worker-stop-"));
    const path = join(directory, "state.sqlite");
    const store = new SqliteWorkerStore(path);
    const worker = createShoppingWebhookWorker({ config: makeConfig(0), notion, reviewer: new FakeReview(), store, now: () => currentTime, delay: async () => undefined, debounceMs: 10 });
    workers.push(worker);
    let restarted: SqliteWorkerStore | undefined;
    try {
      await worker.start();
      const address = worker.server.address();
      if (!address || typeof address === "string") throw new Error("Expected local test server address");
      await send(`http://127.0.0.1:${address.port}/webhooks/notion`, payload("evt-stop-in-flight"));
      currentTime += 4_000;
      await pageStarted;
      await worker.stop();
      restarted = new SqliteWorkerStore(path);
      expect(restarted.nextDue()).toBeLessThanOrEqual(currentTime);
      expect(restarted.duePages(currentTime, 1)).toEqual([{ pageId: "page-1" }]);
    } finally {
      await worker.stop();
      restarted?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("drops page events outside the selected database without pausing this worker", async () => {
    const { url, notion } = await setup();
    notion.page.parent.database_id = "another-database";
    await send(url, payload("evt-other-db"));
    await new Promise((resolve) => setTimeout(resolve, 250));
    const allowed = await send(url, payload("evt-in-scope"));
    expect(allowed.status).toBe(202);
  });

  it("pauses after a configured output property disappears", async () => {
    const { url, notion } = await setup();
    delete notion.page.properties.Status;
    await send(url, payload("evt-missing-output"));
    await new Promise((resolve) => setTimeout(resolve, 250));
    const subsequent = await send(url, payload("evt-after-missing-output"));
    expect(subsequent.status).toBe(503);
  });

  it("re-checks inputs before every write retry after a rate limit", async () => {
    let currentTime = Date.now();
    const notion = new FakeNotion();
    let patchAttempts = 0;
    notion.patchError = () => {
      patchAttempts += 1;
      if (patchAttempts === 1) {
        notion.page.properties.Item.title = [{ plain_text: "Changed during rate limit" }];
        currentTime += 4_000;
        return new WorkerError("limited", "temporary", 0);
      }
      return undefined;
    };
    const { url, review } = await setup({ now: () => currentTime, notion });
    await send(url, payload("evt-write-retry"));
    currentTime += 4_000;
    await eventually(() => patchAttempts === 1);
    currentTime += 20;
    await eventually(() => review.items.length === 2);
    expect(notion.patches).toHaveLength(1);
    expect(notion.patches[0]?.[ids.fingerprint]).toEqual({ rich_text: [{ type: "text", text: { content: inputFingerprint({ id: "page-1", name: "Changed during rate limit", bought: false }, false) } }] });
  });

  for (const [scenario, mutate] of [
    ["edited", (page: TestPage) => { page.properties.Item.title = [{ plain_text: "New after write failure" }]; }],
    ["bought", (page: TestPage) => { page.properties.Bought.checkbox = true; }],
    ["moved outside the selected data source", (page: TestPage) => { page.parent.data_source_id = "another-source"; }],
  ] as const) {
    it(`re-preflights through the real Notion client after a PATCH 503 when the row is ${scenario}`, async () => {
      const page = makePage();
      const schema = await new FakeNotion().getDataSource(sourceId);
      let pageReads = 0, patchAttempts = 0;
      const successfulWrites: Array<Record<string, unknown>> = [];
      const notion = new NotionRestClient("notion-token", async (input, init) => {
        const path = new URL(String(input)).pathname;
        if (path === `/v1/data_sources/${sourceId}`) return Response.json(schema);
        if (path === `/v1/pages/${page.id}` && (init?.method ?? "GET") === "GET") {
          pageReads += 1;
          return Response.json(page);
        }
        if (path === `/v1/pages/${page.id}` && init?.method === "PATCH") {
          patchAttempts += 1;
          if (patchAttempts === 1) return new Response("temporary failure", { status: 503, headers: { "retry-after": "0" } });
          successfulWrites.push(JSON.parse(String(init.body)).properties as Record<string, unknown>);
          return new Response(null, { status: 200 });
        }
        return new Response(null, { status: 404 });
      });
      const review = new FakeReview();
      const store = new MemoryStore();
      const worker = createShoppingWebhookWorker({ config: makeConfig(0), notion, reviewer: review, store, delay: async () => { mutate(page); }, debounceMs: 10 });
      workers.push(worker);
      await worker.start();
      const address = worker.server.address();
      if (!address || typeof address === "string") throw new Error("Expected local test server address");
      await send(`http://127.0.0.1:${address.port}/webhooks/notion`, payload(`evt-real-client-${scenario}`));
      await eventually(() => scenario === "edited" ? successfulWrites.length === 1 : pageReads >= 3 && store.current(page.id)?.busy === false);
      expect(patchAttempts).toBe(scenario === "edited" ? 2 : 1);
      if (scenario === "edited") {
        await eventually(() => review.items.length === 2);
        expect(review.items.map((item) => item.name)).toEqual(["Milk", "New after write failure"]);
        expect(successfulWrites[0]?.[ids.fingerprint]).toEqual({ rich_text: [{ type: "text", text: { content: inputFingerprint({ id: page.id, name: "New after write failure", bought: false }, false) } }] });
      } else {
        expect(successfulWrites).toHaveLength(0);
        expect(review.items).toHaveLength(1);
      }
    });
  }
});
