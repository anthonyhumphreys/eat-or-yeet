import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { verifySignature } from "../shopping-worker.ts";
import type { Installation, ManagedConfig, ManagementSession, Region } from "./types.ts";
import { ManagedStore } from "./store.ts";
import { NotionOAuthApi } from "./notion-api.ts";
import { ManagedRuntime } from "./runtime.ts";

const OAUTH_TTL = 10 * 60_000;
const SESSION_TTL = 30 * 24 * 60 * 60_000;
const MAX_WEBHOOK_BYTES = 32 * 1024;

type Runtime = Pick<ManagedRuntime, "activate" | "suspendForAuthorization" | "pause" | "changeRegion" | "disconnect" | "enqueue" | "state">;
type OAuthApi = Pick<NotionOAuthApi, "authorizationUrl" | "exchange">;

export function createManagedServer(config: ManagedConfig, store: ManagedStore, api: OAuthApi, runtime: Runtime) {
  const secure = new URL(config.publicOrigin).protocol === "https:";
  const sessionCookie = secure ? "__Host-eoy_notion" : "eoy_notion";
  const oauthCookie = secure ? "__Host-eoy_notion_oauth" : "eoy_notion_oauth";
  let recentAuth: number[] = [];
  let requests = 0;

  const server = createServer((request, response) => {
    void handle(request, response).catch(() => {
      if (!response.headersSent) html(response, 503, "Please try again", "<p>Notion setup could not finish. Return to setup to retry or reconnect.</p>" + link("/", "Return to setup"));
      else response.end();
    });
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxConnections = 100;
  return server;

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    requests += 1;
    if (requests % 100 === 0) store.cleanup(Date.now());
    const url = new URL(request.url ?? "/", config.publicOrigin);
    if (url.pathname === "/health" && request.method === "GET") {
      json(response, 200, { enabled: config.enabled }); return;
    }
    if (!config.enabled) { html(response, 503, "Notion setup is not available yet", link(`${config.websiteOrigin}/integrations/notion`, "Return to Eat or Yeet")); return; }
    // Use operator-configured origins and ignore forwarded-host claims.
    if (url.origin !== config.publicOrigin || request.headers.host !== new URL(config.publicOrigin).host || (request.url?.length ?? 0) > 2_048) {
      json(response, 400, { error: "invalid_request" }); return;
    }
    if (request.method === "POST" && url.pathname === "/webhooks/notion") { await webhook(request, response); return; }
    const cookies = parseCookies(request.headers.cookie);
    const session = store.session(cookies[sessionCookie] ?? "", Date.now());
    const installation = session ? store.get(session.installationId) : undefined;
    if (request.method === "GET" && url.pathname === "/") {
      if (installation && session) { manage(response, installation, session); return; }
      const disconnected = url.searchParams.get("disconnected");
      html(response, 200, "Your shopping list, with recall reviews", (
        disconnected ? `<p>Reviews have stopped and your connection data has been removed. Your shopping list is still in Notion.</p>${disconnected === "permission" ? "<p>We could not remove Notion's permission. Remove Eat or Yeet from the list's connections in Notion too.</p>" : ""}` : ""
      ) + "<p>Connect a list to review related published warnings as you add or edit groceries. No Notion AI subscription is needed.</p>"
        + "<p>Choose your warning country, then approve access in Notion and copy our shopping-list template.</p>"
        + `<div class="actions">${link("/connect?region=UK", "Add to Notion for UK", true)}${link("/connect?region=US", "Add to Notion for US", true)}</div>`
        + "<p class=small>Already connected? Use the same Notion account and select your existing list during authorization to restore management access.</p>"
        + help());
      return;
    }
    if (request.method === "GET" && (url.pathname === "/connect" || url.pathname === "/reconnect")) {
      if (request.headers.purpose === "prefetch" || request.headers["sec-purpose"] === "prefetch") { response.writeHead(204); response.end(); return; }
      const region = url.pathname === "/reconnect" && installation ? installation.region : parseRegion(url.searchParams.get("region"));
      if (!region) { html(response, 400, "Choose a warning country", link("/", "Return to setup")); return; }
      // This is a cheap coarse process ceiling; durable installation/review limits apply separately.
      recentAuth = recentAuth.filter((time) => time > Date.now() - 60_000);
      if (recentAuth.length >= 60) { response.setHeader("Retry-After", "60"); html(response, 429, "Please wait a moment", link("/", "Return to setup")); return; }
      recentAuth.push(Date.now());
      const state = randomBytes(32).toString("base64url");
      const binding = randomBytes(32).toString("base64url");
      store.createOAuth(state, binding, { region, ...(installation ? { installationId: installation.id } : {}), expiresAt: Date.now() + OAUTH_TTL }, Date.now());
      response.setHeader("Set-Cookie", cookie(oauthCookie, binding, OAUTH_TTL / 1_000));
      redirect(response, api.authorizationUrl(state)); return;
    }
    if (request.method === "GET" && url.pathname === "/oauth/callback") {
      const state = url.searchParams.get("state");
      const binding = cookies[oauthCookie];
      const pending = state && binding ? store.consumeOAuth(state, binding, Date.now()) : undefined;
      response.setHeader("Set-Cookie", cookie(oauthCookie, "", 0));
      if (!pending) { html(response, 400, "Setup link expired", "<p>Start again in this browser to connect your list.</p>" + link("/", "Return to setup")); return; }
      if (url.searchParams.has("error")) { html(response, 200, "Notion was not connected", "<p>You cancelled setup or Notion could not approve access.</p>" + link("/", "Return to setup")); return; }
      const code = url.searchParams.get("code");
      if (!code || code.length > 1_024) { html(response, 400, "Notion could not finish setup", link("/", "Try again")); return; }
      const authorization = await api.exchange(code, AbortSignal.timeout(15_000));
      const existing = store.findOwner(authorization.workspaceId, authorization.ownerId);
      if (pending.installationId && existing?.id !== pending.installationId) {
        html(response, 403, "Use the original Notion account", "<p>This list belongs to a different Notion authorization. Reconnect using the account and workspace that installed it.</p>" + link("/", "Return to setup")); return;
      }
      if (existing) await runtime.suspendForAuthorization(existing.id);
      const installed = store.authorize(authorization, pending.region, Date.now(), pending.installationId);
      const rawSession = randomBytes(32).toString("base64url");
      store.createSession(rawSession, installed.id, randomBytes(32).toString("base64url"), Date.now() + SESSION_TTL);
      response.setHeader("Set-Cookie", [cookie(oauthCookie, "", 0), cookie(sessionCookie, rawSession, SESSION_TTL / 1_000)]);
      // Status is persisted before activation, so callbacks never claim a ready list prematurely.
      void runtime.activate(installed.id, { reconcile: true }).catch(() => undefined);
      redirect(response, "/"); return;
    }
    if (request.method === "POST" && url.pathname === "/manage") {
      if (!session || !installation) { html(response, 401, "Reconnect your Notion account", link("/", "Return to setup")); return; }
      if (request.headers.origin !== config.publicOrigin || !request.headers["content-type"]?.startsWith("application/x-www-form-urlencoded")) {
        json(response, 403, { error: "invalid_origin" }); return;
      }
      const form = new URLSearchParams((await readBody(request, 4_096)).toString("utf8"));
      if (!same(form.get("csrf") ?? "", session.csrfToken)) { json(response, 403, { error: "invalid_form" }); return; }
      const action = form.get("action");
      if (action === "pause") await runtime.pause(installation.id);
      else if (action === "resume" || action === "retry") await runtime.activate(installation.id, { reconcile: true });
      else if (action === "region") {
        const region = parseRegion(form.get("region"));
        if (!region) { json(response, 400, { error: "invalid_region" }); return; }
        if (region !== installation.region) await runtime.changeRegion(installation.id, region);
      } else if (action === "disconnect") {
        const result = await runtime.disconnect(installation.id);
        response.setHeader("Set-Cookie", cookie(sessionCookie, "", 0));
        redirect(response, `/?disconnected=${result.permissionRemoved ? "done" : "permission"}`); return;
      } else { json(response, 400, { error: "invalid_action" }); return; }
      redirect(response, "/"); return;
    }
    json(response, 404, { error: "not_found" });
  }

  async function webhook(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let raw: Buffer;
    try { raw = await readBody(request, MAX_WEBHOOK_BYTES); }
    catch { json(response, 413, { error: "body_too_large" }); return; }
    // Setup handoff is operator-only. A challenge is acknowledged only when it matches the stored token.
    const signature = request.headers["x-notion-signature"];
    if (typeof signature !== "string" || !verifySignature(raw, signature, config.webhookVerificationToken)) {
      try {
        const challenge: unknown = JSON.parse(raw.toString("utf8"));
        if (isRecord(challenge) && Object.keys(challenge).length === 1 && typeof challenge.verification_token === "string" && same(challenge.verification_token, config.webhookVerificationToken)) {
          json(response, 200, { verification_token: config.webhookVerificationToken }); return;
        }
      } catch { /* Invalid or unsigned delivery. */ }
      json(response, 401, { error: "invalid_signature" }); return;
    }
    let payload: unknown;
    try { payload = JSON.parse(raw.toString("utf8")); } catch { json(response, 400, { error: "invalid_json" }); return; }
    if (!isRecord(payload) || payload.integration_id !== config.notionIntegrationId || payload.subscription_id !== config.notionSubscriptionId || !shortString(payload.workspace_id)
      || !shortString(payload.id) || !isRecord(payload.entity) || payload.entity.type !== "page" || !shortString(payload.entity.id)) {
      json(response, 400, { error: "invalid_event" }); return;
    }
    if (payload.type !== "page.created" && payload.type !== "page.properties_updated") { json(response, 200, { accepted: false }); return; }
    if (!Array.isArray(payload.accessible_by)) { json(response, 400, { error: "missing_recipients" }); return; }
    const recipients = new Set(payload.accessible_by.filter(isRecord).filter((entry) => entry.type === "bot" && shortString(entry.id)).map((entry) => entry.id));
    const data = isRecord(payload.data) ? payload.data : {};
    const updated = data.updated_properties;
    if (payload.type === "page.properties_updated" && (!Array.isArray(updated) || !updated.every(shortString))) { json(response, 400, { error: "invalid_properties" }); return; }
    const parent = isRecord(data.parent) ? data.parent : undefined;
    const targets = store.list().filter((item) => item.workspaceId === payload.workspace_id && recipients.has(item.botId) && (!parent || !item.binding
      || (parent.type !== "data_source" && parent.type !== "database")
      || parent.id === item.binding.dataSourceId || parent.id === item.binding.databaseId));
    let accepted = false;
    for (const target of targets) {
      const result = runtime.enqueue(target.id, { id: payload.id, type: payload.type, pageId: payload.entity.id, updatedProperties: Array.isArray(updated) ? updated as string[] : [] });
      if (result === "paused" || result === "full") { json(response, 503, { error: "queue_unavailable" }); return; }
      if (result === "accepted") accepted = true;
    }
    json(response, accepted ? 202 : 200, { accepted });
  }

  function manage(response: ServerResponse, installation: Installation, session: ManagementSession): void {
    const runtimeState = runtime.state(installation.id);
    const active = installation.status === "active" && runtimeState?.ready === true && runtimeState.paused === false;
    const budget = store.budget(installation.id, Date.now(), config.dailyReviewsPerInstallation, config.dailyReviewsGlobal);
    const titles = { setting_up: "Setting up your list", active: active ? "Reviews active" : "Reviews are starting", paused: "Reviews paused", needs_reconnect: "Reconnect your Notion account", setup_failed: "Your list needs attention", disconnecting: "Disconnecting your list" };
    const errors = { missing_template: "Choose the Eat or Yeet shopping-list template during authorization. We could not find a copied list.", invalid_template: "The connected list is missing a required field or has an unexpected structure. Restore the template fields and retry.", access_revoked: "Notion access could not be renewed. Reconnect using the original account and workspace.", temporarily_unavailable: "We could not finish setup. Try again when the connection is available." };
    let body = `<p>Warning country: <strong>${installation.region}</strong></p>`;
    if (installation.errorCode) body += `<p>${errors[installation.errorCode]}</p>`;
    if (installation.binding) body += link(`https://www.notion.so/${installation.binding.databaseId.replaceAll("-", "")}`, "Open shopping list", true);
    if (active && !budget.allowed) body += `<p>Today's review limit has been reached. Pending reviews retry after ${escape(new Date(budget.retryAt).toISOString())}. Earlier results keep their original review time.</p>`;
    if (active) body += "<p>Add or edit a grocery item in Notion to review related published warnings. Tick Bought to skip that row.</p>";
    const controls: string[] = [];
    if (installation.status === "active" || installation.status === "setting_up") controls.push(form("pause", "Pause reviews", session.csrfToken));
    if (installation.status === "paused") controls.push(form("resume", "Resume reviews", session.csrfToken));
    if (installation.status === "setup_failed" && installation.errorCode !== "missing_template") controls.push(form("retry", "Retry setup", session.csrfToken));
    controls.push(link("/reconnect", installation.errorCode === "missing_template" ? "Choose shopping template in Notion" : "Reconnect Notion"));
    if (installation.status !== "disconnecting") controls.push(form("disconnect", "Disconnect", session.csrfToken));
    body += `<div class="actions">${controls.join("")}</div>`;
    if (installation.status !== "disconnecting") body += `<form method="post" action="/manage"><input type="hidden" name="csrf" value="${escape(session.csrfToken)}"><input type="hidden" name="action" value="region"><label for="region">Warning country</label> <select id="region" name="region"><option value="UK"${installation.region === "UK" ? " selected" : ""}>United Kingdom</option><option value="US"${installation.region === "US" ? " selected" : ""}>United States</option></select> <button type="submit">Change country and review unbought items</button></form>`;
    body += help();
    html(response, 200, titles[installation.status], body, installation.status === "setting_up" || (installation.status === "active" && !active));
  }
  function help(): string {
    return `<p class="small">Reviews run when items change. Read the official notice and check product and batch details before buying or using food. No related warning does not establish that food is safe. Missing source coverage produces Unable to review. Future-recall alerts are not included.</p><p class="small">Only your connected shopping list and configured item fields are reviewed. Disconnect stops reviews and removes service-held credentials while preserving the list.</p>${link(`${config.websiteOrigin}/integrations/notion`, "Help")}${link(`${config.websiteOrigin}/privacy`, "Privacy")}`;
  }
  function cookie(name: string, value: string, maxAge: number): string { return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`; }
}

function html(response: ServerResponse, status: number, title: string, body: string, refresh = false): void {
  const nonce = randomBytes(16).toString("base64url");
  response.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff", "content-security-policy": `default-src 'none'; style-src 'nonce-${nonce}'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'` });
  response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${refresh ? '<meta http-equiv="refresh" content="3;url=/">' : ""}<title>${escape(title)} | Eat or Yeet</title><style nonce="${nonce}">:root{color-scheme:light dark;--primary:light-dark(#e39b00,#f2a900);--bg:light-dark(#fbf5e9,#17171a);--text:light-dark(#1d1a16,#f4f1ea);--panel:light-dark(#fffcf5,#222226);--border:light-dark(#e8dec8,#ffffff1f)}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.65 system-ui,sans-serif}header{border-bottom:1px solid var(--border);padding:1rem 1.5rem;font-weight:850}main{max-width:740px;margin:3rem auto;padding:0 1.5rem}h1{font-size:clamp(2rem,7vw,3rem);line-height:1.12;letter-spacing:-.035em}a{color:inherit;margin-right:1rem;text-underline-offset:4px}.primary,button{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:.65rem 1.25rem;border-radius:999px;border:1px solid var(--border);font:700 15px/1.4 system-ui;background:var(--panel);color:var(--text);cursor:pointer}.primary{background:var(--primary);color:#1d1a16;text-decoration:none}.actions{display:flex;flex-wrap:wrap;gap:.75rem;margin:1.5rem 0}.actions form{margin:0}.small{font-size:.875rem;opacity:.8}select{padding:.65rem;border:1px solid var(--border);border-radius:8px;font:inherit}form{margin:1.5rem 0}a:focus-visible,button:focus-visible,select:focus-visible{outline:3px solid var(--primary);outline-offset:4px}</style></head><body><header>Eat or Yeet</header><main><h1>${escape(title)}</h1>${body}</main></body></html>`);
}
function json(response: ServerResponse, status: number, body: unknown): void { response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" }); response.end(JSON.stringify(body)); }
function redirect(response: ServerResponse, destination: string): void { response.writeHead(303, { location: destination, "cache-control": "no-store", "referrer-policy": "no-referrer" }); response.end(); }
function link(href: string, text: string, primary = false): string { return `<a${primary ? ' class="primary"' : ""} href="${escape(href)}">${escape(text)}</a>`; }
function form(action: string, text: string, csrf: string): string { return `<form method="post" action="/manage"><input type="hidden" name="csrf" value="${escape(csrf)}"><input type="hidden" name="action" value="${escape(action)}"><button type="submit">${escape(text)}</button></form>`; }
function escape(value: string): string { return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!); }
function parseRegion(value: string | null): Region | undefined { return value === "UK" || value === "US" ? value : undefined; }
function same(a: string, b: string): boolean { const x = Buffer.from(a); const y = Buffer.from(b); return x.length > 0 && x.length === y.length && timingSafeEqual(x, y); }
function parseCookies(header: string | undefined): Record<string, string> { return Object.fromEntries((header ?? "").split(";").map((entry) => entry.trim().split("=")).filter(([name, value]) => name && value && /^[A-Za-z0-9_-]{1,100}$/.test(value))); }
function shortString(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 256; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
async function readBody(request: IncomingMessage, maximum: number): Promise<Buffer> { const chunks: Buffer[] = []; let size = 0; for await (const chunk of request) { const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += bytes.length; if (size > maximum) throw new RangeError("Request is too large"); chunks.push(bytes); } return Buffer.concat(chunks); }
