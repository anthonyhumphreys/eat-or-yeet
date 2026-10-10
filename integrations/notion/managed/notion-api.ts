import { WorkerError } from "../shopping-core.ts";
import { buildWorkerConfig, NOTION_API_VERSION } from "../template-provision.mjs";
import type { Authorization, Credentials, ListBinding, Region } from "./types.ts";

const API_ORIGIN = "https://api.notion.com/v1";
const OAUTH_ORIGIN = "https://api.notion.com/v1/oauth";
const MAX_RESPONSE_BYTES = 256 * 1024;
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_TREE_BLOCKS = 100;
const MAX_TREE_REQUESTS = 100;
const MAX_TREE_DEPTH = 3;
const MAX_QUERY_PAGES = 10;
const PAGE_SIZE = 100;
const MAX_ID_LENGTH = 1_024;
const MAX_TOKEN_LENGTH = 4_096;

type JsonObject = Record<string, unknown>;
type Fetcher = typeof fetch;

export class NotionOAuthApi {
  readonly #clientId: string;
  readonly #clientSecret: string;
  readonly #redirectUri: string;
  readonly #fetcher: Fetcher;

  constructor(clientId: string, clientSecret: string, redirectUri: string, fetcher: Fetcher = fetch) {
    if (!clientId.trim() || !clientSecret.trim() || clientId.length > MAX_ID_LENGTH || clientSecret.length > MAX_ID_LENGTH) {
      throw new WorkerError("Notion OAuth client configuration is incomplete", "invalid_config");
    }
    let redirect: URL;
    try { redirect = new URL(redirectUri); } catch { throw new WorkerError("Notion OAuth redirect URI is invalid", "invalid_config"); }
    const secureRedirect = redirect.protocol === "https:";
    const localRedirect = redirect.protocol === "http:" && ["localhost", "127.0.0.1"].includes(redirect.hostname);
    if ((!secureRedirect && !localRedirect) || redirect.username || redirect.password || redirect.search || redirect.hash) {
      throw new WorkerError("Notion OAuth redirect URI must use HTTPS", "invalid_config");
    }
    this.#clientId = clientId;
    this.#clientSecret = clientSecret;
    this.#redirectUri = redirect.href;
    this.#fetcher = fetcher;
  }

  authorizationUrl(state: string): string {
    if (!state || state.length > 512) throw new WorkerError("OAuth state is invalid", "invalid_config");
    const url = new URL(`${OAUTH_ORIGIN}/authorize`);
    url.searchParams.set("client_id", this.#clientId);
    url.searchParams.set("redirect_uri", this.#redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("owner", "user");
    url.searchParams.set("state", state);
    return url.href;
  }

  async exchange(code: string, signal: AbortSignal): Promise<Authorization> {
    if (!code.trim() || code.length > MAX_ID_LENGTH) throw new WorkerError("OAuth code is invalid", "invalid_config");
    const response = await this.#request(`${OAUTH_ORIGIN}/token`, {
      method: "POST",
      headers: this.#oauthHeaders(),
      body: JSON.stringify({ grant_type: "authorization_code", code, redirect_uri: this.#redirectUri }),
    }, signal, "OAuth token exchange");
    const body = asObject(response, "OAuth token response");
    const credentials = parseCredentials(body);
    const owner = asObject(body.owner, "OAuth owner");
    const user = asObject(owner.user, "OAuth owner user");
    if (owner.type !== "user") throw new WorkerError("Notion OAuth must authorize an individual user", "invalid_config");
    const ownerId = requiredString(user.id, "OAuth owner ID");
    const workspaceId = requiredString(body.workspace_id, "OAuth workspace ID");
    const botId = requiredString(body.bot_id, "OAuth bot ID");
    const templatePageId = typeof body.duplicated_template_id === "string" && body.duplicated_template_id.trim()
      ? body.duplicated_template_id
      : undefined;
    return { ...credentials, ownerId, workspaceId, botId, ...(templatePageId ? { templatePageId } : {}) };
  }

  async refresh(refreshToken: string, signal: AbortSignal): Promise<Credentials> {
    validateToken(refreshToken, "Notion refresh token");
    const response = await this.#request(`${OAUTH_ORIGIN}/token`, {
      method: "POST",
      headers: this.#oauthHeaders(),
      body: JSON.stringify({ grant_type: "refresh_token", refresh_token: refreshToken }),
    }, signal, "OAuth token refresh");
    return parseCredentials(asObject(response, "OAuth refresh response"));
  }

