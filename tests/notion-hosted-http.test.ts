import { createHmac } from "node:crypto";
import type { Id } from "@convex/_generated/dataModel";
import { describe, expect, it } from "vitest";
import { decryptCredentials } from "../integrations/notion/hosted/crypto.ts";
import type { Authorization, InstallationStatus, Region } from "../integrations/notion/managed/types.ts";
import {
  handleNotionRequest,
  notionCookieNames,
  notionCsrf,
  notionHash,
  type NotionHttpBackend,
  type NotionHttpDependencies,
  type NotionManagement,
} from "../src/lib/integrations/notion-http.ts";

const ORIGIN = "https://notion.example.test";
const ENCRYPTION_KEY = Buffer.alloc(32, 29).toString("base64");
const CSRF_SECRET = "private-csrf-secret";
const WEBHOOK_TOKEN = "private-webhook-token";
const INSTALLATION_ID = "notionInstallations:installation-1" as Id<"notionInstallations">;
const AUTH: Authorization = {
  ownerId: "notion-owner-1", workspaceId: "notion-workspace-1", botId: "notion-bot-1",
  templatePageId: "template-page-1", accessToken: "access-token-sensitive", refreshToken: "refresh-token-sensitive",
};

type InstallationRecord = {
  id: Id<"notionInstallations">;
  ownerId: string;
  workspaceId: string;
  botId: string;
  region: Region;
  status: InstallationStatus;
  binding?: { databaseId: string };
};
type Call = { method: string; args: unknown };
type OAuthPending = { bindingHash: string; region: "UK" | "US"; installationId?: Id<"notionInstallations">; expiresAt: number };

function backendDouble(options: { webhookResult?: string; busyDisconnect?: boolean } = {}) {
  const calls: Call[] = [];
  const oauthPending = new Map<string, OAuthPending>();
  const installations = new Map<Id<"notionInstallations">, InstallationRecord>();
  const sessions = new Map<string, { installationId: Id<"notionInstallations">; csrfHash: string; expiresAt: number }>();
  let serial = 1;
  let releaseDisconnect: (() => void) | undefined;
  let disconnectEntered: (() => void) | undefined;
  const disconnectGate = options.busyDisconnect ? new Promise<void>((resolve) => { releaseDisconnect = resolve; }) : null;
  const disconnectStarted = options.busyDisconnect ? new Promise<void>((resolve) => { disconnectEntered = resolve; }) : null;
  const backend: NotionHttpBackend = {
    beginOAuth: async (args) => {
      calls.push({ method: "beginOAuth", args });
      oauthPending.set(args.stateHash, { bindingHash: args.bindingHash, region: args.region, ...(args.installationId ? { installationId: args.installationId } : {}), expiresAt: args.now + 10 * 60_000 });
    },
    consumeOAuth: async (args) => {
      calls.push({ method: "consumeOAuth", args });
      const pending = oauthPending.get(args.stateHash);
      if (!pending || pending.expiresAt <= args.now || pending.bindingHash !== args.bindingHash) return null;
      oauthPending.delete(args.stateHash);
      return { region: pending.region, ...(pending.installationId ? { installationId: pending.installationId } : {}) };
    },
    authorize: async (args) => {
      calls.push({ method: "authorize", args });
      const existing = [...installations.values()].find((row) => row.ownerId === args.ownerId && row.workspaceId === args.workspaceId);
      if (args.expectedInstallationId && existing?.id !== args.expectedInstallationId) throw new Error("Installation ownership check failed");
      const installationId = existing?.id ?? (`notionInstallations:installation-${serial++}` as Id<"notionInstallations">);
      installations.set(installationId, {
        id: installationId, ownerId: args.ownerId, workspaceId: args.workspaceId, botId: args.botId,
        region: args.region, status: "setting_up",
      });
      return { installationId };
    },
    createSession: async (args) => {
      calls.push({ method: "createSession", args });
      sessions.set(args.sessionHash, { installationId: args.installationId, csrfHash: args.csrfHash, expiresAt: args.expiresAt });
    },
    management: async (args) => {
      calls.push({ method: "management", args });
      const session = sessions.get(args.sessionHash);
      const installation = session && installations.get(session.installationId);
      if (!session || !installation || session.expiresAt <= args.now) return null;
      return { installation: { id: installation.id, region: installation.region, status: installation.status, ...(installation.binding ? { binding: installation.binding } : {}) }, busy: false, budget: { allowed: true, retryAt: 0 } } satisfies NotionManagement;
    },
    control: async (args) => {
      calls.push({ method: "control", args });
      const session = sessions.get(args.sessionHash);
      if (!session || session.csrfHash !== args.csrfHash) throw new Error("Management authorization failed");
      if (args.action === "disconnect" && disconnectGate) {
        disconnectEntered?.();
        await disconnectGate;
      }
      const installation = installations.get(session.installationId);
      if (installation) {
        if (args.action === "disconnect") installation.status = "disconnecting";
        else if (args.action === "pause") installation.status = "paused";
        else if (args.action === "resume") installation.status = "active";
        else if (args.action === "region" && args.region) installation.region = args.region;
      }
      return { accepted: true };
    },
    receiveWebhook: async (args) => {
      calls.push({ method: "receiveWebhook", args });
      return { result: options.webhookResult ?? "accepted" };
    },
  };
  return {
    backend, calls, installations, sessions,
    disconnectStarted,
    releaseDisconnect: () => releaseDisconnect?.(),
  };
}

