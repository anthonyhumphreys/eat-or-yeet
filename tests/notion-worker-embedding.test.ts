import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createShoppingWebhookWorker, inputFingerprint, NotionRestClient, SqliteWorkerStore, WorkerError, type NotionClient, type ReviewClient, type ReviewResponse, type ShoppingItem, type ShoppingWorker, type ShoppingWorkerConfig, type ShoppingWorkerEvent, type WorkerDependencies } from "../integrations/notion/shopping-worker";

function makeConfig(region = "UK"): ShoppingWorkerConfig {
  return {
    listenHost: "127.0.0.1", listenPort: 0, statePath: ":memory:", notionApiToken: "managed-token", notionWebhookVerificationToken: "verification-token",
    notionDatabaseId: "database-1", notionDataSourceId: "source-1",
    notionProperties: {
      item: { id: "item:1", kind: "title" }, bought: { id: "bought", kind: "checkbox" },
      relatedWarnings: { id: "warnings", kind: "rich_text" }, reviewStatus: { id: "status", kind: "select" },
      reviewedAt: { id: "reviewed", kind: "date" }, inputFingerprint: { id: "fingerprint", kind: "rich_text" },
    },
    reviewMcpUrl: "https://mcp.example.test/mcp", reviewConnectionKey: "managed-key", region,
    statusLabels: { found: "Related warnings found", none: "No related warnings found in covered data", unable: "Unable to review" },
  };
}

class FakeNotion implements NotionClient {
  getPageCalls = 0;
  startupError?: WorkerError;
  pageError?: WorkerError;
  patches: Record<string, unknown>[] = [];
  page: Awaited<ReturnType<NotionClient["getPage"]>> = {
    id: "page-1", parent: { database_id: "database-1", data_source_id: "source-1" },
    properties: {
      Item: { id: "item:1", type: "title", title: [{ plain_text: "Milk" }] }, Bought: { id: "bought", type: "checkbox", checkbox: false },
      Warnings: { id: "warnings", type: "rich_text", rich_text: [] }, Status: { id: "status", type: "select", select: null },
      Reviewed: { id: "reviewed", type: "date", date: null }, Fingerprint: { id: "fingerprint", type: "rich_text", rich_text: [] },
    },
  };
  async getDataSource() {
    if (this.startupError) throw this.startupError;
    const config = makeConfig();
    return {
      id: config.notionDataSourceId, parent: { database_id: config.notionDatabaseId },
      properties: Object.fromEntries(Object.values(config.notionProperties).filter((property) => property !== undefined).map((property) => [property.id, {
        id: property.id, type: property.kind,
        ...(property.kind === "select" ? { select: { options: Object.values(config.statusLabels).map((name) => ({ name })) } } : {}),
      }])),
    };
  }
  async getPage(pageId: string, _signal: AbortSignal) {
    void _signal;
    this.getPageCalls += 1;
    if (this.pageError) throw this.pageError;
    return { ...structuredClone(this.page), id: pageId };
  }
  async patchPage(_pageId: string, properties: Record<string, unknown>) { this.patches.push(properties); }
}

class FakeReview implements ReviewClient {
  calls: Array<{ item: ShoppingItem; region: string }> = [];
  beforeResult?: () => void;
  async review(item: ShoppingItem, region: string): Promise<ReviewResponse> {
    this.calls.push({ item: structuredClone(item), region });
    this.beforeResult?.();
    return { status: "no_related_warnings", notices: [] };
  }
}

