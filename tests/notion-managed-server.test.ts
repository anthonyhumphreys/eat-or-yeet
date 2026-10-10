import { createHmac } from "node:crypto";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createManagedServer } from "../integrations/notion/managed/server.ts";
import { ManagedStore } from "../integrations/notion/managed/store.ts";
import type { Authorization, ListBinding, ManagedConfig } from "../integrations/notion/managed/types.ts";

const KEY = Buffer.alloc(32, 41);
const WEBHOOK_TOKEN = "webhook-verification-private";
const INSTALLATION_AUTH: Authorization = {
  ownerId: "owner-1", workspaceId: "workspace-1", botId: "bot-1",
  accessToken: "access-token-private", refreshToken: "refresh-token-private", templatePageId: "template-1",
};
const binding: ListBinding = {
  templatePageId: "template-1", databaseId: "database-1", dataSourceId: "source-1",
  properties: {} as ListBinding["properties"], statusLabels: { found: "Found", none: "None", unable: "Unable" },
};

type RuntimeCall = { method: string; args: unknown[] };
type RuntimeOptions = { enqueueResult?: "accepted" | "ignored" | "paused" | "full" };

function runtimeDouble(options: RuntimeOptions = {}) {
  const calls: RuntimeCall[] = [];
  const runtime = {
    activate: async (...args: unknown[]) => { calls.push({ method: "activate", args }); },
    suspendForAuthorization: async (...args: unknown[]) => { calls.push({ method: "suspendForAuthorization", args }); },
    pause: async (...args: unknown[]) => { calls.push({ method: "pause", args }); },
    changeRegion: async (...args: unknown[]) => { calls.push({ method: "changeRegion", args }); },
    disconnect: async (...args: unknown[]) => { calls.push({ method: "disconnect", args }); return { permissionRemoved: true }; },
    enqueue: (...args: unknown[]) => { calls.push({ method: "enqueue", args }); return options.enqueueResult ?? "accepted"; },
    state: () => ({ ready: true, paused: false }),
  };
  return { runtime, calls };
}

function config(enabled = true): ManagedConfig {
  return {
    enabled, publicOrigin: "http://127.0.0.1:0", websiteOrigin: "https://eat-or-yeet.test",
    listenHost: "127.0.0.1", listenPort: 0, stateDirectory: "/tmp/notion-managed-server-test",
    clientId: "client-id-private", clientSecret: "client-secret-private", encryptionKey: KEY,
    webhookVerificationToken: WEBHOOK_TOKEN, notionIntegrationId: "integration-1", notionSubscriptionId: "subscription-1",
    reviewMcpUrl: "https://review.test/mcp", reviewConnectionKey: "review-key-private",
    maxInstallations: 10, dailyReviewsPerInstallation: 20, dailyReviewsGlobal: 100,
  };
}

function authorizationApi() {
  const exchanged: string[] = [];
  return {
    exchanged,
    api: {
      authorizationUrl: (state: string) => `https://api.notion.com/v1/oauth/authorize?state=${encodeURIComponent(state)}`,
      exchange: async (code: string) => { exchanged.push(code); return { ...INSTALLATION_AUTH }; },
    },
  };
}