function dependencies(double = backendDouble()) {
  const oauth = {
    state: "",
    authorizationUrl(state: string) { this.state = state; return `https://api.notion.com/v1/oauth/authorize?state=${encodeURIComponent(state)}`; },
    auth: { ...AUTH } as Authorization,
    exchanged: [] as string[],
    async exchange(code: string) { this.exchanged.push(code); return this.auth; },
  };
  const deps: NotionHttpDependencies = {
    origin: ORIGIN, encryptionKey: ENCRYPTION_KEY, csrfSecret: CSRF_SECRET, webhookToken: WEBHOOK_TOKEN,
    integrationId: "integration-id", subscriptionId: "subscription-id", backend: double.backend, oauth,
  };
  return { deps, oauth, ...double };
}

function cookie(response: Response, name: string): { value: string; header: string } {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const header = (headers.getSetCookie?.() ?? [response.headers.get("set-cookie") ?? ""]).find((value) => value.startsWith(`${name}=`));
  if (!header) throw new Error(`Missing ${name} cookie`);
  return { value: header.split(";", 1)[0].slice(name.length + 1), header };
}

function request(path: string, options: { method?: string; headers?: HeadersInit; body?: BodyInit } = {}): Request {
  return new Request(new URL(path, ORIGIN), options);
}

async function beginConnect(app: ReturnType<typeof dependencies>, region = "UK", headers: HeadersInit = {}) {
  const response = await handleNotionRequest("connect", request(`/integrations/notion/connect?region=${region}`, { headers }), app.deps);
  const names = notionCookieNames(ORIGIN);
  const state = new URL(response.headers.get("location")!).searchParams.get("state")!;
  return { response, state, binding: cookie(response, names.oauth) };
}

async function completeCallback(app: ReturnType<typeof dependencies>, state: string, binding: string, query = "code=oauth-code") {
  return handleNotionRequest("callback", request(`/integrations/notion/callback?state=${encodeURIComponent(state)}&${query}`, { headers: { cookie: `${notionCookieNames(ORIGIN).oauth}=${binding}` } }), app.deps);
}

async function connectAndInstall(app: ReturnType<typeof dependencies>, region = "UK") {
  const pending = await beginConnect(app, region);
  const response = await completeCallback(app, pending.state, pending.binding.value);
  return { pending, response, session: cookie(response, notionCookieNames(ORIGIN).session) };
}

function webhookSignature(body: string): string { return `sha256=${createHmac("sha256", WEBHOOK_TOKEN).update(body).digest("hex")}`; }
function webhookPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "event-1", type: "page.properties_updated", integration_id: "integration-id", subscription_id: "subscription-id",
    workspace_id: "workspace-1", entity: { type: "page", id: "page-1" },
    accessible_by: [{ type: "bot", id: "bot-1" }],
    data: { parent: { type: "database", id: "database-1", data_source_id: "source-1" }, updated_properties: ["property-1", "property-2"] },
    ...overrides,
  };
}