const workers: ShoppingWorker[] = [];
const directories: string[] = [];
function makeWorker(options: Partial<WorkerDependencies> = {}) {
  const worker = createShoppingWebhookWorker({
    ...options,
    config: options.config ?? makeConfig(), notion: options.notion ?? new FakeNotion(), reviewer: options.reviewer ?? new FakeReview(),
    store: options.store ?? new SqliteWorkerStore(":memory:"), debounceMs: options.debounceMs ?? 0,
  });
  workers.push(worker);
  return worker;
}
function event(id: string, type: ShoppingWorkerEvent["type"] = "page.created", updatedProperties: string[] = [], pageId = "page-1"): ShoppingWorkerEvent {
  return { id, type, updatedProperties, pageId };
}
function statePath() {
  const directory = mkdtempSync(join(tmpdir(), "notion-worker-embedded-"));
  directories.push(directory);
  return join(directory, "queue.sqlite");
}
async function eventually(predicate: () => boolean) {
  const deadline = Date.now() + 4_000;
  while (!predicate() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
  expect(predicate()).toBe(true);
}
afterEach(async () => {
  await Promise.all(workers.splice(0).map((worker) => worker.stop()));
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  vi.useRealTimers();
});

describe("hosted Notion dependencies", () => {
  it("loads shared clients and provisioning without SQLite, filesystem, or HTTP server imports", () => {
    const modules = ["shopping-core.ts", "template-provision.mjs", "managed/notion-api.ts"].map((path) => new URL(`../integrations/notion/${path}`, import.meta.url).href);
    const script = `
      import { registerHooks } from "node:module";
      const forbidden = new Set(["node:sqlite", "node:fs", "node:fs/promises", "node:http", "sqlite", "fs", "fs/promises", "http"]);
      registerHooks({ resolve(specifier, context, nextResolve) {
        if (forbidden.has(specifier)) throw new Error("Hosted dependency loaded " + specifier);
        return nextResolve(specifier, context);
      } });
      for (const module of ${JSON.stringify(modules)}) await import(module);
      process.stdout.write("loaded");
    `;
    expect(execFileSync(process.execPath, ["--input-type=module", "--eval", script], { encoding: "utf8" })).toBe("loaded");
  });
});

describe("embedded Notion shopping workers", () => {
  it("starts without a listener, gates queued work on validation, and stops once without closing an unused server", async () => {
    const notion = new FakeNotion();
    const reviewer = new FakeReview();
    const store = new SqliteWorkerStore(":memory:");
    const onReady = vi.fn();
    const worker = makeWorker({ notion, reviewer, store, onReady });
    const closeServer = vi.spyOn(worker.server, "close");
    const closeStore = vi.spyOn(store, "close");
    expect(worker.state()).toEqual({ ready: false, paused: false });
    expect(worker.enqueue(event("before-start"))).toBe("accepted");
    expect(notion.getPageCalls).toBe(0);
    onReady.mockImplementation(() => expect(worker.state()).toEqual({ ready: false, paused: false }));
    await worker.start({ listen: false });
    await worker.start();
    expect(worker.server.listening).toBe(false);
    expect(worker.server.address()).toBeNull();
    expect(onReady).toHaveBeenCalledTimes(1);
    await eventually(() => notion.patches.length === 1);
    expect(store.current("page-1")?.fingerprint).toBe(inputFingerprint({ id: "page-1", name: "Milk", bought: false }, false));
    await worker.stop();
    await worker.stop();
    expect(closeServer).not.toHaveBeenCalled();
    expect(closeStore).toHaveBeenCalledTimes(1);
    expect(worker.state().ready).toBe(false);
    expect(worker.enqueue(event("after-stop"))).toBe("paused");
  });

  it("pauses queued valid and invalid input rows when installation admission is refused", async () => {
    vi.useFakeTimers();
    const notion = new FakeNotion();
    const valid = structuredClone(notion.page);
    valid.id = "valid-row";
    const invalid = structuredClone(notion.page);
    invalid.id = "invalid-row";
    invalid.properties!.Item!.title = [{ plain_text: "X".repeat(500) }];
    const pages = new Map([["valid-row", valid], ["invalid-row", invalid]]);
    const getPage = vi.spyOn(notion, "getPage").mockImplementation(async (pageId) => structuredClone(pages.get(pageId)!));
    const getDataSource = vi.spyOn(notion, "getDataSource");
    const patchPage = vi.spyOn(notion, "patchPage");
    const reviewer = new FakeReview();
    const store = new SqliteWorkerStore(":memory:");
    const delay = vi.fn(async () => undefined);
    const refusal = new Error("installation admission refused");
    const admissionStates: Array<{ ready: boolean; paused: boolean }> = [];
    const onReady = vi.fn(() => { admissionStates.push(worker.state()); throw refusal; });
    const worker = makeWorker({ notion, reviewer, store, delay, onReady });
    worker.enqueue(event("valid-before-admission", "page.created", [], "valid-row"));
    worker.enqueue(event("invalid-before-admission", "page.created", [], "invalid-row"));
    await expect(worker.start({ listen: false })).rejects.toBe(refusal);
    await worker.start({ listen: false });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(admissionStates).toEqual([{ ready: false, paused: false }]);
    expect(worker.state()).toEqual({ ready: false, paused: true });
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(getDataSource).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
    expect(getPage).not.toHaveBeenCalled();
    expect(reviewer.calls).toHaveLength(0);
    expect(patchPage).not.toHaveBeenCalled();
    expect(worker.enqueue(event("after-refusal"))).toBe("paused");
    expect(store.duePages(Date.now(), 2).map(({ pageId }) => pageId).sort()).toEqual(["invalid-row", "valid-row"]);
  });

  it("stays non-ready if shutdown begins inside the admission callback", async () => {
    const notion = new FakeNotion();
    let stopping: Promise<void> | undefined;
    const onReady = vi.fn(() => { stopping = worker.stop(); });
    const worker = makeWorker({ notion, onReady });
    worker.enqueue(event("before-admission-stop"));
    await worker.start({ listen: false });
    await stopping;
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(worker.state()).toEqual({ ready: false, paused: false });
    expect(notion.getPageCalls).toBe(0);
  });

  it("closes the standalone listener when stop races with host resolution", async () => {
    const config = makeConfig();
    config.listenHost = "localhost";
    const notion = new FakeNotion();
    const getDataSource = vi.spyOn(notion, "getDataSource");
    const store = new SqliteWorkerStore(":memory:");
    const closeStore = vi.spyOn(store, "close");
    const onReady = vi.fn();
    const worker = makeWorker({ config, notion, store, onReady });
    const starting = worker.start();
    expect(worker.server.listening).toBe(false);
    const stopping = worker.stop();
    try {
      await Promise.all([starting, stopping]);
      expect(worker.server.listening).toBe(false);
      expect(worker.server.address()).toBeNull();
      expect(getDataSource).not.toHaveBeenCalled();
      expect(onReady).not.toHaveBeenCalled();
      expect(closeStore).toHaveBeenCalledTimes(1);
    } finally {
      // Keep a failing reproduction from leaking the listener into other tests.
      if (worker.server.listening) await new Promise<void>((resolve) => worker.server.close(() => resolve()));
    }
  });

  it("closes its store when shutdown races with a rejected listen attempt", async () => {
    const owner = makeWorker();
    await owner.start();
    const address = owner.server.address();
    if (!address || typeof address === "string") throw new Error("Expected local listener address");
    const config = makeConfig();
    config.listenPort = address.port;
    const store = new SqliteWorkerStore(":memory:");
    const closeStore = vi.spyOn(store, "close");
    const worker = makeWorker({ config, store });
    const starting = worker.start();
    const rejected = expect(starting).rejects.toMatchObject({ code: "EADDRINUSE" });
    await Promise.all([rejected, worker.stop()]);
    expect(worker.server.listening).toBe(false);
    expect(worker.state().ready).toBe(false);
    expect(closeStore).toHaveBeenCalledTimes(1);
  });

  it("accepts relevant edits, deduplicates events, ignores output edits, and reports a full installation queue", async () => {
    const store = new SqliteWorkerStore(":memory:", { maxPendingPages: 1, maxDedupeRows: 3 });
    const worker = makeWorker({ store, debounceMs: 60_000 });
    await worker.start({ listen: false });
    expect(worker.enqueue(event("output-only", "page.properties_updated", ["warnings", "status", "fingerprint"]))).toBe("ignored");
    expect(store.nextDue()).toBeUndefined();
    expect(worker.enqueue(event("input-edit", "page.properties_updated", ["item%3A1"]))).toBe("accepted");
    expect(worker.enqueue(event("input-edit", "page.properties_updated", ["item:1"]))).toBe("duplicate");
    expect(worker.enqueue(event("other-page", "page.created", [], "page-2"))).toBe("full");
    expect(worker.enqueue(event("same-page-2"))).toBe("accepted");
    expect(worker.enqueue(event("same-page-3"))).toBe("accepted");
    expect(worker.enqueue(event("dedupe-capacity"))).toBe("full");
    expect(worker.enqueue(event("input-edit"))).toBe("duplicate");
  });

  it("debounces successive verified edits before reading or reviewing the page", async () => {
    vi.useFakeTimers();
    const notion = new FakeNotion();
    const reviewer = new FakeReview();
    const worker = makeWorker({ notion, reviewer, debounceMs: 3_000 });
    await worker.start({ listen: false });
    worker.enqueue(event("first-edit"));
    await vi.advanceTimersByTimeAsync(1_000);
    worker.enqueue(event("second-edit", "page.properties_updated", ["item:1"]));
    await vi.advanceTimersByTimeAsync(2_999);
    expect(notion.getPageCalls).toBe(0);
    expect(reviewer.calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(reviewer.calls).toHaveLength(1);
    expect(notion.patches).toHaveLength(1);
  });

  it.each(["revoked", "missing_property", "invalid_config", "out_of_scope"] as const)("reports startup pause %s while retaining accepted work", async (code) => {
    const notion = new FakeNotion();
    notion.startupError = new WorkerError("startup failed", code);
    const store = new SqliteWorkerStore(":memory:");
    const onReady = vi.fn();
    const onPaused = vi.fn();
    const worker = makeWorker({ notion, store, onReady, onPaused });
    worker.enqueue(event("queued-before-startup"));
    await worker.start({ listen: false });
    expect(worker.state()).toEqual({ ready: false, paused: true });
    expect(onPaused).toHaveBeenCalledExactlyOnceWith(code);
    expect(onReady).not.toHaveBeenCalled();
    expect(notion.getPageCalls).toBe(0);
    expect(store.nextDue()).toBeDefined();
    expect(worker.enqueue(event("after-pause"))).toBe("paused");
  });

  it("releases a paused claim before notifying the installer, then resumes its durable queue in a new embedded worker", async () => {
    const path = statePath();
    const firstStore = new SqliteWorkerStore(path);
    const notion = new FakeNotion();
    notion.pageError = new WorkerError("revoked", "revoked");
    const onPaused = vi.fn(() => expect(firstStore.current("page-1")?.busy).toBe(false));
    const first = makeWorker({ notion, store: firstStore, onPaused });
    await first.start({ listen: false });
    first.enqueue(event("persist-before-pause"));
    await eventually(() => first.state().paused);
    expect(onPaused).toHaveBeenCalledExactlyOnceWith("revoked");
    expect(firstStore.nextDue()).toBeDefined();
    await first.stop();

    const store = new SqliteWorkerStore(path);
    const reviewer = new FakeReview();
    const second = makeWorker({ store, reviewer });
    await second.start({ listen: false });
    await eventually(() => store.nextDue() === undefined);
    expect(reviewer.calls).toHaveLength(1);
    expect(second.server.address()).toBeNull();
    expect(second.enqueue(event("persist-before-pause"))).toBe("duplicate");
  });

  it("awaits an aborted page task before closing its queue", async () => {
    const path = statePath();
    const notion = new FakeNotion();
    let began!: () => void;
    const begun = new Promise<void>((resolve) => { began = resolve; });
    notion.getPage = async (_pageId: string, signal: AbortSignal) => await new Promise<Awaited<ReturnType<NotionClient["getPage"]>>>((_resolve, reject) => {
      began();
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
    const worker = makeWorker({ notion, store: new SqliteWorkerStore(path) });
    await worker.start({ listen: false });
    worker.enqueue(event("interrupted-task"));
    await begun;
    await worker.stop();
    const resumed = new SqliteWorkerStore(path);
    try {
      expect(resumed.duePages(Date.now(), 1)).toEqual([expect.objectContaining({ pageId: "page-1", generation: 1 })]);
    } finally { resumed.close(); }
  });

  it("waits for an in-flight write to finish before shutdown resolves", async () => {
    const notion = new FakeNotion();
    let began!: () => void;
    const begun = new Promise<void>((resolve) => { began = resolve; });
    let release!: () => void;
    const released = new Promise<void>((resolve) => { release = resolve; });
    notion.patchPage = async (_pageId: string, properties: Record<string, unknown>) => {
      began();
      await released;
      notion.patches.push(properties);
    };
    const worker = makeWorker({ notion });
    await worker.start({ listen: false });
    worker.enqueue(event("write-before-disconnect"));
    await begun;
    let stopped = false;
    const stopping = worker.stop().then(() => { stopped = true; });
    await Promise.resolve();
    await Promise.resolve();
    expect(stopped).toBe(false);
    release();
    await stopping;
    expect(notion.patches).toHaveLength(1);
    expect(stopped).toBe(true);
  });

  it("reuses reviews within a region and reviews unchanged input after switching region", async () => {
    const path = statePath();
    const fingerprints: string[] = [];
    for (const [index, region] of ["UK", "UK", "US"].entries()) {
      const store = new SqliteWorkerStore(path);
      const reviewer = new FakeReview();
      const notion = new FakeNotion();
      const worker = makeWorker({ config: makeConfig(region), store, notion, reviewer, fingerprintNamespace: region });
      await worker.start({ listen: false });
      worker.enqueue(event(`region-edit-${index}`));
      await eventually(() => store.nextDue() === undefined);
      expect(reviewer.calls).toHaveLength(index === 1 ? 0 : 1);
      if (index !== 1) {
        expect(reviewer.calls[0]?.region).toBe(region);
        expect(notion.patches).toHaveLength(1);
      }
      fingerprints.push(store.current("page-1")!.fingerprint);
      await worker.stop();
    }
    expect(fingerprints[0]).toBe(fingerprints[1]);
    expect(fingerprints[2]).not.toBe(fingerprints[0]);
  });

  it("keeps the pre-write freshness guard when fingerprints include installation settings", async () => {
    const notion = new FakeNotion();
    const reviewer = new FakeReview();
    reviewer.beforeResult = () => { notion.page.properties!.Item!.title = [{ plain_text: "Oat milk" }]; reviewer.beforeResult = undefined; };
    const worker = makeWorker({ notion, reviewer, fingerprintNamespace: "UK" });
    await worker.start({ listen: false });
    worker.enqueue(event("changed-during-review"));
    await eventually(() => notion.patches.length === 1);
    expect(reviewer.calls.map(({ item }) => item.name)).toEqual(["Milk", "Oat milk"]);
  });

  it.each([{ maxPendingPages: 0 }, { maxPendingPages: 10_001 }, { maxDedupeRows: 1.5 }, { maxDedupeRows: 50_001 }])("rejects an unsafe queue bound %j", (limits) => {
    expect(() => new SqliteWorkerStore(":memory:", limits)).toThrow(expect.objectContaining({ code: "invalid_config" }));
  });
});

describe("bounded installation queue reconciliation", () => {
  it("replaces a full queue with a disjoint full list and retires abandoned claims", () => {
    const store = new SqliteWorkerStore(":memory:", { maxPendingPages: 2 });
    try {
      store.acceptEvent("old-event-1", "old-page-1", 100, 100);
      store.acceptEvent("old-event-2", "old-page-2", 100, 100);
      const abandoned = store.duePages(100, 2);
      // The previous worker has stopped; its outstanding claims can be retired.
      store.reconcilePages(["new-page-1", "new-page-2"], 200, 200);
      expect(store.nextDue()).toBe(200);
      const seeded = store.duePages(200, 10);
      expect(seeded.map(({ pageId }) => pageId).sort()).toEqual(["new-page-1", "new-page-2"]);
      expect(store.acceptEvent("overflow", "page-3", 200, 200)).toBe("full");
      for (const claim of seeded) store.finish(claim.pageId, claim.generation, claim.claimToken, 201);
      for (const claim of abandoned) store.release(claim.pageId, claim.generation, claim.claimToken, 202);
      expect(store.nextDue()).toBeUndefined();
      expect(store.acceptEvent("clearable-event", "clearable-page", 300, 300)).toBe("accepted");
      store.reconcilePages([], 300, 300);
      expect(store.duePages(300, 10)).toEqual([]);
      expect(store.acceptEvent("clearable-event", "clearable-page", 301, 301)).toBe("duplicate");
    } finally { store.close(); }
  });

  it("preserves event deduplication and completed fingerprints while advancing seeded generations", () => {
    const store = new SqliteWorkerStore(":memory:", { maxPendingPages: 2 });
    try {
      store.acceptEvent("completed-event", "kept-page", 100, 100);
      const completed = store.duePages(100, 1)[0]!;
      store.markReviewed(completed.pageId, completed.generation, completed.claimToken, "kept-fingerprint", 101);
      store.acceptEvent("retired-event", "retired-page", 110, 110);
      const retired = store.duePages(110, 1)[0]!;
      store.markReviewed(retired.pageId, retired.generation, retired.claimToken, "retired-fingerprint", 111);
      store.acceptEvent("pending-event", "pending-page", 120, 120);
      const abandoned = store.duePages(120, 1)[0]!;

      store.reconcilePages(["kept-page", "pending-page"], 200, 200);
      expect(store.current("kept-page")?.fingerprint).toBe("kept-fingerprint");
      expect(store.current("retired-page")?.fingerprint).toBe("retired-fingerprint");
      expect(store.acceptEvent("completed-event", "kept-page", 201, 201)).toBe("duplicate");
      expect(store.acceptEvent("retired-event", "retired-page", 201, 201)).toBe("duplicate");
      const seeded = store.duePages(200, 10);
      expect(seeded.map(({ pageId, generation }) => ({ pageId, generation }))).toEqual([
        { pageId: "kept-page", generation: completed.generation + 1 },
        { pageId: "pending-page", generation: abandoned.generation + 1 },
      ]);
      store.markReviewed(abandoned.pageId, abandoned.generation, abandoned.claimToken, "stale-fingerprint", 201);
      expect(store.current("pending-page")?.fingerprint).toBe("");
      for (const claim of seeded) store.finish(claim.pageId, claim.generation, claim.claimToken, 202);
      expect(store.nextDue()).toBeUndefined();
    } finally { store.close(); }
  });

  it("rejects duplicate or oversized lists before changing queued pages", () => {
    const store = new SqliteWorkerStore(":memory:", { maxPendingPages: 2 });
    try {
      store.acceptEvent("original-event", "original-page", 100, 100);
      for (const invalid of [["new-page", "new-page"], ["new-page-1", "new-page-2", "new-page-3"]]) {
        expect(() => store.reconcilePages(invalid, 200, 200)).toThrow(expect.objectContaining({ code: "invalid_config" }));
        expect(store.nextDue()).toBe(100);
        expect(store.current("new-page")).toBeUndefined();
        expect(store.current("new-page-1")).toBeUndefined();
      }
      expect(store.duePages(100, 10)).toEqual([expect.objectContaining({ pageId: "original-page", generation: 1 })]);
      expect(store.acceptEvent("original-event", "original-page", 201, 201)).toBe("duplicate");
    } finally { store.close(); }
  });

  it("rolls back membership and partial inserts if reconciliation fails during seeding", () => {
    class FailingReconciliationStore extends SqliteWorkerStore {
      failPage?: string;
      override schedule(pageId: string, dueAt: number, touchedAt: number) {
        if (pageId === this.failPage) throw new Error("seed failed");
        super.schedule(pageId, dueAt, touchedAt);
      }
    }
    const store = new FailingReconciliationStore(":memory:", { maxPendingPages: 2 });
    try {
      store.acceptEvent("old-event-1", "old-page-1", 100, 100);
      store.acceptEvent("old-event-2", "old-page-2", 100, 100);
      store.failPage = "new-page-2";
      expect(() => store.reconcilePages(["new-page-1", "new-page-2"], 200, 200)).toThrow("seed failed");
      expect(store.current("new-page-1")).toBeUndefined();
      expect(store.nextDue()).toBe(100);
      expect(store.duePages(100, 10).map(({ pageId, generation }) => ({ pageId, generation }))).toEqual([
        { pageId: "old-page-1", generation: 1 }, { pageId: "old-page-2", generation: 1 },
      ]);
      expect(store.acceptEvent("old-event-1", "old-page-1", 201, 201)).toBe("duplicate");
    } finally { store.close(); }
  });

  it("caps new and completed-page schedules while allowing retries and edits for a pending row", () => {
    const store = new SqliteWorkerStore(":memory:", { maxPendingPages: 1 });
    try {
      store.schedule("completed-page", 100, 100);
      const completed = store.duePages(100, 1)[0]!;
      store.markReviewed(completed.pageId, completed.generation, completed.claimToken, "completed-fingerprint", 101);
      store.acceptEvent("pending-event", "pending-page", 110, 110);
      const claimed = store.duePages(110, 1)[0]!;
      expect(() => store.schedule("new-page", 200, 200)).toThrow(expect.objectContaining({ code: "temporary" }));
      expect(() => store.schedule("completed-page", 200, 200)).toThrow(expect.objectContaining({ code: "temporary" }));
      expect(store.current("new-page")).toBeUndefined();
      expect(store.current("completed-page")?.fingerprint).toBe("completed-fingerprint");

      store.schedule("pending-page", 300, 200);
      store.finish(claimed.pageId, claimed.generation, claimed.claimToken, 201);
      expect(store.nextDue()).toBe(300);
      const retry = store.duePages(300, 1)[0]!;
      expect(retry.generation).toBe(claimed.generation + 1);
      store.finish(retry.pageId, retry.generation, retry.claimToken, 301);
      expect(store.nextDue()).toBeUndefined();
      store.schedule("completed-page", 400, 400);
      expect(store.duePages(400, 1)[0]).toMatchObject({ pageId: "completed-page", generation: completed.generation + 1 });
    } finally { store.close(); }
  });
});

describe("request-time Notion credentials", () => {
  it("loads the current access token for each request and retry", async () => {
    let token = "first-token";
    const provider = vi.fn(async () => token);
    const headers: string[] = [];
    const client = new NotionRestClient(provider, async (_input, init) => {
      headers.push(new Headers(init?.headers).get("authorization")!);
      if (headers.length === 1) { token = "second-token"; return new Response(null, { status: 429, headers: { "retry-after": "0" } }); }
      return new Response(JSON.stringify({ id: "page-1" }));
    });
    await client.getPage("page-1", new AbortController().signal);
    token = "third-token";
    await client.patchPage("page-1", {}, new AbortController().signal);
    expect(headers).toEqual(["Bearer first-token", "Bearer second-token", "Bearer third-token"]);
    expect(provider).toHaveBeenCalledTimes(3);
  });

  it("retains fatal credential-provider errors so a denied refresh pauses the worker", async () => {
    const denied = new WorkerError("refresh was denied", "revoked");
    const fetcher = vi.fn();
    const client = new NotionRestClient(async () => { throw denied; }, fetcher);
    await expect(client.getPage("page-1", new AbortController().signal)).rejects.toBe(denied);
    await expect(client.patchPage("page-1", {}, new AbortController().signal)).rejects.toBe(denied);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
