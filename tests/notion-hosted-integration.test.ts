import { createHmac } from "node:crypto";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "@convex/_generated/api";
import { decryptCredentials } from "../integrations/notion/hosted/crypto.ts";
import { NotionOAuthApi } from "../integrations/notion/managed/notion-api.ts";
import type { Authorization, Region } from "../integrations/notion/managed/types.ts";
import { buildDatabasePayload } from "../integrations/notion/template/provision.mjs";
import { GET as connectRoute } from "../src/app/api/notion/connect/route.ts";
import { GET as callbackRoute } from "../src/app/api/notion/callback/route.ts";
import { POST as manageRoute } from "../src/app/api/notion/manage/route.ts";
import { POST as webhookRoute } from "../src/app/api/notion/webhook/route.ts";
import { handleNotionRequest, notionCookieNames, notionCsrf, notionHash, type NotionHttpBackend, type NotionHttpDependencies } from "../src/lib/integrations/notion-http.ts";
import { createBackend } from "./convex-harness.ts";

vi.mock("convex/nextjs", () => ({ fetchMutation: vi.fn(), fetchQuery: vi.fn() }));

const ORIGIN = "https://eat-or-yeet.example.test";
const SECRET = "hosted-convex-secret";
const CREDENTIAL_KEY = Buffer.alloc(32, 34).toString("base64");
const WEBHOOK_TOKEN = "hosted-webhook-secret";
const INTEGRATION_ID = "hosted-integration";
const SUBSCRIPTION_ID = "hosted-subscription";
type Backend = ReturnType<typeof createBackend>;

