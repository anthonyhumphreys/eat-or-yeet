import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildDatabasePayload } from "../integrations/notion/template/provision.mjs";
import { ManagedRuntime } from "../integrations/notion/managed/runtime.ts";
import { ManagedStore } from "../integrations/notion/managed/store.ts";
import { NotionOAuthApi } from "../integrations/notion/managed/notion-api.ts";
import type { Authorization, Installation, ManagedConfig, Region } from "../integrations/notion/managed/types.ts";
import type { NotionClient, ReviewClient, ReviewResponse, ShoppingItem, ShoppingWorkerEvent } from "../integrations/notion/shopping-worker.ts";
import oreo from "./fixtures/open-food-facts-oreo.json";

type Page = Awaited<ReturnType<NotionClient["getPage"]>>;
type Schema = NonNullable<Awaited<ReturnType<NotionClient["getDataSource"]>>["properties"]>;
type Call = { url: URL; method: string; headers: Headers; init: RequestInit };
type Handler = (call: Call) => Response | undefined | Promise<Response | undefined>;
const noWarnings: ReviewResponse = { status: "no_related_warnings", notices: [] };
const cleanups: Array<() => void> = [];
type Harness = { directory: string; config: ManagedConfig; store: ManagedStore; reviewer: FakeReviewer; runtime: ManagedRuntime; fixtures: NotionFixture[]; storeClosed?: boolean };
const harnesses: Harness[] = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function gate() {
  const value = deferred<void>();
  cleanups.push(() => value.resolve());
  return value;
}
function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}
function event(id: string, pageId: string): ShoppingWorkerEvent {
  return { id, pageId, type: "page.created", updatedProperties: [] };
}
async function ioTurn() { await new Promise<void>((resolve) => setImmediate(resolve)); }
async function eventually(predicate: () => boolean) {
  for (let attempt = 0; attempt < 200 && !predicate(); attempt += 1) {
    await ioTurn();
    await vi.advanceTimersByTimeAsync(10);
  }
  expect(predicate()).toBe(true);
}
async function advanceUntil(predicate: () => boolean, milliseconds = 12_000) {
  for (let elapsed = 0; elapsed < milliseconds && !predicate(); elapsed += 100) {
    await vi.advanceTimersByTimeAsync(100);
    await ioTurn();
  }
  expect(predicate()).toBe(true);
}

