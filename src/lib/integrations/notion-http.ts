import { constants, createHash, createHmac, createPublicKey, publicEncrypt, randomBytes, timingSafeEqual } from "node:crypto";

import type { Id } from "@convex/_generated/dataModel";
import { encryptCredentials } from "../../../integrations/notion/hosted/crypto.ts";
import type { Authorization, InstallationStatus, Region } from "../../../integrations/notion/managed/types.ts";
import { getNotionInstallationOrigin } from "./notion-installation";

export type NotionManagement = {
  installation: { id: Id<"notionInstallations">; region: Region; status: InstallationStatus; binding?: { databaseId: string }; errorCode?: string };
  busy: boolean;
  budget: { allowed: boolean; retryAt: number };
};
export type NotionHttpBackend = {
  beginOAuth(args: { stateHash: string; bindingHash: string; region: Region; installationId?: Id<"notionInstallations">; now: number }): Promise<unknown>;
  consumeOAuth(args: { stateHash: string; bindingHash: string; now: number }): Promise<{ region: Region; installationId?: Id<"notionInstallations"> | null } | null>;
  authorize(args: { ownerId: string; workspaceId: string; botId: string; templatePageId?: string; region: Region; credentialEnvelope: string; now: number; expectedInstallationId?: Id<"notionInstallations"> }): Promise<{ installationId: Id<"notionInstallations"> }>;
  createSession(args: { sessionHash: string; installationId: Id<"notionInstallations">; csrfHash: string; expiresAt: number; now: number }): Promise<unknown>;
  management(args: { sessionHash: string; now: number }): Promise<NotionManagement | null>;
  control(args: { sessionHash: string; csrfHash: string; action: "pause" | "resume" | "retry" | "disconnect" | "region"; region?: Region; now: number }): Promise<unknown>;
  receiveWebhook(args: { workspaceId: string; botIds: string[]; databaseId: string; dataSourceId?: string; pageId: string; eventHash: string; type: "page.created" | "page.properties_updated"; updatedProperties: string[]; now: number }): Promise<{ result: string }>;
};
export type NotionHttpDependencies = {
  origin: string;
  encryptionKey: string;
  csrfSecret: string;
  webhookToken: string;
  integrationId: string;
  subscriptionId: string;
  backend: NotionHttpBackend;
  oauth: { authorizationUrl(state: string): string; exchange(code: string, signal: AbortSignal): Promise<Authorization> };
};
const OAUTH_TTL = 10 * 60_000;
const SESSION_TTL = 30 * 24 * 60 * 60_000;
export const notionWebhookCaptureLabel = "eat-or-yeet/notion-webhook-verification/v1";