  async revoke(accessToken: string, signal: AbortSignal): Promise<void> {
    validateToken(accessToken, "Notion access token");
    await this.#request(`${OAUTH_ORIGIN}/revoke`, {
      method: "POST",
      headers: this.#oauthHeaders(),
      body: JSON.stringify({ token: accessToken }),
    }, signal, "OAuth token revocation");
  }

  async discoverList(accessToken: string, templatePageId: string, region: Region, signal: AbortSignal): Promise<ListBinding> {
    requiredString(templatePageId, "Notion template page ID");
    validateToken(accessToken, "Notion access token");
    if (region !== "UK" && region !== "US") throw new WorkerError("Shopping-list region is invalid", "invalid_config");
    await this.#get(accessToken, `/pages/${encodeURIComponent(templatePageId)}`, signal, "template page");

    const databases = new Set<string>();
    let blockCount = 0;
    let treeRequestCount = 0;
    const walk = async (blockId: string, depth: number): Promise<void> => {
      if (depth > MAX_TREE_DEPTH) return;
      let cursor: string | undefined;
      const cursors = new Set<string>();
      do {
        treeRequestCount += 1;
        if (treeRequestCount > MAX_TREE_REQUESTS) throw new WorkerError("Notion template is too large to inspect safely", "invalid_config");
        const params = new URLSearchParams({ page_size: String(PAGE_SIZE) });
        if (cursor) params.set("start_cursor", cursor);
        const page = asObject(await this.#get(accessToken, `/blocks/${encodeURIComponent(blockId)}/children?${params}`, signal, "template contents"), "block list");
        if (!Array.isArray(page.results)) throw new WorkerError("Notion template contents could not be read", "invalid_config");
        for (const item of page.results) {
          blockCount += 1;
          if (blockCount > MAX_TREE_BLOCKS) throw new WorkerError("Notion template is too large to inspect safely", "invalid_config");
          if (!isObject(item)) continue;
          if (item.type === "child_database" && typeof item.id === "string") databases.add(item.id);
          if (item.type !== "child_database" && depth < MAX_TREE_DEPTH && item.has_children === true && typeof item.id === "string") {
            await walk(item.id, depth + 1);
          }
        }
        if (typeof page.has_more !== "boolean") throw new WorkerError("Notion template pagination was invalid", "invalid_config");
        const hasMore = page.has_more;
        const nextCursor = parseCursor(page.next_cursor, "Notion template pagination");
        if (hasMore && !nextCursor) throw new WorkerError("Notion template pagination was incomplete", "invalid_config");
        if (hasMore && nextCursor && cursors.has(nextCursor)) throw new WorkerError("Notion template pagination repeated a cursor", "invalid_config");
        if (!hasMore && nextCursor) throw new WorkerError("Notion template pagination returned an unexpected cursor", "invalid_config");
        if (hasMore && blockCount >= MAX_TREE_BLOCKS) throw new WorkerError("Notion template is too large to inspect safely", "invalid_config");
        if (nextCursor) cursors.add(nextCursor);
        cursor = hasMore ? nextCursor : undefined;
      } while (cursor);
    };
    await walk(templatePageId, 1);
    if (databases.size !== 1) throw new WorkerError(databases.size === 0 ? "Notion template has no shopping database" : "Notion template has multiple databases", "invalid_config");

    const databaseId = [...databases][0];
    const database = asObject(await this.#get(accessToken, `/databases/${encodeURIComponent(databaseId)}`, signal, "shopping database"), "database");
    if (!Array.isArray(database.data_sources) || database.data_sources.length !== 1 || !isObject(database.data_sources[0])) {
      throw new WorkerError("Notion shopping database must have exactly one data source", "invalid_config");
    }
    const dataSourceId = requiredString(database.data_sources[0].id, "Notion data source ID");
    const dataSource = asObject(await this.#get(accessToken, `/data_sources/${encodeURIComponent(dataSourceId)}`, signal, "shopping data source"), "data source");
    if (dataSource.id !== dataSourceId || !isObject(dataSource.parent) || dataSource.parent.database_id !== databaseId) {
      throw new WorkerError("Notion data source does not belong to the selected shopping database", "invalid_config");
    }

    let config: { notionProperties: ListBinding["properties"]; statusLabels: ListBinding["statusLabels"] };
    try { config = buildWorkerConfig({ databaseId, dataSourceId, properties: dataSource.properties, region }) as unknown as typeof config; }
    catch { throw new WorkerError("Notion shopping database does not match the required list schema", "invalid_config"); }
    const statusPropertyName = Object.keys(dataSource.properties as JsonObject).find((name) => {
      const property = (dataSource.properties as JsonObject)[name];
      return isObject(property) && property.id === config.notionProperties.reviewStatus.id;
    });
    const statusProperty = statusPropertyName ? (dataSource.properties as JsonObject)[statusPropertyName] : undefined;
    const select = isObject(statusProperty) && isObject(statusProperty.select) ? statusProperty.select : undefined;
    const options = select && Array.isArray(select.options) ? select.options : [];
    const optionNames = new Set(options.filter(isObject).map((option) => option.name).filter((name): name is string => typeof name === "string"));
    const expectedLabels = [config.statusLabels.found, config.statusLabels.none, config.statusLabels.unable];
    if (expectedLabels.some((label) => !optionNames.has(label))) throw new WorkerError("Notion review status options do not match the required list schema", "invalid_config");

    return {
      templatePageId,
      databaseId,
      dataSourceId,
      properties: config.notionProperties,
      statusLabels: config.statusLabels,
    };
  }

  async listUnboughtPageIds(accessToken: string, binding: ListBinding, signal: AbortSignal): Promise<string[]> {
    const dataSourceId = requiredString(binding.dataSourceId, "Notion data source ID");
    const boughtPropertyId = requiredString(binding.properties.bought?.id, "Notion Bought property ID");
    validateToken(accessToken, "Notion access token");
    const pageIds = new Set<string>();
    let cursor: string | undefined;
    const cursors = new Set<string>();
    for (let pageIndex = 0; pageIndex < MAX_QUERY_PAGES; pageIndex += 1) {
      const response = asObject(await this.#request(`${API_ORIGIN}/data_sources/${encodeURIComponent(dataSourceId)}/query`, {
        method: "POST",
        headers: this.#apiHeaders(accessToken),
        body: JSON.stringify({
          page_size: PAGE_SIZE,
          filter: { property: boughtPropertyId, checkbox: { equals: false } },
          ...(cursor ? { start_cursor: cursor } : {}),
        }),
      }, signal, "shopping-list query"), "shopping-list query");
      if (!Array.isArray(response.results)) throw new WorkerError("Notion shopping-list query was invalid", "temporary");
      for (const result of response.results) {
        if (!isObject(result) || typeof result.id !== "string") continue;
        pageIds.add(result.id);
      }
      if (typeof response.has_more !== "boolean") throw new WorkerError("Notion shopping-list pagination was invalid", "temporary");
      const hasMore = response.has_more;
      const nextCursor = parseCursor(response.next_cursor, "Notion shopping-list pagination", "temporary");
      if (!hasMore && nextCursor) throw new WorkerError("Notion shopping-list pagination returned an unexpected cursor", "temporary");
      if (!hasMore) return [...pageIds];
      if (pageIndex === MAX_QUERY_PAGES - 1) throw new WorkerError("Notion shopping list exceeds the supported row limit", "invalid_config");
      if (!nextCursor) throw new WorkerError("Notion shopping-list pagination was incomplete", "temporary");
      if (cursors.has(nextCursor)) throw new WorkerError("Notion shopping-list pagination repeated a cursor", "temporary");
      cursors.add(nextCursor);
      cursor = nextCursor;
    }
    throw new WorkerError("Notion shopping list exceeds the supported row limit", "invalid_config");
  }

  #oauthHeaders(): HeadersInit {
    return {
      Authorization: `Basic ${Buffer.from(`${this.#clientId}:${this.#clientSecret}`).toString("base64")}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_API_VERSION,
    };
  }

  #apiHeaders(accessToken: string): HeadersInit {
    return {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_API_VERSION,
    };
  }

  async #get(accessToken: string, path: string, signal: AbortSignal, label: string): Promise<unknown> {
    validateToken(accessToken, "Notion access token");
    return this.#request(`${API_ORIGIN}${path}`, { headers: this.#apiHeaders(accessToken) }, signal, label);
  }

  async #request(url: string, init: RequestInit, signal: AbortSignal, label: string): Promise<unknown> {
    let response: Response;
    try {
      response = await this.#fetcher(url, {
        ...init,
        signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
        redirect: "error",
      });
    } catch {
      throw new WorkerError(`Notion ${label} request failed`, "temporary");
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      if (response.status === 401 || response.status === 403) throw new WorkerError("Notion access was revoked or denied", "revoked");
      if (response.status === 404 && label === "template page") throw new WorkerError("Notion template page is unavailable", "invalid_config");
      if (response.status === 400 && label.includes("OAuth")) throw new WorkerError(`Notion ${label} was rejected`, "invalid_config");
      throw new WorkerError(`Notion ${label} request failed (${response.status})`, "temporary");
    }
    try {
      const declaredLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error("too large");
      }
      if (!response.body) return {};
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      let complete = false;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) { complete = true; break; }
          total += value.byteLength;
          if (total > MAX_RESPONSE_BYTES) throw new Error("too large");
          chunks.push(value);
        }
      } finally {
        if (!complete) await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      if (total === 0) return {};
      return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    } catch {
      throw new WorkerError(`Notion ${label} response was invalid or too large`, "temporary");
    }
  }
}

function parseCredentials(body: JsonObject): Credentials {
  const accessToken = requiredString(body.access_token, "OAuth access token", MAX_TOKEN_LENGTH);
  const refreshToken = requiredString(body.refresh_token, "OAuth refresh token", MAX_TOKEN_LENGTH);
  return { accessToken, refreshToken };
}

function asObject(value: unknown, label: string): JsonObject {
  if (!isObject(value)) throw new WorkerError(`Notion ${label} was invalid`, "invalid_config");
  return value;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, label: string, maxLength = MAX_ID_LENGTH): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) throw new WorkerError(`Notion ${label} was missing or invalid`, "invalid_config");
  return value;
}

function validateToken(token: string, label: string): void {
  requiredString(token, label, MAX_TOKEN_LENGTH);
}

function parseCursor(value: unknown, label: string, code: "invalid_config" | "temporary" = "invalid_config"): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !value.trim() || value.length > MAX_ID_LENGTH) {
    throw new WorkerError(`${label} cursor was invalid`, code);
  }
  return value;
}