function json(value: unknown): Response { return Response.json(value); }
class NotionFixture {
  readonly auth: Authorization;
  readonly databaseId: string;
  readonly dataSourceId: string;
  readonly properties: Record<string, Record<string, unknown>>;
  readonly calls: Array<{ url: URL; headers: Headers; body?: string }> = [];
  constructor(name: string) {
    this.auth = { ownerId: `${name}-owner`, workspaceId: `${name}-workspace`, botId: `${name}-bot`, templatePageId: `${name}-template`, accessToken: `${name}-access-private`, refreshToken: `${name}-refresh-private` };
    this.databaseId = `${name}-database`;
    this.dataSourceId = `${name}-source`;
    const definitions = buildDatabasePayload(this.auth.templatePageId).initial_data_source.properties as Record<string, Record<string, unknown>>;
    this.properties = Object.fromEntries(Object.entries(definitions).map(([displayName, definition], index) => {
      const type = Object.keys(definition)[0];
      return [displayName, { id: `${name}-property:${index}`, type, ...(type === "select" ? { select: definition.select } : {}) }];
    }));
  }
  fetch: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    this.calls.push({ url, headers: new Headers(init.headers), ...(init.body ? { body: String(init.body) } : {}) });
    if (url.origin !== "https://api.notion.com") throw new Error(`Unexpected external request ${url.origin}`);
    if (url.pathname === "/v1/oauth/token") return json({ access_token: this.auth.accessToken, refresh_token: this.auth.refreshToken, bot_id: this.auth.botId, workspace_id: this.auth.workspaceId, owner: { type: "user", user: { id: this.auth.ownerId } }, duplicated_template_id: this.auth.templatePageId });
    if (url.pathname === "/v1/oauth/revoke") return json({});
    if (url.pathname === `/v1/pages/${this.auth.templatePageId}`) return json({ id: this.auth.templatePageId, object: "page" });
    if (url.pathname === `/v1/blocks/${this.auth.templatePageId}/children`) return json({ results: [{ id: this.databaseId, type: "child_database", has_children: false }], has_more: false, next_cursor: null });
    if (url.pathname === `/v1/databases/${this.databaseId}`) return json({ id: this.databaseId, data_sources: [{ id: this.dataSourceId }] });
    if (url.pathname === `/v1/data_sources/${this.dataSourceId}`) return json({ id: this.dataSourceId, parent: { type: "database_id", database_id: this.databaseId }, properties: this.properties });
    if (url.pathname === `/v1/data_sources/${this.dataSourceId}/query`) return json({ results: [], has_more: false, next_cursor: null });
    throw new Error(`Unexpected Notion request ${url.pathname}`);
  };
}
function dependencies(t: Backend, fixture: NotionFixture): NotionHttpDependencies {
  const backend: NotionHttpBackend = {
    beginOAuth: (args) => t.mutation(api.notion.beginOAuth, { secret: SECRET, ...args }),
    consumeOAuth: (args) => t.mutation(api.notion.consumeOAuth, { secret: SECRET, ...args }),
    authorize: (args) => t.mutation(api.notion.authorize, { secret: SECRET, ...args }),
    createSession: (args) => t.mutation(api.notion.createSession, { secret: SECRET, ...args }),
    management: (args) => t.query(api.notion.management, { secret: SECRET, ...args }),
    control: (args) => t.mutation(api.notion.control, { secret: SECRET, ...args }),
    receiveWebhook: (args) => t.mutation(api.notion.receiveWebhook, { secret: SECRET, ...args }),
  };
  return { origin: ORIGIN, encryptionKey: CREDENTIAL_KEY, csrfSecret: SECRET, webhookToken: WEBHOOK_TOKEN, integrationId: INTEGRATION_ID, subscriptionId: SUBSCRIPTION_ID, backend, oauth: new NotionOAuthApi("hosted-client", "hosted-client-secret", `${ORIGIN}/api/notion/callback`, fixture.fetch) };
}
function cookieValue(response: Response, name: string): string {
  const cookie = response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`));
  expect(cookie).toBeDefined();
  return cookie!.slice(name.length + 1).split(";", 1)[0];
}
async function connect(t: Backend, fixture: NotionFixture, region: Region = "UK") {
  const deps = dependencies(t, fixture), names = notionCookieNames(ORIGIN);
  const begin = await handleNotionRequest("connect", new Request(`${ORIGIN}/api/notion/connect?region=${region}`), deps);
  expect(begin.status).toBe(303);
  const state = new URL(begin.headers.get("location")!).searchParams.get("state")!;
  const oauthCookie = cookieValue(begin, names.oauth);
  const pending = await t.run((ctx) => ctx.db.query("notionOAuthPending").collect());
  expect(pending).toEqual([expect.objectContaining({ stateHash: notionHash(state), bindingHash: notionHash(oauthCookie), region })]);
  const callback = await handleNotionRequest("callback", new Request(`${ORIGIN}/api/notion/callback?state=${encodeURIComponent(state)}&code=hosted-code`, { headers: { cookie: `${names.oauth}=${oauthCookie}` } }), deps);
  expect(callback.status).toBe(303);
  expect(callback.headers.get("location")).toBe(`${ORIGIN}/integrations/notion/manage`);
  const session = cookieValue(callback, names.session), sessionHash = notionHash(session);
  const installation = await t.run((ctx) => ctx.db.query("notionInstallations").withIndex("by_owner_workspace", (q) => q.eq("ownerId", fixture.auth.ownerId).eq("workspaceId", fixture.auth.workspaceId)).unique());
  expect(installation).not.toBeNull();
  expect(installation!.status).toBe("setting_up");
  expect(decryptCredentials(installation!.credentialEnvelope, fixture.auth, CREDENTIAL_KEY)).toEqual({ accessToken: fixture.auth.accessToken, refreshToken: fixture.auth.refreshToken });
  const sessions = await t.run((ctx) => ctx.db.query("notionSessions").withIndex("by_sessionHash", (q) => q.eq("sessionHash", sessionHash)).collect());
  expect(sessions).toEqual([expect.objectContaining({ installationId: installation!._id, csrfHash: notionHash(notionCsrf(session, SECRET)) })]);
  expect(await t.run((ctx) => ctx.db.query("notionOAuthPending").collect())).toEqual([]);
  return { deps, installation: installation!, session, sessionHash };
}
async function manage(connection: Awaited<ReturnType<typeof connect>>, action: "pause" | "resume" | "region" | "disconnect", region?: Region) {
  const body = new URLSearchParams({ action, csrf: notionCsrf(connection.session, SECRET), ...(region ? { region } : {}) });
  const response = await handleNotionRequest("manage", new Request(`${ORIGIN}/api/notion/manage`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded", cookie: `${notionCookieNames(ORIGIN).session}=${connection.session}` }, body }), connection.deps);
  expect(response.status).toBe(303);
  return response;
}
function payload(fixture: NotionFixture, eventId: string, pageId: string) {
  return { id: eventId, type: "page.properties_updated", integration_id: INTEGRATION_ID, subscription_id: SUBSCRIPTION_ID, workspace_id: fixture.auth.workspaceId, accessible_by: [{ type: "bot", id: fixture.auth.botId }], entity: { type: "page", id: pageId }, data: { parent: { type: "database", id: fixture.databaseId, data_source_id: fixture.dataSourceId }, updated_properties: [encodeURIComponent(String(fixture.properties.Item.id))] } };
}
async function webhook(deps: NotionHttpDependencies, event: ReturnType<typeof payload>, validSignature = true) {
  const body = JSON.stringify(event);
  const signature = `sha256=${createHmac("sha256", WEBHOOK_TOKEN).update(body).digest("hex")}`;
  return handleNotionRequest("webhook", new Request(`${ORIGIN}/api/notion/webhook`, { method: "POST", headers: { "content-type": "application/json", "x-notion-signature": validSignature ? signature : `sha256=${"0".repeat(64)}` }, body }), deps);
}
async function state(t: Backend, connection: Awaited<ReturnType<typeof connect>>) {
  return t.query(api.notion.management, { secret: SECRET, sessionHash: connection.sessionHash, now: Date.now() });
}
async function activate(t: Backend, connection: Awaited<ReturnType<typeof connect>>) {
  const snapshot = await t.query(internal.notion.installationSnapshot, { installationId: connection.installation._id });
  await t.action(internal.notionActions.setup, { installationId: connection.installation._id, expectedGeneration: snapshot!.generation });
  expect(await state(t, connection)).toMatchObject({ installation: { status: "active" }, busy: false });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(new Date("2026-10-10T14:00:00Z"));
  vi.stubEnv("CONVEX_SERVER_SECRET", SECRET);
  vi.stubEnv("NEXT_PUBLIC_APP_URL", ORIGIN);
  vi.stubEnv("NOTION_CLIENT_ID", "hosted-client");
  vi.stubEnv("NOTION_CLIENT_SECRET", "hosted-client-secret");
  vi.stubEnv("NOTION_CREDENTIAL_KEY", CREDENTIAL_KEY);
  vi.stubEnv("NOTION_REVIEW_CONNECTION_KEY", "hosted-review-private");
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("hosted Notion integration with Convex state", () => {
  it("connects with encrypted credentials and fences durable work through pause, country change and disconnect", async () => {
    const t = createBackend(), fixture = new NotionFixture("hosted");
    vi.stubGlobal("fetch", fixture.fetch);
    const connection = await connect(t, fixture);
    await activate(t, connection);
    expect(await state(t, connection)).toMatchObject({ installation: { region: "UK", binding: { databaseId: fixture.databaseId } } });
    const received = await webhook(connection.deps, payload(fixture, "signed-event", "milk-row"));
    expect(received.status).toBe(202);
    expect(await received.json()).toEqual({ accepted: true });
    const lease = await t.mutation(internal.notion.claimJob, { installationId: connection.installation._id, now: Date.now() });
    expect(lease).toMatchObject({ pageId: "milk-row", region: "UK" });
    if (!lease) throw new Error("Hosted job was not claimed");
    const leaseArgs = { installationId: lease.installationId, jobId: lease.jobId, leaseId: lease.leaseId, generation: lease.generation, now: Date.now() };
    expect(await t.query(internal.notion.leaseCurrent, leaseArgs)).toBe(true);
    expect(await t.run((ctx) => ctx.db.query("notionProcessingSlots").collect())).toEqual([expect.objectContaining({ jobId: lease.jobId, kind: "review", leaseId: lease.leaseId })]);
    expect(await t.mutation(internal.notion.takeReviewQuota, { installationId: lease.installationId, now: Date.now() })).toMatchObject({ allowed: true, used: 1, globalUsed: 1 });
    const quotaBefore = await t.query(internal.notion.budget, { installationId: lease.installationId, now: Date.now() });
    for (let count = 0; count < 3; count += 1) expect(await state(t, connection)).not.toBeNull();
    expect(await t.query(internal.notion.budget, { installationId: lease.installationId, now: Date.now() })).toEqual(quotaBefore);
    expect(JSON.stringify(await state(t, connection))).not.toContain(fixture.auth.accessToken);
    expect(JSON.stringify(await state(t, connection))).not.toContain(connection.installation.credentialEnvelope);
    await manage(connection, "pause");
    expect(await state(t, connection)).toMatchObject({ installation: { status: "paused" }, busy: true });
    expect(await t.query(internal.notion.leaseCurrent, leaseArgs)).toBe(false);
    expect(await t.mutation(internal.notion.completeFingerprint, { ...leaseArgs, claimedRevision: lease.claimedRevision, fingerprint: "stale-fingerprint", now: Date.now() })).toBe(false);
    expect((await webhook(connection.deps, payload(fixture, "paused-event", "other-row"))).status).toBe(200);
    await t.mutation(internal.notion.finishJob, { installationId: lease.installationId, jobId: lease.jobId, leaseId: lease.leaseId, claimedRevision: lease.claimedRevision, result: "success", now: Date.now() });
    expect(await state(t, connection)).toMatchObject({ installation: { status: "paused" }, busy: false });
    await manage(connection, "region", "US");
    expect(await state(t, connection)).toMatchObject({ installation: { status: "setting_up", region: "US" }, busy: true });
    await activate(t, connection);
    await webhook(connection.deps, payload(fixture, "us-event", "milk-row"));
    const usLease = await t.mutation(internal.notion.claimJob, { installationId: lease.installationId, now: Date.now() });
    if (!usLease) throw new Error("US job was not claimed");
    expect(usLease.region).toBe("US");
    await manage(connection, "disconnect");
    expect(await state(t, connection)).toMatchObject({ installation: { status: "disconnecting" }, busy: true });
    expect(await t.mutation(internal.notion.claimDisconnect, { installationId: lease.installationId, now: Date.now() })).toBeNull();
    const rival = new NotionFixture("rival");
    const rivalConnection = await connect(t, rival);
    const snapshot = await t.query(internal.notion.installationSnapshot, { installationId: lease.installationId });
    const binding = { templatePageId: snapshot!.templatePageId!, databaseId: snapshot!.databaseId!, dataSourceId: snapshot!.dataSourceId!, properties: snapshot!.properties!, statusLabels: snapshot!.statusLabels! };
    const bindingArgs = { installationId: rivalConnection.installation._id, expectedGeneration: rivalConnection.installation.generation, binding, now: Date.now() };
    await expect(t.mutation(internal.notion.bindInstallation, bindingArgs)).rejects.toThrow("already reserved");
    await t.mutation(internal.notion.finishJob, { installationId: usLease.installationId, jobId: usLease.jobId, leaseId: usLease.leaseId, claimedRevision: usLease.claimedRevision, result: "failed", now: Date.now() });
    await t.action(internal.notionActions.disconnect, { installationId: lease.installationId });
    expect(await state(t, connection)).toBeNull();
    expect(await t.query(api.notion.disconnectReceipt, { secret: SECRET, sessionHash: connection.sessionHash, now: Date.now() })).toEqual({ permissionRemoved: true });
    expect(await t.query(internal.notion.installationSnapshot, { installationId: lease.installationId })).toBeNull();
    const remaining = await t.run(async (ctx) => ({ installations: await ctx.db.query("notionInstallations").collect(), sessions: await ctx.db.query("notionSessions").collect(), jobs: await ctx.db.query("notionJobs").collect(), events: await ctx.db.query("notionEvents").collect(), slots: await ctx.db.query("notionProcessingSlots").collect(), quotas: await ctx.db.query("notionQuotas").collect() }));
    expect(remaining.installations).toHaveLength(1);
    expect(JSON.stringify(remaining.installations)).not.toContain(connection.installation.credentialEnvelope);
    expect(remaining.sessions.every((session) => session.installationId !== lease.installationId)).toBe(true);
    expect(remaining.jobs).toEqual([]);
    expect(remaining.events).toEqual([]);
    expect(remaining.slots).toEqual([]);
    expect(remaining.quotas).toEqual([]);
    expect(fixture.calls.filter(({ url }) => url.pathname === "/v1/oauth/revoke").map(({ body }) => JSON.parse(body!))).toEqual([{ token: fixture.auth.accessToken }]);
    await expect(t.mutation(internal.notion.bindInstallation, bindingArgs)).resolves.toMatchObject({ installationId: rivalConnection.installation._id });
  });

  it("routes signed input edits to the bound workspace and keeps jobs and global leases isolated", async () => {
    const t = createBackend(), first = new NotionFixture("first"), second = new NotionFixture("second");
    vi.stubGlobal("fetch", async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const request = String(input);
      return request.includes("second-") ? second.fetch(input, init) : first.fetch(input, init);
    });
    const a = await connect(t, first), b = await connect(t, second, "US");
    await activate(t, a); await activate(t, b);
    const base = payload(first, "shared-event-id", "first-row");
    const invalidSignature = await webhook(a.deps, base, false);
    expect(invalidSignature.status).toBe(401);
    const rejected = [
      { ...base, workspace_id: second.auth.workspaceId },
      { ...base, accessible_by: [{ type: "bot", id: second.auth.botId }] },
      { ...base, data: { ...base.data, parent: { ...base.data.parent, id: second.databaseId } } },
      { ...base, data: { ...base.data, parent: { ...base.data.parent, data_source_id: second.dataSourceId } } },
      { ...base, data: { ...base.data, updated_properties: [String(first.properties["Review status"].id)] } },
    ];
    for (const event of rejected) {
      const response = await webhook(a.deps, event);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ accepted: false });
    }
    expect(await t.run((ctx) => ctx.db.query("notionJobs").collect())).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("notionEvents").collect())).toEqual([]);
    expect((await webhook(a.deps, base)).status).toBe(202);
    const duplicate = await webhook(a.deps, base);
    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toEqual({ accepted: false });
    expect((await webhook(b.deps, payload(second, "shared-event-id", "second-row"))).status).toBe(202);
    const jobs = await t.run((ctx) => ctx.db.query("notionJobs").collect());
    expect(jobs.map(({ installationId, pageId }) => ({ installationId, pageId }))).toEqual(expect.arrayContaining([{ installationId: a.installation._id, pageId: "first-row" }, { installationId: b.installation._id, pageId: "second-row" }]));
    expect(await t.run((ctx) => ctx.db.query("notionEvents").collect())).toHaveLength(2);
    const firstLease = await t.mutation(internal.notion.claimJob, { installationId: a.installation._id, now: Date.now() });
    const secondLease = await t.mutation(internal.notion.claimJob, { installationId: b.installation._id, now: Date.now() });
    if (!firstLease || !secondLease) throw new Error("Both workspace jobs must receive a lease");
    expect(await t.run((ctx) => ctx.db.query("notionProcessingSlots").collect())).toHaveLength(2);
    expect(decryptCredentials(firstLease.credentialEnvelope, first.auth, CREDENTIAL_KEY).accessToken).toBe(first.auth.accessToken);
    expect(() => decryptCredentials(firstLease.credentialEnvelope, second.auth, CREDENTIAL_KEY)).toThrow();
    await manage(a, "pause");
    expect(await t.query(internal.notion.leaseCurrent, { installationId: firstLease.installationId, jobId: firstLease.jobId, leaseId: firstLease.leaseId, generation: firstLease.generation, now: Date.now() })).toBe(false);
    expect(await t.query(internal.notion.leaseCurrent, { installationId: secondLease.installationId, jobId: secondLease.jobId, leaseId: secondLease.leaseId, generation: secondLease.generation, now: Date.now() })).toBe(true);
    expect(await state(t, b)).toMatchObject({ installation: { status: "active", region: "US" }, busy: false });
  });

  it("returns the disabled response from the real Next routes without contacting Convex", async () => {
    vi.stubEnv("NOTION_INSTALL_ENABLED", "false");
    const external = vi.fn(async () => { throw new Error("Disabled setup must not make external requests"); });
    vi.stubGlobal("fetch", external);
    const requests = [
      () => connectRoute(new Request(`${ORIGIN}/api/notion/connect?region=UK`)),
      () => callbackRoute(new Request(`${ORIGIN}/api/notion/callback?code=unused`)),
      () => manageRoute(new Request(`${ORIGIN}/api/notion/manage`, { method: "POST" })),
      () => webhookRoute(new Request(`${ORIGIN}/api/notion/webhook`, { method: "POST" })),
    ];
    for (const request of requests) {
      const response = await request();
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "notion_setup_disabled" });
    }
    expect(fetchMutation).not.toHaveBeenCalled();
    expect(fetchQuery).not.toHaveBeenCalled();
    expect(external).not.toHaveBeenCalled();
  });
});