async function harness(options: { enabled?: boolean; runtime?: RuntimeOptions; auth?: Authorization } = {}) {
  const store = new ManagedStore(":memory:", KEY, 10);
  const serverConfig = config(options.enabled ?? true);
  const auth = authorizationApi();
  if (options.auth) auth.api.exchange = async (code: string) => { auth.exchanged.push(code); return options.auth!; };
  const runtime = runtimeDouble(options.runtime);
  const server = createManagedServer(serverConfig, store, auth.api, runtime.runtime as never);
  await new Promise<void>((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  serverConfig.publicOrigin = `http://127.0.0.1:${address.port}`;
  const base = serverConfig.publicOrigin;
  return {
    base, server, store, auth, runtime,
    close: async () => {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      store.close();
    },
  };
}

const running: Array<Awaited<ReturnType<typeof harness>>> = [];
async function start(options: Parameters<typeof harness>[0] = {}) {
  const value = await harness(options);
  running.push(value);
  return value;
}
afterEach(async () => { await Promise.all(running.splice(0).map((item) => item.close())); });

function cookieFrom(response: Response, prefix: string): string {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const value = (headers.getSetCookie?.() ?? [response.headers.get("set-cookie") ?? ""]).find((entry) => entry.startsWith(`${prefix}=`));
  if (!value) throw new Error(`Missing ${prefix} cookie`);
  return value.split(";", 1)[0];
}
function setCookie(response: Response, prefix: string): string {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const value = (headers.getSetCookie?.() ?? [response.headers.get("set-cookie") ?? ""]).find((entry) => entry.startsWith(`${prefix}=`));
  if (!value) throw new Error(`Missing ${prefix} cookie`);
  return value;
}
async function forgedHostRequest(base: string): Promise<{ status: number; headers: Headers }> {
  const target = new URL("/connect?region=UK", base);
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: target.hostname, port: target.port, path: target.pathname + target.search, headers: { host: "evil.test" } }, (response) => {
      response.resume();
      response.on("end", () => resolve({ status: response.statusCode ?? 0, headers: new Headers(response.headers as HeadersInit) }));
    });
    req.on("error", reject);
    req.end();
  });
}

function signature(body: string): string { return `sha256=${createHmac("sha256", WEBHOOK_TOKEN).update(body).digest("hex")}`; }
async function connect(base: string, region = "UK") {
  const response = await fetch(`${base}/connect?region=${region}`, { redirect: "manual" });
  return { response, cookie: cookieFrom(response, "eoy_notion_oauth"), state: new URL(response.headers.get("location")!).searchParams.get("state")! };
}
async function callback(base: string, state: string, cookie: string, params = "code=code-private") {
  return fetch(`${base}/oauth/callback?state=${encodeURIComponent(state)}&${params}`, { headers: { cookie }, redirect: "manual" });
}
async function install(base: string, store: ManagedStore, region = "UK") {
  const pending = await connect(base, region);
  const response = await callback(base, pending.state, pending.cookie);
  expect(response.status).toBe(303);
  return { response, session: cookieFrom(response, "eoy_notion"), installation: store.list()[0] };
}