describe("hosted Notion HTTP handlers", () => {
  it("binds OAuth state to a hashed browser cookie and enforces the fixed canonical origin", async () => {
    const app = dependencies();
    const connected = await beginConnect(app, "US");
    const bindingName = notionCookieNames(ORIGIN).oauth;
    expect(connected.response.status).toBe(303);
    expect(connected.response.headers.get("location")).toContain("https://api.notion.com/v1/oauth/authorize");
    expect(connected.binding.header).toContain("HttpOnly");
    expect(connected.binding.header).toContain("Secure");
    expect(connected.binding.header).toContain("SameSite=Lax");
    expect(app.calls).toContainEqual({ method: "beginOAuth", args: expect.objectContaining({ stateHash: notionHash(connected.state), bindingHash: notionHash(connected.binding.value), region: "US" }) });
    expect(JSON.stringify(app.calls)).not.toContain(connected.state);
    expect(JSON.stringify(app.calls)).not.toContain(connected.binding.value);

    const wrongOrigin = await handleNotionRequest("connect", new Request("https://attacker.example/integrations/notion/connect?region=UK"), app.deps);
    const invalidRegion = await handleNotionRequest("connect", request("/integrations/notion/connect?region=FR"), app.deps);
    expect(wrongOrigin.status).toBe(400);
    expect(invalidRegion.status).toBe(400);
    expect(app.calls.filter((call) => call.method === "beginOAuth")).toHaveLength(1);

    const prefetch = await handleNotionRequest("connect", request("/integrations/notion/connect?region=UK", { headers: { purpose: "prefetch" } }), app.deps);
    expect(prefetch.status).toBe(204);
    expect(app.calls.filter((call) => call.method === "beginOAuth")).toHaveLength(1);
    expect(bindingName).toBe("__Host-eoy_notion_oauth");
  });

  it("consumes state once, rejects the wrong browser binding, and stores only scoped encrypted credentials", async () => {
    const app = dependencies();
    const pending = await beginConnect(app, "US");
    const wrongBrowser = await completeCallback(app, pending.state, "different-browser-cookie");
    expect(wrongBrowser.status).toBe(303);
    expect(wrongBrowser.headers.get("location")).toContain("error=expired");
    expect(app.oauth.exchanged).toEqual([]);

    const completed = await completeCallback(app, pending.state, pending.binding.value);
    expect(completed.status).toBe(303);
    expect(completed.headers.get("location")).toBe(`${ORIGIN}/integrations/notion/manage`);
    const sessionCookie = cookie(completed, notionCookieNames(ORIGIN).session);
    expect(sessionCookie.header).toContain("HttpOnly");
    expect(sessionCookie.header).toContain("Secure");
    expect(app.oauth.exchanged).toEqual(["oauth-code"]);
    const authorizeCall = app.calls.find((call) => call.method === "authorize")?.args as { credentialEnvelope: string; region: string };
    expect(authorizeCall.region).toBe("US");
    expect(authorizeCall.credentialEnvelope).not.toContain(AUTH.accessToken);
    expect(authorizeCall.credentialEnvelope).not.toContain(AUTH.refreshToken);
    expect(decryptCredentials(authorizeCall.credentialEnvelope, { ownerId: AUTH.ownerId, workspaceId: AUTH.workspaceId }, ENCRYPTION_KEY)).toEqual({ accessToken: AUTH.accessToken, refreshToken: AUTH.refreshToken });
    expect(() => decryptCredentials(authorizeCall.credentialEnvelope, { ownerId: "other-owner", workspaceId: AUTH.workspaceId }, ENCRYPTION_KEY)).toThrow("could not be authenticated");
    expect(JSON.stringify(app.calls)).not.toContain(AUTH.accessToken);
    expect(JSON.stringify(app.calls)).not.toContain(AUTH.refreshToken);
    expect(app.sessions.has(notionHash(sessionCookie.value))).toBe(true);

    const replay = await completeCallback(app, pending.state, pending.binding.value);
    expect(replay.headers.get("location")).toContain("error=expired");
    expect(app.oauth.exchanged).toHaveLength(1);

    const cancel = await beginConnect(app);
    const cancelled = await completeCallback(app, cancel.state, cancel.binding.value, "error=access_denied");
    expect(cancelled.headers.get("location")).toContain("error=cancelled");
    expect(app.oauth.exchanged).toHaveLength(1);
  });

  it("carries the original installation owner binding through reconnect authorization", async () => {
    const app = dependencies();
    const first = await connectAndInstall(app);
    const installationId = (app.calls.find((call) => call.method === "createSession")?.args as { installationId: Id<"notionInstallations"> }).installationId;
    expect(installationId).toBeTruthy();
    const sessionName = notionCookieNames(ORIGIN).session;
    const reconnect = await beginConnect(app, "US", { cookie: `${sessionName}=${first.session.value}` });
    const beginArgs = app.calls.filter((call) => call.method === "beginOAuth").at(-1)?.args as { installationId?: Id<"notionInstallations">; region: string };
    expect(beginArgs).toEqual({ stateHash: notionHash(reconnect.state), bindingHash: notionHash(reconnect.binding.value), region: "US", installationId, now: expect.any(Number) });

    app.oauth.auth = { ...AUTH, ownerId: "another-notion-owner" };
    const denied = await completeCallback(app, reconnect.state, reconnect.binding.value);
    expect(denied.headers.get("location")).toContain("error=setup_unavailable");
    const authorizeArgs = app.calls.filter((call) => call.method === "authorize").at(-1)?.args as { expectedInstallationId?: Id<"notionInstallations"> };
    expect(authorizeArgs.expectedInstallationId).toBe(installationId);
    expect(app.installations.size).toBe(1);
    expect(first.response.headers.get("location")).toBe(`${ORIGIN}/integrations/notion/manage`);
  });

  it("requires same-origin form posts and a session-derived CSRF token", async () => {
    const app = dependencies();
    const installed = await connectAndInstall(app);
    const sessionName = notionCookieNames(ORIGIN).session;
    const headers = { cookie: `${sessionName}=${installed.session.value}`, "content-type": "application/x-www-form-urlencoded" };
    const csrf = notionCsrf(installed.session.value, CSRF_SECRET);
    const crossOrigin = await handleNotionRequest("manage", request("/integrations/notion/manage", { method: "POST", headers: { ...headers, origin: "https://other.example" }, body: new URLSearchParams({ action: "pause", csrf }) }), app.deps);
    const badCsrf = await handleNotionRequest("manage", request("/integrations/notion/manage", { method: "POST", headers: { ...headers, origin: ORIGIN }, body: "action=pause&csrf=wrong" }), app.deps);
    const noSession = await handleNotionRequest("manage", request("/integrations/notion/manage", { method: "POST", headers: { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ action: "pause", csrf }) }), app.deps);
    expect(crossOrigin.status).toBe(403);
    expect(badCsrf.status).toBe(403);
    expect(noSession.status).toBe(401);
    expect(app.calls.filter((call) => call.method === "control")).toHaveLength(0);

    const accepted = await handleNotionRequest("manage", request("/integrations/notion/manage", { method: "POST", headers: { ...headers, origin: ORIGIN }, body: new URLSearchParams({ action: "region", region: "US", csrf }) }), app.deps);
    expect(accepted.status).toBe(303);
    expect(accepted.headers.get("location")).toBe(`${ORIGIN}/integrations/notion/manage`);
    expect(app.calls.find((call) => call.method === "control")?.args).toEqual({ sessionHash: notionHash(installed.session.value), csrfHash: notionHash(csrf), action: "region", region: "US", now: expect.any(Number) });
  });

  it("waits for disconnect acceptance and retains the management cookie while it drains", async () => {
    const app = dependencies(backendDouble({ busyDisconnect: true }));
    const installed = await connectAndInstall(app);
    const sessionName = notionCookieNames(ORIGIN).session;
    const csrf = notionCsrf(installed.session.value, CSRF_SECRET);
    let responseReady = false;
    const pending = handleNotionRequest("manage", request("/integrations/notion/manage", {
      method: "POST",
      headers: { cookie: `${sessionName}=${installed.session.value}`, origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ action: "disconnect", csrf }),
    }), app.deps).then((response) => { responseReady = true; return response; });
    await app.disconnectStarted;
    expect(responseReady).toBe(false);
    app.releaseDisconnect();
    const response = await pending;
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/integrations/notion/manage`);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(app.installations.get(INSTALLATION_ID)?.status ?? [...app.installations.values()][0]?.status).toBe("disconnecting");
  });

  it("bounds and verifies raw webhook bodies, validates operator challenges, and normalizes routed fields", async () => {
    const app = dependencies();
    const raw = ` {"id":"event-1", "type":"page.properties_updated", "integration_id":"integration-id", "subscription_id":"subscription-id", "workspace_id":"workspace-1", "entity":{"type":"page","id":"page-1"}, "accessible_by":[{"type":"bot","id":"bot-1"},{"type":"user","id":"person-1"},{"type":"bot","id":"bot-1"}], "data":{"parent":{"type":"database","id":"database-1","data_source_id":"source-1"},"updated_properties":["property-1","property-2"]}} `;
    const accepted = await handleNotionRequest("webhook", request("/integrations/notion/webhook", { method: "POST", headers: { "x-notion-signature": webhookSignature(raw) }, body: raw }), app.deps);
    expect(accepted.status).toBe(202);
    expect(await accepted.json()).toEqual({ accepted: true });
    expect(app.calls.find((call) => call.method === "receiveWebhook")?.args).toEqual({
      workspaceId: "workspace-1", botIds: ["bot-1"], databaseId: "database-1", dataSourceId: "source-1", pageId: "page-1",
      eventHash: notionHash("event-1"), type: "page.properties_updated", updatedProperties: ["property-1", "property-2"], now: expect.any(Number),
    });

    const wrongRawSignature = await handleNotionRequest("webhook", request("/integrations/notion/webhook", { method: "POST", headers: { "x-notion-signature": webhookSignature(raw.trim()) }, body: raw }), app.deps);
    expect(wrongRawSignature.status).toBe(401);
    const wrongIntegration = JSON.stringify(webhookPayload({ integration_id: "other" }));
    const wrongSubscription = JSON.stringify(webhookPayload({ subscription_id: "other" }));
    expect((await handleNotionRequest("webhook", request("/integrations/notion/webhook", { method: "POST", headers: { "x-notion-signature": webhookSignature(wrongIntegration) }, body: wrongIntegration }), app.deps)).status).toBe(400);
    expect((await handleNotionRequest("webhook", request("/integrations/notion/webhook", { method: "POST", headers: { "x-notion-signature": webhookSignature(wrongSubscription) }, body: wrongSubscription }), app.deps)).status).toBe(400);

    const challenge = JSON.stringify({ verification_token: WEBHOOK_TOKEN });
    const validChallenge = await handleNotionRequest("webhook", request("/integrations/notion/webhook", { method: "POST", body: challenge }), app.deps);
    expect(validChallenge.status).toBe(200);
    expect(await validChallenge.json()).toEqual({ verification_token: WEBHOOK_TOKEN });
    const invalidJson = await handleNotionRequest("webhook", request("/integrations/notion/webhook", { method: "POST", body: "{" }), app.deps);
    const extraChallengeField = await handleNotionRequest("webhook", request("/integrations/notion/webhook", { method: "POST", body: JSON.stringify({ verification_token: WEBHOOK_TOKEN, extra: true }) }), app.deps);
    const wrongChallengeToken = await handleNotionRequest("webhook", request("/integrations/notion/webhook", { method: "POST", body: JSON.stringify({ verification_token: "wrong" }) }), app.deps);
    expect(invalidJson.status).toBe(400);
    expect(extraChallengeField.status).toBe(401);
    expect(wrongChallengeToken.status).toBe(401);

    const oversized = "x".repeat(32 * 1_024 + 1);
    const tooLarge = await handleNotionRequest("webhook", request("/integrations/notion/webhook", { method: "POST", body: oversized }), app.deps);
    expect(tooLarge.status).toBe(413);
  });

  it("rejects ambiguous webhook parents and requests redelivery while setup or queue admission is unavailable", async () => {
    const app = dependencies();
    const send = async (payload: unknown) => {
      const body = JSON.stringify(payload);
      return handleNotionRequest("webhook", request("/integrations/notion/webhook", { method: "POST", headers: { "x-notion-signature": webhookSignature(body) }, body }), app.deps);
    };
    const base = webhookPayload();
    const invalidParents = [
      undefined,
      { type: "page", id: "page-1" },
      { type: "workspace", id: "workspace-1" },
      { type: "unknown", id: "database-1" },
      { type: "database", id: "" },
      { type: "database", id: "database-1", data_source_id: [] },
    ];
    for (const parent of invalidParents) {
      const data = parent === undefined ? {} : { parent };
      const response = await send({ ...base, data });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ accepted: false });
    }
    const noBot = await send({ ...base, accessible_by: [{ type: "user", id: "user-1" }] });
    expect(noBot.status).toBe(200);
    expect(app.calls.filter((call) => call.method === "receiveWebhook")).toHaveLength(0);

    const body = JSON.stringify(base);
    for (const webhookResult of ["full", "setting_up"]) {
      const unavailable = dependencies(backendDouble({ webhookResult }));
      const response = await handleNotionRequest("webhook", request("/integrations/notion/webhook", { method: "POST", headers: { "x-notion-signature": webhookSignature(body) }, body }), unavailable.deps);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "queue_unavailable" });
    }
  });
});