class NotionFixture {
  readonly templatePageId: string;
  readonly databaseId: string;
  readonly dataSourceId: string;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly properties: Schema;
  readonly pages = new Map<string, Page>();
  readonly calls: Call[] = [];
  readonly patches: Array<{ pageId: string; properties: Record<string, unknown> }> = [];
  handler?: Handler;
  constructor(readonly name: string) {
    this.templatePageId = `${name}-template`;
    this.databaseId = `${name}-database`;
    this.dataSourceId = `${name}-source`;
    this.accessToken = `${name}-access-private`;
    this.refreshToken = `${name}-refresh-private`;
    const definitions = buildDatabasePayload(this.templatePageId).initial_data_source.properties as Record<string, Record<string, unknown>>;
    this.properties = Object.fromEntries(Object.entries(definitions).map(([name, definition], index) => {
      const type = Object.keys(definition)[0];
      return [name, { id: `${this.name}-property-${index}`, type, ...(type === "select" ? { select: definition.select } : {}) }];
    })) as Schema;
  }
  authorization(): Authorization {
    return { ownerId: `${this.name}-owner`, workspaceId: `${this.name}-workspace`, botId: `${this.name}-bot`, templatePageId: this.templatePageId, accessToken: this.accessToken, refreshToken: this.refreshToken };
  }
  row(id: string, name: string, details: Record<string, string | boolean> = {}): Page {
    const properties = Object.fromEntries(Object.entries(this.properties).map(([displayName, schema]) => {
      const value = details[displayName] ?? (displayName === "Item" ? name : displayName === "Bought" ? false : "");
      const entry = { id: schema.id, type: schema.type,
        ...(schema.type === "title" ? { title: [{ plain_text: String(value) }] } : {}),
        ...(schema.type === "rich_text" ? { rich_text: value ? [{ plain_text: String(value) }] : [] } : {}),
        ...(schema.type === "checkbox" ? { checkbox: value === true } : {}),
        ...(schema.type === "select" ? { select: null } : {}),
        ...(schema.type === "date" ? { date: null } : {}),
      };
      return [displayName, entry];
    }));
    const page = { id, parent: { type: "data_source_id", data_source_id: this.dataSourceId }, properties };
    this.pages.set(id, page);
    return page;
  }
  respond(call: Call): Response {
    const path = call.url.pathname;
    if (path === `/v1/pages/${this.templatePageId}`) return json({ id: this.templatePageId, object: "page" });
    if (path === `/v1/blocks/${this.templatePageId}/children`) return json({ results: [{ id: this.databaseId, type: "child_database", has_children: false }], has_more: false, next_cursor: null });
    if (path === `/v1/databases/${this.databaseId}`) return json({ id: this.databaseId, data_sources: [{ id: this.dataSourceId }] });
    if (path === `/v1/data_sources/${this.dataSourceId}`) return json({ id: this.dataSourceId, parent: { type: "database_id", database_id: this.databaseId }, properties: this.properties });
    if (path === `/v1/data_sources/${this.dataSourceId}/query`) return json({ results: [...this.pages.values()].filter((page) => !page.properties?.Bought?.checkbox).map(({ id }) => ({ id })), has_more: false, next_cursor: null });
    if (path === "/v1/oauth/revoke") return json({});
    const pageId = decodeURIComponent(path.replace(/^\/v1\/pages\//, ""));
    const page = this.pages.get(pageId);
    if (!page) throw new Error(`Unexpected fixture request ${call.method} ${call.url.href}`);
    if (call.method === "GET") return json(page);
    if (call.method === "PATCH") {
      const { properties } = JSON.parse(String(call.init.body)) as { properties: Record<string, unknown> };
      this.patches.push({ pageId, properties });
      return json({ id: pageId });
    }
    throw new Error(`Unexpected fixture request ${call.method} ${call.url.href}`);
  }
}
class FakeReviewer implements ReviewClient {
  readonly calls: Array<{ item: ShoppingItem; region: string; signal: AbortSignal }> = [];
  handler?: ReviewClient["review"];
  close = vi.fn(async () => undefined);
  async review(item: ShoppingItem, region: string, signal: AbortSignal): Promise<ReviewResponse> {
    this.calls.push({ item: structuredClone(item), region, signal });
    return this.handler ? await this.handler(item, region, signal) : noWarnings;
  }
}
function harness(fixtures = [new NotionFixture("one")], overrides: Partial<ManagedConfig> = {}): Harness {
  const directory = mkdtempSync(join(tmpdir(), "notion-managed-runtime-"));
  const config: ManagedConfig = {
    enabled: true, publicOrigin: "https://installer.example.test", websiteOrigin: "https://example.test", listenHost: "127.0.0.1", listenPort: 0,
    stateDirectory: directory, clientId: "client-private", clientSecret: "secret-private", encryptionKey: Buffer.alloc(32, 9),
    webhookVerificationToken: "verification-private", notionIntegrationId: "integration", notionSubscriptionId: "subscription", reviewMcpUrl: "https://example.test/mcp/notion",
    reviewConnectionKey: "review-key-private", maxInstallations: 10, dailyReviewsPerInstallation: 100, dailyReviewsGlobal: 200, ...overrides,
  };
  const store = new ManagedStore(join(directory, "managed.sqlite"), config.encryptionKey, config.maxInstallations);
  const reviewer = new FakeReviewer();
  const fetcher: typeof fetch = async (input, init = {}) => {
    const call = { url: new URL(String(input)), method: init.method ?? "GET", headers: new Headers(init.headers), init };
    const fixture = fixtures.find((entry) => call.url.pathname.includes(entry.templatePageId) || call.url.pathname.includes(entry.databaseId) || call.url.pathname.includes(entry.dataSourceId) || [...entry.pages.keys()].some((id) => call.url.pathname.endsWith(`/pages/${id}`)) || call.headers.get("authorization") === `Bearer ${entry.accessToken}` || String(init.body).includes(entry.refreshToken) || String(init.body).includes(entry.accessToken)) ?? fixtures[0];
    fixture.calls.push(call);
    return await fixture.handler?.(call) ?? fixture.respond(call);
  };
  const api = new NotionOAuthApi(config.clientId, config.clientSecret, `${config.publicOrigin}/notion/callback`, fetcher);
  const runtime = new ManagedRuntime(config, store, api, reviewer, fetcher);
  const result = { directory, config, store, reviewer, runtime, fixtures };
  harnesses.push(result);
  return result;
}
async function install(context: Harness, fixture = context.fixtures[0], region: Region = "UK"): Promise<Installation> {
  const installation = context.store.authorize(fixture.authorization(), region, Date.now());
  await context.runtime.activate(installation.id);
  await eventually(() => context.store.get(installation.id)?.status === "active");
  return context.store.get(installation.id)!;
}
function queueRows(context: Harness, id: string) {
  const db = new DatabaseSync(join(context.directory, `queue-${id}.sqlite`), { readOnly: true });
  try { return db.prepare("SELECT page_id AS pageId,pending,last_fingerprint AS fingerprint FROM pending_pages ORDER BY page_id").all() as Array<{ pageId: string; pending: number; fingerprint: string | null }>; }
  finally { db.close(); }
}
function warningText(properties: Record<string, unknown>, propertyId: string): string {
  const property = properties[propertyId] as { rich_text: Array<{ text: { content: string } }> };
  return property.rich_text.map(({ text }) => text.content).join("");
}

function holdRotatingRefresh(fixture: NotionFixture, release: Promise<void>) {
  const state: { calls: number; signal?: AbortSignal } = { calls: 0 };
  fixture.handler = async (call) => {
    if (call.url.pathname === "/v1/oauth/token") {
      state.calls += 1;
      const signal = call.init.signal!;
      state.signal = signal;
      signal.throwIfAborted();
      await new Promise<void>((resolve, reject) => {
        const abort = () => reject(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
        void release.then(() => { signal.removeEventListener("abort", abort); resolve(); });
      });
      return json({ access_token: "held-rotated-access", refresh_token: "held-rotated-refresh" });
    }
    if (call.url.pathname.endsWith("/query") && call.headers.get("authorization") === `Bearer ${fixture.accessToken}`) return json({}, 401);
    return undefined;
  };
  return state;
}

beforeEach(() => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] }); });
afterEach(async () => {
  for (const release of cleanups.splice(0)) release();
  for (const context of harnesses.splice(0)) {
    await context.runtime.stop();
    if (!context.storeClosed) context.store.close();
    rmSync(context.directory, { force: true, recursive: true });
  }
  vi.useRealTimers();
});