/** Capture an untrusted setup candidate, encrypted for a local operator, without trusting it. */
export async function captureNotionWebhookVerification(request: Request, environment: NodeJS.ProcessEnv = process.env): Promise<Response | null> {
  const origin = getNotionInstallationOrigin(environment);
  const publicKey = environment.NOTION_WEBHOOK_SETUP_PUBLIC_KEY;
  const expiresAt = Number(environment.NOTION_WEBHOOK_SETUP_EXPIRES_AT);
  const remaining = expiresAt - Date.now();
  if (!origin || environment.NOTION_WEBHOOK_VERIFICATION_TOKEN?.trim() || !publicKey || !Number.isFinite(remaining) || remaining <= 0 || remaining > 15 * 60_000) return null;
  if (new URL(request.url).origin !== origin) return json(400, { error: "invalid_verification_request" });
  if (!request.headers.get("content-type")?.startsWith("application/json")) return json(400, { error: "invalid_verification_request" });
  try {
    const raw = await readBody(request, 2_048);
    if (!raw) return json(413, { error: "body_too_large" });
    const payload: unknown = JSON.parse(new TextDecoder().decode(raw));
    if (!record(payload) || Object.keys(payload).length !== 1 || typeof payload.verification_token !== "string" || !/^secret_[A-Za-z0-9_-]{20,120}$/.test(payload.verification_token)) return json(400, { error: "invalid_verification_request" });
    // Notion may sign the bootstrap request with the candidate it contains.
    // This proves consistency only; the portal still has to verify the candidate.
    const signature = request.headers.get("x-notion-signature");
    if (signature !== null && !same(signature, `sha256=${createHmac("sha256", payload.verification_token).update(raw).digest("hex")}`)) return json(400, { error: "invalid_verification_request" });
    const key = createPublicKey(publicKey);
    if (key.asymmetricKeyType !== "rsa" || !key.asymmetricKeyDetails?.modulusLength || key.asymmetricKeyDetails.modulusLength < 2_048) return json(503, { error: "temporarily_unavailable" });
    const encrypted = publicEncrypt({ key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256", oaepLabel: Buffer.from(notionWebhookCaptureLabel) }, Buffer.from(payload.verification_token)).toString("base64");
    // Never log or return the plaintext token. Notion's portal must verify the candidate
    // before an operator promotes it to NOTION_WEBHOOK_VERIFICATION_TOKEN.
    console.info("notion_webhook_verification_candidate", encrypted);
    return json(202, { received: true });
  } catch { return json(400, { error: "invalid_verification_request" }); }
}

export function notionCookieNames(origin: string) {
  const prefix = new URL(origin).protocol === "https:" ? "__Host-" : "";
  return { session: `${prefix}eoy_notion`, oauth: `${prefix}eoy_notion_oauth` };
}
export function notionHash(value: string) { return createHash("sha256").update(value).digest("hex"); }
export function notionCsrf(session: string, secret: string) { return createHmac("sha256", secret).update(`notion-csrf:${session}`).digest("base64url"); }

export async function handleNotionRequest(kind: "connect" | "callback" | "manage" | "webhook", request: Request, deps: NotionHttpDependencies): Promise<Response> {
  try {
    const url = new URL(request.url);
    if (url.origin !== deps.origin || request.url.length > 2_048) return json(400, { error: "invalid_request" });
    if (kind === "webhook") return await webhook(request, deps);
    const names = notionCookieNames(deps.origin);
    const cookies = parseCookies(request.headers.get("cookie"));
    const rawSession = cookies[names.session] ?? "";
    if (kind === "connect") {
      if (request.headers.get("purpose") === "prefetch" || request.headers.get("sec-purpose") === "prefetch" || request.headers.has("next-router-prefetch")) return new Response(null, { status: 204 });
      const region = parseRegion(url.searchParams.get("region"));
      if (!region) return json(400, { error: "choose_country" });
      const management = rawSession ? await deps.backend.management({ sessionHash: notionHash(rawSession), now: Date.now() }) : null;
      const state = randomBytes(32).toString("base64url");
      const binding = randomBytes(32).toString("base64url");
      await deps.backend.beginOAuth({ stateHash: notionHash(state), bindingHash: notionHash(binding), region, ...(management ? { installationId: management.installation.id } : {}), now: Date.now() });
      const response = redirect(deps.oauth.authorizationUrl(state));
      response.headers.append("set-cookie", cookie(names.oauth, binding, OAUTH_TTL / 1_000, deps.origin));
      return response;
    }
    if (kind === "callback") {
      const state = url.searchParams.get("state");
      const binding = cookies[names.oauth];
      const pending = state && binding && state.length <= 512 ? await deps.backend.consumeOAuth({ stateHash: notionHash(state), bindingHash: notionHash(binding), now: Date.now() }) : null;
      const done = (destination: string) => {
        const response = redirect(new URL(destination, deps.origin).href);
        response.headers.append("set-cookie", cookie(names.oauth, "", 0, deps.origin));
        return response;
      };
      if (!pending) return done("/integrations/notion?error=expired");
      if (url.searchParams.has("error")) return done("/integrations/notion?error=cancelled");
      const code = url.searchParams.get("code");
      if (!code || code.length > 1_024) return done("/integrations/notion?error=setup_unavailable");
      try {
        const auth = await deps.oauth.exchange(code, AbortSignal.timeout(15_000));
        const installed = await deps.backend.authorize({ ownerId: auth.ownerId, workspaceId: auth.workspaceId, botId: auth.botId, ...(auth.templatePageId ? { templatePageId: auth.templatePageId } : {}), region: pending.region, credentialEnvelope: encryptCredentials({ accessToken: auth.accessToken, refreshToken: auth.refreshToken }, auth, deps.encryptionKey), now: Date.now(), ...(pending.installationId ? { expectedInstallationId: pending.installationId } : {}) });
        const session = randomBytes(32).toString("base64url");
        await deps.backend.createSession({ sessionHash: notionHash(session), installationId: installed.installationId, csrfHash: notionHash(notionCsrf(session, deps.csrfSecret)), expiresAt: Date.now() + SESSION_TTL, now: Date.now() });
        const response = done("/integrations/notion/manage");
        response.headers.append("set-cookie", cookie(names.session, session, SESSION_TTL / 1_000, deps.origin));
        return response;
      } catch { return done("/integrations/notion?error=setup_unavailable"); }
    }
    if (request.headers.get("origin") !== deps.origin || !request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) return json(403, { error: "invalid_origin" });
    if (!rawSession) return json(401, { error: "reconnect_required" });
    const body = await readBody(request, 4_096);
    if (!body) return json(413, { error: "body_too_large" });
    const form = new URLSearchParams(new TextDecoder().decode(body));
    const csrf = form.get("csrf") ?? "";
    if (!same(csrf, notionCsrf(rawSession, deps.csrfSecret))) return json(403, { error: "invalid_form" });
    const action = form.get("action");
    if (action !== "pause" && action !== "resume" && action !== "retry" && action !== "region" && action !== "disconnect") return json(400, { error: "invalid_action" });
    const region = parseRegion(form.get("region"));
    if (action === "region" && !region) return json(400, { error: "invalid_region" });
    await deps.backend.control({ sessionHash: notionHash(rawSession), csrfHash: notionHash(csrf), action, ...(region ? { region } : {}), now: Date.now() });
    // Keep the cookie while disconnect drains. The management page can report completion after durable removal.
    return redirect(new URL("/integrations/notion/manage", deps.origin).href);
  } catch { return json(503, { error: "temporarily_unavailable" }); }
}

async function webhook(request: Request, deps: NotionHttpDependencies): Promise<Response> {
  const raw = await readBody(request, 32 * 1_024);
  if (!raw) return json(413, { error: "body_too_large" });
  const signature = request.headers.get("x-notion-signature") ?? "";
  const expected = `sha256=${createHmac("sha256", deps.webhookToken).update(raw).digest("hex")}`;
  let payload: unknown;
  try { payload = JSON.parse(new TextDecoder().decode(raw)); } catch { return json(400, { error: "invalid_json" }); }
  if (record(payload) && Object.keys(payload).length === 1 && typeof payload.verification_token === "string" && same(payload.verification_token, deps.webhookToken)) return json(200, { verification_token: deps.webhookToken });
  if (!same(signature, expected)) {
    return json(401, { error: "invalid_signature" });
  }
  if (!record(payload) || payload.integration_id !== deps.integrationId || payload.subscription_id !== deps.subscriptionId || !shortString(payload.workspace_id) || !shortString(payload.id) || !record(payload.entity) || payload.entity.type !== "page" || !shortString(payload.entity.id)) return json(400, { error: "invalid_event" });
  if (payload.type !== "page.created" && payload.type !== "page.properties_updated") return json(200, { accepted: false });
  if (!Array.isArray(payload.accessible_by) || payload.accessible_by.length > 20) return json(400, { error: "invalid_recipients" });
  const botIds = [...new Set(payload.accessible_by.filter(record).filter((entry) => entry.type === "bot" && shortString(entry.id)).map((entry) => entry.id as string))];
  const data = record(payload.data) ? payload.data : {};
  const parent = record(data.parent) ? data.parent : undefined;
  if (!parent || parent.type !== "database" || !shortString(parent.id) || (parent.data_source_id !== undefined && !shortString(parent.data_source_id))) return json(200, { accepted: false });
  const updated = data.updated_properties;
  if (payload.type === "page.properties_updated" && (!Array.isArray(updated) || updated.length > 100 || !updated.every(shortString))) return json(400, { error: "invalid_properties" });
  if (!botIds.length) return json(200, { accepted: false });
  const result = await deps.backend.receiveWebhook({ workspaceId: payload.workspace_id, botIds, databaseId: parent.id, ...(typeof parent.data_source_id === "string" ? { dataSourceId: parent.data_source_id } : {}), pageId: payload.entity.id, eventHash: notionHash(payload.id), type: payload.type, updatedProperties: Array.isArray(updated) ? updated as string[] : [], now: Date.now() });
  if (result.result === "full" || result.result === "setting_up") return json(503, { error: "queue_unavailable" });
  const accepted = result.result === "accepted";
  return json(accepted ? 202 : 200, { accepted });
}
function parseCookies(header: string | null): Record<string, string> {
  return Object.fromEntries((header ?? "").split(";").map((entry) => entry.trim().split("=", 2)).filter(([name, value]) => name && value && value.length <= 512));
}
function cookie(name: string, value: string, maxAge: number, origin: string) { return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${new URL(origin).protocol === "https:" ? "; Secure" : ""}`; }
function same(a: string, b: string) { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }
function parseRegion(value: string | null): Region | undefined { return value === "UK" || value === "US" ? value : undefined; }
function shortString(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 1_024; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function json(status: number, body: unknown) { return Response.json(body, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } }); }
function redirect(destination: string) { return new Response(null, { status: 303, headers: { location: destination, "cache-control": "no-store", "referrer-policy": "no-referrer" } }); }
async function readBody(request: Request, limit: number): Promise<Uint8Array | null> {
  if (Number(request.headers.get("content-length")) > limit) return null;
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let complete = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) { complete = true; break; }
      length += value.byteLength;
      if (length > limit) return null;
      chunks.push(value);
    }
    const body = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return body;
  } finally { if (!complete) await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