describe("managed Notion HTTP server", () => {
  it("keeps disabled setup off and rejects forged host origins", async () => {
    const disabled = await start({ enabled: false });
    expect(await (await fetch(`${disabled.base}/health`)).json()).toEqual({ enabled: false });
    expect((await fetch(`${disabled.base}/connect?region=UK`, { redirect: "manual" })).status).toBe(503);

    const active = await start();
    const forged = await forgedHostRequest(active.base);
    expect(forged.status).toBe(400);
    expect(active.auth.exchanged).toEqual([]);
  });

  it("binds one-time OAuth state to its browser cookie and carries the chosen region", async () => {
    const app = await start();
    const pending = await connect(app.base, "US");
    const wrongCookie = await callback(app.base, pending.state, "eoy_notion_oauth=wrong-cookie");
    expect(wrongCookie.status).toBe(400);
    expect(app.auth.exchanged).toEqual([]);

    const completed = await callback(app.base, pending.state, pending.cookie);
    expect(completed.status).toBe(303);
    expect(app.auth.exchanged).toEqual(["code-private"]);
    expect(app.store.list()).toHaveLength(1);
    expect(app.store.list()[0]).toMatchObject({ region: "US", status: "setting_up" });
    expect(completed.headers.get("set-cookie")).toContain("HttpOnly");
    expect(completed.headers.get("set-cookie")).toContain("SameSite=Lax");
    expect(setCookie(completed, "eoy_notion_oauth")).toContain("Max-Age=0");
    const replay = await callback(app.base, pending.state, pending.cookie);
    expect(replay.status).toBe(400);
    expect(app.auth.exchanged).toHaveLength(1);
  });

  it("does not exchange a cancelled authorization or render callback input as HTML", async () => {
    const app = await start();
    const pending = await connect(app.base);
    const cancelled = await callback(app.base, pending.state, pending.cookie, "error=access_denied&error_description=%3Cscript%3Ebad%3C%2Fscript%3E");
    const html = await cancelled.text();
    expect(cancelled.status).toBe(200);
    expect(app.auth.exchanged).toEqual([]);
    expect(html).not.toContain("<script>bad");
    expect(cancelled.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(cancelled.headers.get("content-security-policy")).toMatch(/style-src 'nonce-[A-Za-z0-9_-]+'/);
  });

  it("refuses a reconnect under another owner and restores the same owner's installation", async () => {
    const app = await start();
    const first = await install(app.base, app.store);
    const id = first.installation.id;
    app.store.bind(id, first.installation.generation, binding, Date.now());

    const reconnect = await fetch(`${app.base}/reconnect`, { headers: { cookie: first.session }, redirect: "manual" });
    // /reconnect is session-bound and redirects to Notion while preserving the existing region.
    expect(reconnect.status).toBe(303);
    const reconnectState = new URL(reconnect.headers.get("location")!).searchParams.get("state")!;
    const reconnectCookie = cookieFrom(reconnect, "eoy_notion_oauth");
    app.auth.api.exchange = async (code: string) => {
      app.auth.exchanged.push(code);
      return { ...INSTALLATION_AUTH, ownerId: "different-owner", botId: "different-bot" };
    };
    const denied = await callback(app.base, reconnectState, reconnectCookie);
    expect(denied.status).toBe(403);
    expect(app.store.get(id)).toMatchObject({ ownerId: "owner-1", region: "UK", binding });
    expect(app.store.list()).toHaveLength(1);

    app.auth.api.exchange = async (code: string) => { app.auth.exchanged.push(code); return { ...INSTALLATION_AUTH, accessToken: "rotated-access" }; };
    const restore = await connect(app.base, "US");
    const restored = await callback(app.base, restore.state, restore.cookie);
    expect(restored.status).toBe(303);
    expect(app.store.list()).toHaveLength(1);
    expect(app.store.get(id)).toMatchObject({ id, ownerId: "owner-1", region: "US", binding, generation: 2 });
    expect(JSON.stringify(await (await fetch(app.base)).text())).not.toContain("rotated-access");
  });

  it("requires origin and session CSRF checks, then routes pause, resume, region change, and disconnect", async () => {
    const app = await start();
    const { session, installation } = await install(app.base, app.store);
    const page = await fetch(app.base, { headers: { cookie: session } });
    const html = await page.text();
    expect(html).toContain("Refresh status");
    expect(html).not.toContain('http-equiv="refresh"');
    const secondPage = await fetch(app.base, { headers: { cookie: session } });
    const policy = page.headers.get("content-security-policy") ?? "";
    const secondPolicy = secondPage.headers.get("content-security-policy") ?? "";
    expect(policy).toMatch(/style-src 'nonce-[A-Za-z0-9_-]+'/);
    expect(policy).not.toBe(secondPolicy);
    const csrf = html.match(/name="csrf" value="([^"]+)"/)?.[1];
    expect(csrf).toBeTruthy();
    const formBody = new URLSearchParams({ action: "pause", csrf: csrf! });
    const noOrigin = await fetch(`${app.base}/manage`, { method: "POST", headers: { cookie: session, "content-type": "application/x-www-form-urlencoded" }, body: formBody });
    expect(noOrigin.status).toBe(403);
    const badCsrf = await fetch(`${app.base}/manage`, { method: "POST", headers: { cookie: session, origin: app.base, "content-type": "application/x-www-form-urlencoded" }, body: "action=pause&csrf=wrong" });
    expect(badCsrf.status).toBe(403);

    for (const [action, extra] of [["pause", {}], ["resume", {}], ["region", { region: "US" }]] as const) {
      const body = new URLSearchParams({ action, csrf: csrf!, ...extra });
      const response = await fetch(`${app.base}/manage`, { method: "POST", headers: { cookie: session, origin: app.base, "content-type": "application/x-www-form-urlencoded" }, body, redirect: "manual" });
      expect(response.status).toBe(303);
    }
    expect(app.runtime.calls.map((call) => call.method)).toEqual(["activate", "pause", "activate", "changeRegion"]);
    expect(app.runtime.calls[3].args).toEqual([installation.id, "US"]);
    const disconnected = await fetch(`${app.base}/manage`, {
      method: "POST", headers: { cookie: session, origin: app.base, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ action: "disconnect", csrf: csrf! }), redirect: "manual",
    });
    expect(disconnected.status).toBe(303);
    expect(disconnected.headers.get("location")).toBe("/?disconnected=done");
    expect(setCookie(disconnected, "eoy_notion")).toContain("Max-Age=0");
    expect(app.runtime.calls.at(-1)).toMatchObject({ method: "disconnect", args: [installation.id] });
  });

  it("routes signed Notion events only to matching workspace, bot, and parent bindings", async () => {
    const app = await start();
    const first = app.store.authorize(INSTALLATION_AUTH, "UK", Date.now());
    app.store.bind(first.id, first.generation, binding, Date.now());
    const otherAuth = { ...INSTALLATION_AUTH, ownerId: "owner-2", botId: "bot-2" };
    const second = app.store.authorize(otherAuth, "UK", Date.now());
    app.store.bind(second.id, second.generation, { ...binding, databaseId: "database-2", dataSourceId: "source-2" }, Date.now());
    const payload = {
      id: "event-1", type: "page.properties_updated", integration_id: "integration-1", subscription_id: "subscription-1",
      workspace_id: "workspace-1", entity: { type: "page", id: "page-1" }, accessible_by: [{ type: "bot", id: "bot-1" }],
      data: { parent: { type: "database", id: "database-1", data_source_id: "source-1" }, updated_properties: ["property-1"] },
    };
    const body = JSON.stringify(payload);
    const post = (text: string, sig = signature(text)) => fetch(`${app.base}/webhooks/notion`, { method: "POST", headers: { "x-notion-signature": sig }, body: text });
    expect((await post(body, "sha256=bad")).status).toBe(401);
    expect((await post(JSON.stringify({ ...payload, integration_id: "other" }))).status).toBe(400);
    expect((await post(JSON.stringify({ ...payload, subscription_id: "other" }))).status).toBe(400);
    const accepted = await post(body);
    expect(accepted.status).toBe(202);
    expect(app.runtime.calls.filter((call) => call.method === "enqueue")).toHaveLength(1);
    expect(app.runtime.calls.find((call) => call.method === "enqueue")?.args).toEqual([first.id, {
      id: "event-1", type: "page.properties_updated", pageId: "page-1", updatedProperties: ["property-1"],
    }]);
    expect((await post(JSON.stringify({ ...payload, accessible_by: [{ type: "user", id: "owner-1" }] }))).status).toBe(200);
    const challenge = await post(JSON.stringify({ verification_token: WEBHOOK_TOKEN }), "");
    expect(challenge.status).toBe(200);
    expect(await challenge.json()).toEqual({ verification_token: WEBHOOK_TOKEN });
    expect((await post(JSON.stringify({ verification_token: "wrong" }), "")).status).toBe(401);
  });

  it("routes shared-workspace events only when their typed parent matches an installed list", async () => {
    const app = await start();
    const first = app.store.authorize(INSTALLATION_AUTH, "UK", Date.now());
    app.store.bind(first.id, first.generation, binding, Date.now());
    const second = app.store.authorize({ ...INSTALLATION_AUTH, ownerId: "owner-2" }, "UK", Date.now());
    app.store.bind(second.id, second.generation, { ...binding, databaseId: "database-2", dataSourceId: "source-2" }, Date.now());
    const unbound = app.store.authorize({ ...INSTALLATION_AUTH, ownerId: "owner-3" }, "UK", Date.now());

    const basePayload = {
      id: "event-parent-routing", type: "page.created", integration_id: "integration-1", subscription_id: "subscription-1",
      workspace_id: "workspace-1", entity: { type: "page", id: "page-1" }, accessible_by: [{ type: "bot", id: "bot-1" }],
    };
    const post = async (parent?: unknown) => {
      const payload = { ...basePayload, data: parent === undefined ? {} : { parent } };
      const body = JSON.stringify(payload);
      const response = await fetch(`${app.base}/webhooks/notion`, { method: "POST", headers: { "x-notion-signature": signature(body) }, body });
      return { response, body: await response.json() as { accepted?: boolean } };
    };

    const sourceOne = await post({ type: "database", id: "database-1", data_source_id: "source-1" });
    expect(sourceOne.response.status).toBe(202);
    expect(sourceOne.body).toEqual({ accepted: true });
    expect(app.runtime.calls.filter((call) => call.method === "enqueue").map((call) => call.args[0])).toEqual([first.id]);

    const sourceTwo = await post({ type: "database", id: "database-2", data_source_id: "source-2" });
    expect(sourceTwo.response.status).toBe(202);
    expect(sourceTwo.body).toEqual({ accepted: true });
    expect(app.runtime.calls.filter((call) => call.method === "enqueue").map((call) => call.args[0])).toEqual([first.id, second.id]);

    const database = await post({ type: "database", id: "database-2" });
    expect(database.response.status).toBe(202);
    expect(database.body).toEqual({ accepted: true });
    expect(app.runtime.calls.filter((call) => call.method === "enqueue").map((call) => call.args[0])).toEqual([first.id, second.id, second.id]);

    const databaseAndSource = await post({ type: "database", id: "database-2", data_source_id: "source-2" });
    expect(databaseAndSource.response.status).toBe(202);
    expect(databaseAndSource.body).toEqual({ accepted: true });
    expect(app.runtime.calls.filter((call) => call.method === "enqueue").map((call) => call.args[0])).toEqual([first.id, second.id, second.id, second.id]);

    const ignoredParents: Array<{ label: string; parent?: unknown }> = [
      { label: "page", parent: { type: "page", id: "page-1" } },
      { label: "workspace", parent: { type: "workspace", id: "workspace-1" } },
      { label: "unknown", parent: { type: "other", id: "source-1" } },
      { label: "missing" },
      { label: "wrong database id", parent: { type: "database", id: "database-3", data_source_id: "source-1" } },
      { label: "unsupported data source parent type", parent: { type: "data_source", id: "source-1" } },
      { label: "database type with source id", parent: { type: "database", id: "source-1" } },
      { label: "database source id mismatch", parent: { type: "database", id: "database-2", data_source_id: "source-1" } },
    ];
    for (const { label, parent } of ignoredParents) {
      const result = await post(parent);
      expect(result.response.status, label).toBe(200);
      expect(result.body, label).toEqual({ accepted: false });
    }
    expect(app.runtime.calls.filter((call) => call.method === "enqueue").map((call) => call.args[0])).toEqual([first.id, second.id, second.id, second.id]);
    expect(app.store.get(unbound.id)?.binding).toBeUndefined();
  });

  it("reports paused or full webhook queues and ignores signed events for unknown recipients", async () => {
    const payload = {
      id: "event-1", type: "page.created", integration_id: "integration-1", subscription_id: "subscription-1",
      workspace_id: "workspace-1", entity: { type: "page", id: "page-1" }, accessible_by: [{ type: "bot", id: "bot-1" }],
      data: { parent: { type: "database", id: "database-1" } },
    };
    for (const enqueueResult of ["full", "paused"] as const) {
      const app = await start({ runtime: { enqueueResult } });
      const installed = app.store.authorize(INSTALLATION_AUTH, "UK", Date.now());
      app.store.bind(installed.id, installed.generation, binding, Date.now());
      const post = async (event: unknown) => {
        const body = JSON.stringify(event);
        return fetch(`${app.base}/webhooks/notion`, { method: "POST", headers: { "x-notion-signature": signature(body) }, body });
      };
      expect((await post(payload)).status).toBe(503);
      const unknown = await post({ ...payload, accessible_by: [{ type: "bot", id: "unknown-bot" }] });
      expect(unknown.status).toBe(200);
      expect(await unknown.json()).toEqual({ accepted: false });
      expect(app.runtime.calls.filter((call) => call.method === "enqueue").map((call) => call.args[0])).toEqual([installed.id]);
    }
  });
});