describe("managed Notion runtime", () => {
  it("binds the copied template, becomes active, and reviews Milk and Oreo using only the output fields", async () => {
    const fixture = new NotionFixture("shopping");
    fixture.row("milk-row", "Milk");
    fixture.row("oreo-row", oreo.product.product_name, { Brand: oreo.product.brands, Barcode: oreo.product.code });
    const context = harness([fixture]);
    await context.runtime.start();
    const installation = await install(context);
    expect(installation.binding).toMatchObject({ templatePageId: fixture.templatePageId, databaseId: fixture.databaseId, dataSourceId: fixture.dataSourceId });
    expect(context.runtime.state(installation.id)).toEqual({ ready: true, paused: false });
    expect(context.runtime.enqueue(installation.id, event("milk-event", "milk-row"))).toBe("accepted");
    expect(context.runtime.enqueue(installation.id, event("oreo-event", "oreo-row"))).toBe("accepted");
    expect(context.runtime.enqueue(installation.id, event("oreo-event", "oreo-row"))).toBe("duplicate");
    await advanceUntil(() => fixture.patches.length === 2);
    expect(context.reviewer.calls.map(({ item, region }) => ({ name: item.name, barcode: item.barcode, region }))).toEqual(expect.arrayContaining([
      { name: "Milk", barcode: undefined, region: "UK" }, { name: "Oreo", barcode: oreo.product.code, region: "UK" },
    ]));
    const binding = installation.binding!;
    const outputIds = [binding.properties.relatedWarnings.id, binding.properties.reviewStatus.id, binding.properties.reviewedAt.id, binding.properties.inputFingerprint.id].sort();
    for (const patch of fixture.patches) {
      expect(Object.keys(patch.properties).sort()).toEqual(outputIds);
      expect(patch.properties[binding.properties.reviewStatus.id]).toEqual({ select: { name: binding.statusLabels.none } });
    }
    expect(context.store.budget(installation.id, Date.now(), 100, 200)).toMatchObject({ used: 2, globalUsed: 2 });
    expect(queueRows(context, installation.id)).toEqual([expect.objectContaining({ pageId: "milk-row", pending: 0, fingerprint: expect.any(String) }), expect.objectContaining({ pageId: "oreo-row", pending: 0, fingerprint: expect.any(String) })]);
    expect(statSync(context.directory).mode & 0o777).toBe(0o700);
    expect(statSync(join(context.directory, `queue-${installation.id}.sqlite`)).mode & 0o777).toBe(0o600);
    expect(fixture.calls.some(({ url }) => url.pathname.includes("/search"))).toBe(false);
  });

  it("keeps queued invalid rows stopped when the managed readiness update fails, then retries admission", async () => {
    const fixture = new NotionFixture("readiness-failure");
    fixture.row("invalid-ready-row", "x".repeat(201));
    const context = harness([fixture]);
    const installation = context.store.authorize(fixture.authorization(), "UK", Date.now());
    const ready = vi.spyOn(context.store, "ready").mockImplementationOnce(() => { throw new Error("Private installation readiness update failed"); });
    await context.runtime.activate(installation.id, { reconcile: true });
    await eventually(() => ready.mock.calls.length === 1);
    await vi.advanceTimersByTimeAsync(10_000);
    await ioTurn();
    expect(context.store.get(installation.id)).toMatchObject({ status: "setup_failed", errorCode: "temporarily_unavailable" });
    expect(context.runtime.state(installation.id)).toEqual({ ready: false, paused: true });
    expect(context.reviewer.calls).toHaveLength(0);
    expect(fixture.patches).toHaveLength(0);
    expect(fixture.calls.filter(({ method }) => method === "PATCH")).toHaveLength(0);
    expect(queueRows(context, installation.id)).toEqual([expect.objectContaining({ pageId: "invalid-ready-row", pending: 1 })]);
    expect(context.runtime.enqueue(installation.id, event("failed-ready-event", "invalid-ready-row"))).toBe("ignored");
    fixture.row("invalid-ready-row", "Milk");
    await context.runtime.activate(installation.id, { reconcile: true });
    await eventually(() => context.store.get(installation.id)?.status === "active");
    await advanceUntil(() => fixture.patches.length === 1);
    expect(ready).toHaveBeenCalledTimes(2);
    expect(context.runtime.state(installation.id)).toEqual({ ready: true, paused: false });
    expect(context.reviewer.calls.map(({ item }) => item.name)).toEqual(["Milk"]);
    expect(queueRows(context, installation.id)).toEqual([expect.objectContaining({ pageId: "invalid-ready-row", pending: 0 })]);
  });

  it("keeps workspace queues, deduplication, country, and pauses independent", async () => {
    const first = new NotionFixture("first"), second = new NotionFixture("second");
    first.row("first-row", "Milk"); second.row("second-row", "Oreo");
    const context = harness([first, second]);
    const a = await install(context, first, "UK"), b = await install(context, second, "US");
    expect(context.runtime.enqueue(a.id, event("same-event-id", "first-row"))).toBe("accepted");
    expect(context.runtime.enqueue(b.id, event("same-event-id", "second-row"))).toBe("accepted");
    await context.runtime.pause(a.id);
    expect(context.store.get(a.id)?.status).toBe("paused");
    expect(context.store.get(b.id)?.status).toBe("active");
    await advanceUntil(() => second.patches.length === 1);
    expect(first.patches).toHaveLength(0);
    expect(context.reviewer.calls.map(({ item, region }) => [item.name, region])).toEqual([["Oreo", "US"]]);
    expect(queueRows(context, a.id)).toEqual([expect.objectContaining({ pageId: "first-row", pending: 1 })]);
    expect(queueRows(context, b.id)).toEqual([expect.objectContaining({ pageId: "second-row", pending: 0 })]);
    await context.runtime.activate(a.id);
    await eventually(() => context.store.get(a.id)?.status === "active");
    await advanceUntil(() => first.patches.length === 1);
    expect(context.store.get(b.id)?.status).toBe("active");
    expect(context.store.budget(a.id, Date.now(), 100, 200)).toMatchObject({ used: 1, globalUsed: 2 });
  });

  it("rotates once for concurrent 401s and compares against the retained old access token", async () => {
    const fixture = new NotionFixture("refresh");
    fixture.row("refresh-a", "Milk"); fixture.row("refresh-b", "Oreo");
    const context = harness([fixture]);
    const installation = await install(context);
    const releaseRefresh = gate();
    let refreshes = 0, unauthorized = 0;
    const replace = vi.spyOn(context.store, "replaceCredentials");
    fixture.handler = async (call) => {
      if (call.url.pathname === "/v1/oauth/token") {
        refreshes += 1;
        expect(JSON.parse(String(call.init.body))).toEqual({ grant_type: "refresh_token", refresh_token: fixture.refreshToken });
        await releaseRefresh.promise;
        return json({ access_token: "rotated-access", refresh_token: "rotated-refresh" });
      }
      if (call.method === "GET" && call.url.pathname.includes("/pages/refresh-") && call.headers.get("authorization") === `Bearer ${fixture.accessToken}`) {
        unauthorized += 1;
        return json({}, 401);
      }
      return undefined;
    };
    context.runtime.enqueue(installation.id, event("refresh-event-a", "refresh-a"));
    context.runtime.enqueue(installation.id, event("refresh-event-b", "refresh-b"));
    await advanceUntil(() => unauthorized === 2);
    expect(refreshes).toBe(1);
    expect(context.store.getCredentials(installation.id)).toEqual({ accessToken: fixture.accessToken, refreshToken: fixture.refreshToken });
    releaseRefresh.resolve();
    await advanceUntil(() => fixture.patches.length === 2);
    expect(refreshes).toBe(1);
    expect(replace).toHaveBeenCalledExactlyOnceWith(installation.id, fixture.accessToken, { accessToken: "rotated-access", refreshToken: "rotated-refresh" });
    expect(context.store.getCredentials(installation.id)).toEqual({ accessToken: "rotated-access", refreshToken: "rotated-refresh" });
    expect(context.store.get(installation.id)?.status).toBe("active");
    expect(fixture.calls.filter(({ method }) => method === "PATCH").every(({ headers }) => headers.get("authorization") === "Bearer rotated-access")).toBe(true);
  });

  it("reuses the newer token when an old request reports 401 after rotation", async () => {
    const fixture = new NotionFixture("late");
    fixture.row("late-a", "Milk"); fixture.row("late-b", "Oreo");
    const context = harness([fixture]);
    const installation = await install(context);
    const late401 = gate();
    let refreshes = 0, held = false;
    fixture.handler = async (call) => {
      if (call.url.pathname === "/v1/oauth/token") { refreshes += 1; return json({ access_token: "newer-access", refresh_token: "newer-refresh" }); }
      if (call.method === "GET" && call.headers.get("authorization") === `Bearer ${fixture.accessToken}`) {
        if (call.url.pathname.endsWith("/pages/late-b")) { held = true; await late401.promise; }
        return json({}, 401);
      }
      return undefined;
    };
    context.runtime.enqueue(installation.id, event("late-b-event", "late-b"));
    context.runtime.enqueue(installation.id, event("late-a-event", "late-a"));
    await advanceUntil(() => held && context.store.getCredentials(installation.id)?.accessToken === "newer-access");
    late401.resolve();
    await advanceUntil(() => fixture.patches.length === 2);
    expect(refreshes).toBe(1);
    expect(context.store.get(installation.id)?.status).toBe("active");
  });

  it("cancels copied-template discovery on pause and resumes setup without hanging", async () => {
    const fixture = new NotionFixture("discovery");
    const context = harness([fixture]);
    const installation = context.store.authorize(fixture.authorization(), "UK", Date.now());
    let held = false, aborted = false;
    fixture.handler = async (call) => {
      if (!call.url.pathname.includes("/blocks/")) return undefined;
      held = true;
      return await new Promise<Response>((_resolve, reject) => {
        call.init.signal!.addEventListener("abort", () => { aborted = true; reject(call.init.signal!.reason); }, { once: true });
      });
    };
    const activation = context.runtime.activate(installation.id);
    await eventually(() => held);
    await context.runtime.pause(installation.id);
    await activation;
    expect(aborted).toBe(true);
    expect(context.store.get(installation.id)).toMatchObject({ status: "paused" });
    expect(context.runtime.state(installation.id)).toBeUndefined();
    fixture.handler = undefined;
    await context.runtime.activate(installation.id, { reconcile: true });
    await eventually(() => context.store.get(installation.id)?.status === "active");
    expect(context.runtime.state(installation.id)).toEqual({ ready: true, paused: false });
  });

  it("does not let an older queued activation restart processing after pause", async () => {
    const fixture = new NotionFixture("queued-activation");
    const context = harness([fixture]);
    const installation = context.store.authorize(fixture.authorization(), "UK", Date.now());
    let discoveries = 0;
    fixture.handler = async (call) => {
      if (!call.url.pathname.includes("/blocks/")) return undefined;
      discoveries += 1;
      if (discoveries > 1) return undefined;
      return await new Promise<Response>((_resolve, reject) => {
        call.init.signal!.addEventListener("abort", () => reject(call.init.signal!.reason), { once: true });
      });
    };
    const first = context.runtime.activate(installation.id);
    await eventually(() => discoveries === 1);
    const queued = context.runtime.activate(installation.id);
    const pausing = context.runtime.pause(installation.id);
    await Promise.all([first, queued, pausing]);
    expect(discoveries).toBe(1);
    expect(context.store.get(installation.id)?.status).toBe("paused");
    expect(context.runtime.state(installation.id)).toBeUndefined();
  });

  it("waits for held reviews to drain on disconnect, deletes queues, and starts no later write", async () => {
    const fixture = new NotionFixture("review-stop");
    for (const id of ["held-a", "held-b", "queued-c"]) fixture.row(id, "Milk");
    const context = harness([fixture]);
    const installation = await install(context);
    const releaseReview = gate();
    context.reviewer.handler = async () => { await releaseReview.promise; return noWarnings; };
    for (const id of ["held-a", "held-b", "queued-c"]) context.runtime.enqueue(installation.id, event(`event-${id}`, id));
    await advanceUntil(() => context.reviewer.calls.length === 2);
    let disconnected = false;
    const disconnecting = context.runtime.disconnect(installation.id).then((value) => { disconnected = true; return value; });
    await ioTurn();
    expect(context.store.get(installation.id)?.status).toBe("disconnecting");
    expect(disconnected).toBe(false);
    expect(context.reviewer.calls.every(({ signal }) => signal.aborted)).toBe(true);
    expect(context.runtime.enqueue(installation.id, event("after-disconnect", "held-a"))).toBe("ignored");
    releaseReview.resolve();
    await expect(disconnecting).resolves.toEqual({ permissionRemoved: true });
    expect(context.store.get(installation.id)).toBeUndefined();
    expect(readdirSync(context.directory).some((name) => name.startsWith(`queue-${installation.id}`))).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(context.reviewer.calls).toHaveLength(2);
    expect(fixture.patches).toHaveLength(0);
    expect(fixture.calls.filter(({ url }) => url.pathname === "/v1/oauth/revoke")).toHaveLength(1);
  });

  it("does not report disconnect complete until an already-started patch finishes", async () => {
    const fixture = new NotionFixture("patch-stop");
    fixture.row("patch-row", "Milk"); fixture.row("later-row", "Oreo");
    const context = harness([fixture]);
    const installation = await install(context);
    const releasePatch = gate();
    let held = false;
    fixture.handler = async (call) => {
      if (call.method !== "PATCH") return undefined;
      held = true;
      await releasePatch.promise;
      return fixture.respond(call);
    };
    context.runtime.enqueue(installation.id, event("patch-event", "patch-row"));
    await advanceUntil(() => held);
    context.runtime.enqueue(installation.id, event("queued-later", "later-row"));
    let disconnected = false;
    const disconnecting = context.runtime.disconnect(installation.id).then((value) => { disconnected = true; return value; });
    await ioTurn();
    expect(disconnected).toBe(false);
    releasePatch.resolve();
    await expect(disconnecting).resolves.toEqual({ permissionRemoved: true });
    expect(fixture.patches).toHaveLength(1);
    expect(fixture.patches[0].pageId).toBe("patch-row");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fixture.patches).toHaveLength(1);
    expect(context.store.get(installation.id)).toBeUndefined();
    expect(readdirSync(context.directory).some((name) => name.startsWith(`queue-${installation.id}`))).toBe(false);
  });

  it("reconciles edits made while paused and skips bought rows on resume", async () => {
    const fixture = new NotionFixture("resume");
    fixture.row("changed-row", "Milk"); fixture.row("bought-row", "Oreo", { Bought: true });
    const context = harness([fixture]);
    const installation = await install(context);
    context.runtime.enqueue(installation.id, event("initial-row", "changed-row"));
    await advanceUntil(() => fixture.patches.length === 1);
    await context.runtime.pause(installation.id);
    fixture.row("changed-row", "Oat milk");
    fixture.row("new-row", "Bread");
    expect(context.runtime.enqueue(installation.id, event("paused-edit", "changed-row"))).toBe("ignored");
    await context.runtime.activate(installation.id, { reconcile: true });
    await eventually(() => context.store.get(installation.id)?.status === "active");
    await advanceUntil(() => fixture.patches.length === 3);
    expect(context.reviewer.calls.map(({ item }) => item.name).sort()).toEqual(["Bread", "Milk", "Oat milk"]);
    expect(queueRows(context, installation.id).map(({ pageId }) => pageId)).toEqual(["changed-row", "new-row"]);
    const queries = fixture.calls.filter(({ url }) => url.pathname.endsWith("/query"));
    expect(queries).toHaveLength(1);
    expect(JSON.parse(String(queries[0].init.body))).toMatchObject({ filter: { property: installation.binding!.properties.bought!.id, checkbox: { equals: false } } });
  });

  it("reviews unchanged inputs again after a country change and preserves regional results", async () => {
    const fixture = new NotionFixture("country");
    fixture.row("country-row", "Milk");
    const context = harness([fixture]);
    context.reviewer.handler = async (_item, region) => region === "US" ? { status: "related_warnings", notices: [{ title: "US milk warning", url: "https://www.fda.gov/example" }], coverageSummary: "US covered data" } : { ...noWarnings, coverageSummary: "UK covered data" };
    const installation = await install(context);
    context.runtime.enqueue(installation.id, event("country-first", "country-row"));
    await advanceUntil(() => fixture.patches.length === 1);
    const before = queueRows(context, installation.id)[0].fingerprint;
    context.runtime.enqueue(installation.id, event("country-unchanged", "country-row"));
    await advanceUntil(() => queueRows(context, installation.id)[0].pending === 0);
    expect(context.reviewer.calls).toHaveLength(1);
    await context.runtime.changeRegion(installation.id, "US");
    await eventually(() => context.store.get(installation.id)?.status === "active");
    await advanceUntil(() => fixture.patches.length === 2);
    expect(context.reviewer.calls.map(({ region }) => region)).toEqual(["UK", "US"]);
    expect(queueRows(context, installation.id)[0].fingerprint).not.toBe(before);
    const properties = fixture.patches[1].properties, binding = installation.binding!;
    expect(properties[binding.properties.reviewStatus.id]).toEqual({ select: { name: binding.statusLabels.found } });
    expect(warningText(properties, binding.properties.relatedWarnings.id)).toContain("US milk warning");
    expect(warningText(properties, binding.properties.relatedWarnings.id)).toContain("US covered data");
  });

  it("keeps a completed pause when a country-change query finishes late", async () => {
    const fixture = new NotionFixture("country-pause");
    fixture.row("country-pause-row", "Milk");
    const context = harness([fixture]);
    const installation = await install(context);
    const releaseQuery = gate();
    let held = false;
    fixture.handler = async (call) => {
      if (!call.url.pathname.endsWith("/query")) return undefined;
      held = true;
      await releaseQuery.promise;
      return fixture.respond(call);
    };
    const changing = context.runtime.changeRegion(installation.id, "US");
    await eventually(() => held);
    const pausing = context.runtime.pause(installation.id);
    releaseQuery.resolve();
    await Promise.all([changing, pausing]);
    expect(context.store.get(installation.id)?.status).toBe("paused");
    expect(context.runtime.state(installation.id)).toBeUndefined();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(context.reviewer.calls).toHaveLength(0);
    expect(fixture.patches).toHaveLength(0);
  });

  it("refreshes an expired token once when resuming a paused list and stores both rotated credentials", async () => {
    const fixture = new NotionFixture("resume-refresh");
    fixture.row("resume-refresh-row", "Milk");
    const context = harness([fixture]);
    const installation = await install(context);
    await context.runtime.pause(installation.id);
    let refreshes = 0;
    fixture.handler = async (call) => {
      if (call.url.pathname === "/v1/oauth/token") {
        refreshes += 1;
        return json({ access_token: "resumed-access", refresh_token: "resumed-refresh" });
      }
      if (call.headers.get("authorization") === `Bearer ${fixture.accessToken}`) return json({}, 401);
      return undefined;
    };
    await context.runtime.activate(installation.id, { reconcile: true });
    await eventually(() => context.store.get(installation.id)?.status === "active");
    await advanceUntil(() => fixture.patches.length === 1);
    expect(refreshes).toBe(1);
    expect(context.store.getCredentials(installation.id)).toEqual({ accessToken: "resumed-access", refreshToken: "resumed-refresh" });
    expect(context.store.get(installation.id)?.errorCode).toBeUndefined();
  });

  it("retains a completed token rotation when pause cancels the country-change operation", async () => {
    const fixture = new NotionFixture("paused-rotation");
    fixture.row("paused-rotation-row", "Milk");
    const context = harness([fixture]);
    const installation = await install(context);
    const release = gate();
    const refresh = holdRotatingRefresh(fixture, release.promise);
    const changing = context.runtime.changeRegion(installation.id, "US");
    await eventually(() => refresh.calls === 1);
    const pausing = context.runtime.pause(installation.id);
    await ioTurn();
    expect(context.store.get(installation.id)?.status).toBe("paused");
    expect(refresh.signal?.aborted).toBe(false);
    expect(context.store.getCredentials(installation.id)?.accessToken).toBe(fixture.accessToken);
    release.resolve();
    await Promise.all([changing, pausing]);
    expect(context.store.get(installation.id)?.status).toBe("paused");
    expect(context.store.getCredentials(installation.id)).toEqual({ accessToken: "held-rotated-access", refreshToken: "held-rotated-refresh" });
    expect(context.runtime.state(installation.id)).toBeUndefined();
    expect(context.reviewer.calls).toHaveLength(0);
    expect(fixture.patches).toHaveLength(0);
    expect(fixture.calls.filter(({ url }) => url.pathname.endsWith("/query"))).toHaveLength(1);
    await context.runtime.activate(installation.id, { reconcile: true });
    await eventually(() => context.store.get(installation.id)?.status === "active");
    await advanceUntil(() => fixture.patches.length === 1);
    expect(refresh.calls).toBe(1);
  });

  it("rejects a held rotating response once disconnect has revoked the installation", async () => {
    const fixture = new NotionFixture("disconnect-rotation");
    fixture.row("disconnect-rotation-row", "Milk");
    const context = harness([fixture]);
    const installation = await install(context);
    const release = gate();
    const refresh = holdRotatingRefresh(fixture, release.promise);
    const replace = vi.spyOn(context.store, "replaceCredentials");
    const changing = context.runtime.changeRegion(installation.id, "US");
    await eventually(() => refresh.calls === 1);
    let disconnected = false;
    const disconnecting = context.runtime.disconnect(installation.id).then((result) => { disconnected = true; return result; });
    await ioTurn();
    expect(context.store.get(installation.id)?.status).toBe("disconnecting");
    expect(disconnected).toBe(false);
    release.resolve();
    await changing;
    await expect(disconnecting).resolves.toEqual({ permissionRemoved: true });
    expect(replace).toHaveBeenCalledExactlyOnceWith(installation.id, fixture.accessToken, { accessToken: "held-rotated-access", refreshToken: "held-rotated-refresh" });
    expect(replace).toHaveReturnedWith(false);
    expect(context.store.get(installation.id)).toBeUndefined();
    expect(context.store.getCredentials(installation.id)).toBeUndefined();
    expect(context.reviewer.calls).toHaveLength(0);
    expect(fixture.patches).toHaveLength(0);
    expect(fixture.calls.filter(({ url }) => url.pathname.endsWith("/query"))).toHaveLength(1);
    expect(readdirSync(context.directory).some((name) => name.startsWith(`queue-${installation.id}`))).toBe(false);
  });

  it("does not overwrite a renewed authorization with a held response for the old token", async () => {
    const fixture = new NotionFixture("renewed-rotation");
    fixture.row("renewed-rotation-row", "Milk");
    const context = harness([fixture]);
    const installation = await install(context);
    const release = gate();
    const refresh = holdRotatingRefresh(fixture, release.promise);
    const replace = vi.spyOn(context.store, "replaceCredentials");
    const changing = context.runtime.changeRegion(installation.id, "US");
    await eventually(() => refresh.calls === 1);
    const renewed = context.store.authorize({ ...fixture.authorization(), accessToken: "renewed-access", refreshToken: "renewed-refresh" }, "UK", Date.now(), installation.id);
    release.resolve();
    await changing;
    expect(replace).toHaveReturnedWith(false);
    expect(context.store.getCredentials(installation.id)).toEqual({ accessToken: "renewed-access", refreshToken: "renewed-refresh" });
    expect(context.store.get(installation.id)).toMatchObject({ status: "setting_up", generation: renewed.generation });
    expect(context.store.get(installation.id)?.errorCode).toBeUndefined();
    expect(context.reviewer.calls).toHaveLength(0);
    expect(fixture.patches).toHaveLength(0);
    expect(fixture.calls.filter(({ url }) => url.pathname.endsWith("/query"))).toHaveLength(1);
    await context.runtime.activate(installation.id, { expectedGeneration: renewed.generation, reconcile: true });
    await eventually(() => context.store.get(installation.id)?.status === "active");
    await advanceUntil(() => fixture.patches.length === 1);
    expect(refresh.calls).toBe(1);
    expect(fixture.calls.filter(({ method }) => method === "PATCH").every(({ headers }) => headers.get("authorization") === "Bearer renewed-access")).toBe(true);
  });

  it("drains a startup-validation refresh before shutdown allows the private store to close", async () => {
    const fixture = new NotionFixture("startup-rotation");
    const context = harness([fixture]);
    const installation = context.store.authorize(fixture.authorization(), "UK", Date.now());
    const release = gate();
    const refresh = holdRotatingRefresh(fixture, release.promise);
    const rotationHandler = fixture.handler!;
    let dataSourceReads = 0;
    fixture.handler = async (call) => {
      if (call.url.pathname === `/v1/data_sources/${fixture.dataSourceId}`) {
        dataSourceReads += 1;
        if (dataSourceReads > 1 && call.headers.get("authorization") === `Bearer ${fixture.accessToken}`) return json({}, 401);
      }
      return rotationHandler(call);
    };
    const get = vi.spyOn(context.store, "get");
    const replace = vi.spyOn(context.store, "replaceCredentials");
    const ready = vi.spyOn(context.store, "ready");
    await context.runtime.activate(installation.id);
    await eventually(() => refresh.calls === 1);
    expect(context.runtime.state(installation.id)).toEqual({ ready: false, paused: false });
    let stopped = false;
    const stopping = context.runtime.stop().then(() => { stopped = true; });
    await ioTurn();
    expect(stopped).toBe(false);
    expect(refresh.signal?.aborted).toBe(false);
    expect(context.store.getCredentials(installation.id)?.accessToken).toBe(fixture.accessToken);
    release.resolve();
    await stopping;
    expect(context.store.getCredentials(installation.id)).toEqual({ accessToken: "held-rotated-access", refreshToken: "held-rotated-refresh" });
    expect(replace).toHaveBeenCalledExactlyOnceWith(installation.id, fixture.accessToken, { accessToken: "held-rotated-access", refreshToken: "held-rotated-refresh" });
    expect(context.runtime.state(installation.id)).toBeUndefined();
    expect(ready).not.toHaveBeenCalled();
    context.store.close();
    context.storeClosed = true;
    const readsAtClose = get.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    await ioTurn();
    expect(get).toHaveBeenCalledTimes(readsAtClose);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(ready).not.toHaveBeenCalled();
    expect(context.reviewer.calls).toHaveLength(0);
    expect(fixture.patches).toHaveLength(0);
  });

  it("caps each queue at 1,000 pending pages while allowing independent installations to accept work", async () => {
    const first = new NotionFixture("bounded-a"), second = new NotionFixture("bounded-b");
    const context = harness([first, second]);
    const a = await install(context, first), b = await install(context, second);
    for (let index = 0; index < 1_000; index += 1) expect(context.runtime.enqueue(a.id, event(`bounded-event-${index}`, `bounded-row-${index}`))).toBe("accepted");
    expect(context.runtime.enqueue(a.id, event("overflow-event", "overflow-row"))).toBe("full");
    expect(context.runtime.enqueue(a.id, event("bounded-event-0", "bounded-row-0"))).toBe("duplicate");
    expect(context.runtime.enqueue(b.id, event("overflow-event", "other-row"))).toBe("accepted");
    expect(queueRows(context, a.id)).toHaveLength(1_000);
    expect(queueRows(context, b.id)).toHaveLength(1);
  });

  it("writes an unable source result with its qualifications and keeps processing active", async () => {
    const fixture = new NotionFixture("unavailable");
    fixture.row("unavailable-row", "Milk");
    const context = harness([fixture]);
    context.reviewer.handler = async () => ({ status: "unable_to_review", notices: [], warnings: ["The FDA source did not respond."], qualification: "Review could not complete.", coverageSummary: "US source unavailable" });
    const installation = await install(context, fixture, "US");
    context.runtime.enqueue(installation.id, event("unavailable-event", "unavailable-row"));
    await advanceUntil(() => fixture.patches.length === 1);
    const binding = installation.binding!, properties = fixture.patches[0].properties;
    expect(properties[binding.properties.reviewStatus.id]).toEqual({ select: { name: binding.statusLabels.unable } });
    expect(warningText(properties, binding.properties.relatedWarnings.id)).toContain("Review could not complete.");
    expect(warningText(properties, binding.properties.relatedWarnings.id)).toContain("The FDA source did not respond.");
    expect(warningText(properties, binding.properties.relatedWarnings.id)).toContain("US source unavailable");
    expect(context.store.get(installation.id)?.status).toBe("active");
  });
});
