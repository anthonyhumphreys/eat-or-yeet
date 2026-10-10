import { describe, expect, it } from "vitest";
import { buildDatabasePayload } from "../integrations/notion/template/provision.mjs";
import { NotionOAuthApi } from "../integrations/notion/managed/notion-api.ts";

const CLIENT_ID = "client-id-private";
const CLIENT_SECRET = "client-secret-private";
const ACCESS_TOKEN = "access-token-private";
const REFRESH_TOKEN = "refresh-token-private";
const DATABASE_ID = "database-1";
const DATA_SOURCE_ID = "data-source-1";
const PAGE_ID = "template-page-1";
const signal = new AbortController().signal;

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

function templateProperties(): Record<string, Record<string, unknown>> {
  const definitions = buildDatabasePayload(PAGE_ID).initial_data_source.properties as Record<string, Record<string, unknown>>;
  return Object.fromEntries(Object.entries(definitions).map(([name, schema], index) => {
    const kind = Object.keys(schema)[0];
    const property: Record<string, unknown> = { id: `property-${index}`, type: kind };
    if (kind === "select") property.select = { options: [
      { name: "Related warnings found" },
      { name: "No related warnings found in covered data" },
      { name: "Unable to review" },
    ] };
    return [name, property];
  }));
}

function templateFetch(overrides: { properties?: Record<string, unknown>; children?: unknown; database?: unknown; dataSource?: unknown } = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetcher: typeof fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith(`/pages/${PAGE_ID}`)) return jsonResponse({ object: "page", id: PAGE_ID });
    if (url.includes(`/blocks/${PAGE_ID}/children`)) return jsonResponse(overrides.children ?? {
      results: [{ id: DATABASE_ID, type: "child_database", has_children: false }],
      has_more: false,
      next_cursor: null,
    });
    if (url.endsWith(`/databases/${DATABASE_ID}`)) return jsonResponse(overrides.database ?? {
      id: DATABASE_ID,
      data_sources: [{ id: DATA_SOURCE_ID }],
    });
    if (url.endsWith(`/data_sources/${DATA_SOURCE_ID}`)) return jsonResponse(overrides.dataSource ?? {
      id: DATA_SOURCE_ID,
      parent: { type: "database_id", database_id: DATABASE_ID },
      properties: overrides.properties ?? templateProperties(),
    });
    throw new Error(`Unexpected URL ${url}`);
  };
  return { fetcher, calls };
}

describe("Notion managed OAuth API", () => {
  it("builds an authorization URL with the user owner and callback state", () => {
    const api = new NotionOAuthApi(CLIENT_ID, CLIENT_SECRET, "https://example.test/notion/callback");
    const url = new URL(api.authorizationUrl("state+private"));

    expect(url.origin).toBe("https://api.notion.com");
    expect(url.pathname).toBe("/v1/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(url.searchParams.get("redirect_uri")).toBe("https://example.test/notion/callback");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("owner")).toBe("user");
    expect(url.searchParams.get("state")).toBe("state+private");
  });

  it("exchanges an authorization code and returns only the required owner fields", async () => {
    let requestBody = "";
    let requestInit: RequestInit | undefined;
    const api = new NotionOAuthApi(CLIENT_ID, CLIENT_SECRET, "https://example.test/callback", async (_input, init = {}) => {
      requestBody = String(init.body);
      requestInit = init;
      return jsonResponse({
        access_token: ACCESS_TOKEN,
        refresh_token: REFRESH_TOKEN,
        bot_id: "bot-1",
        workspace_id: "workspace-1",
        owner: { type: "user", user: { id: "owner-1", name: "discard this", person: { email: "discard@example.test" } } },
        duplicated_template_id: PAGE_ID,
        workspace_name: "discard workspace name",
        workspace_icon: "discard workspace icon",
      });
    });

    const authorization = await api.exchange("code-private", signal);
    expect(authorization).toEqual({
      accessToken: ACCESS_TOKEN,
      refreshToken: REFRESH_TOKEN,
      ownerId: "owner-1",
      workspaceId: "workspace-1",
      botId: "bot-1",
      templatePageId: PAGE_ID,
    });
    expect(requestBody).toBe(JSON.stringify({ grant_type: "authorization_code", code: "code-private", redirect_uri: "https://example.test/callback" }));
    const headers = new Headers(requestInit?.headers);
    expect(headers.get("authorization")).toBe(`Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`);
    expect(headers.get("notion-version")).toBe("2025-09-03");
    expect(requestInit?.redirect).toBe("error");
    expect(JSON.stringify(authorization)).not.toContain("discard");
  });

  it("refreshes with the old token and returns both rotated credentials", async () => {
    let requestBody = "";
    const api = new NotionOAuthApi(CLIENT_ID, CLIENT_SECRET, "https://example.test/callback", async (_input, init = {}) => {
      requestBody = String(init.body);
      return jsonResponse({ access_token: "rotated-access", refresh_token: "rotated-refresh" });
    });

    await expect(api.refresh(REFRESH_TOKEN, signal)).resolves.toEqual({ accessToken: "rotated-access", refreshToken: "rotated-refresh" });
    expect(requestBody).toBe(JSON.stringify({ grant_type: "refresh_token", refresh_token: REFRESH_TOKEN }));
  });

  it("keeps the existing refresh token when Notion returns null and uses it on the next refresh", async () => {
    const requestBodies: string[] = [];
    const responses = [
      { access_token: "first-access", refresh_token: null },
      { access_token: "second-access", refresh_token: "second-refresh" },
    ];
    const api = new NotionOAuthApi(CLIENT_ID, CLIENT_SECRET, "https://example.test/callback", async (_input, init = {}) => {
      requestBodies.push(String(init.body));
      return jsonResponse(responses.shift());
    });

    const first = await api.refresh(REFRESH_TOKEN, signal);
    expect(first).toEqual({ accessToken: "first-access", refreshToken: REFRESH_TOKEN });
    await expect(api.refresh(first.refreshToken, signal)).resolves.toEqual({
      accessToken: "second-access",
      refreshToken: "second-refresh",
    });
    expect(requestBodies).toEqual([
      JSON.stringify({ grant_type: "refresh_token", refresh_token: REFRESH_TOKEN }),
      JSON.stringify({ grant_type: "refresh_token", refresh_token: REFRESH_TOKEN }),
    ]);
  });

  it.each([
    ["missing", {}],
    ["empty", { refresh_token: "" }],
    ["wrong type", { refresh_token: false }],
    ["oversized", { refresh_token: "x".repeat(4_097) }],
  ])("rejects a %s refresh token instead of reusing the prior token", async (_label, extra) => {
    const api = new NotionOAuthApi(CLIENT_ID, CLIENT_SECRET, "https://example.test/callback", async () =>
      jsonResponse({ access_token: "new-access", ...extra }));

    await expect(api.refresh(REFRESH_TOKEN, signal)).rejects.toMatchObject({ code: "invalid_config" });
  });

  it("revokes the access token with client authentication and does not retry", async () => {
    let requests = 0;
    let requestBody = "";
    const api = new NotionOAuthApi(CLIENT_ID, CLIENT_SECRET, "https://example.test/callback", async (_input, init = {}) => {
      requests += 1;
      requestBody = String(init.body);
      return new Response(null, { status: 200 });
    });

    await api.revoke(ACCESS_TOKEN, signal);
    expect(requests).toBe(1);
    expect(requestBody).toBe(JSON.stringify({ token: ACCESS_TOKEN }));
  });

  it("discovers the one database under the copied page and strips generated secret paths", async () => {
    const { fetcher, calls } = templateFetch();
    const api = new NotionOAuthApi(CLIENT_ID, CLIENT_SECRET, "https://example.test/callback", fetcher);

    const binding = await api.discoverList(ACCESS_TOKEN, PAGE_ID, "UK", signal);
    expect(binding).toMatchObject({ templatePageId: PAGE_ID, databaseId: DATABASE_ID, dataSourceId: DATA_SOURCE_ID });
    expect(binding.properties.item).toEqual({ id: "property-0", kind: "title" });
    expect(binding.properties.reviewStatus).toEqual({ id: "property-15", kind: "select" });
    expect(binding.statusLabels).toEqual({
      found: "Related warnings found",
      none: "No related warnings found in covered data",
      unable: "Unable to review",
    });
    expect(JSON.stringify(binding)).not.toContain("secretFiles");
    expect(calls.every((call) => new URL(call.url).origin === "https://api.notion.com")).toBe(true);
    expect(calls.some((call) => call.url.includes("/search"))).toBe(false);
    expect(calls.some((call) => call.url.includes(`/databases/${DATABASE_ID}`))).toBe(true);
  });

  it("rejects ambiguous database children and invalid list schemas", async () => {
    const ambiguous = templateFetch({ children: {
      results: [
        { id: "database-a", type: "child_database" },
        { id: "database-b", type: "child_database" },
      ], has_more: false,
    } });
    const api = new NotionOAuthApi(CLIENT_ID, CLIENT_SECRET, "https://example.test/callback", ambiguous.fetcher);
    await expect(api.discoverList(ACCESS_TOKEN, PAGE_ID, "UK", signal)).rejects.toMatchObject({ code: "invalid_config" });
    expect(ambiguous.calls.some((call) => call.url.includes("/databases/"))).toBe(false);

    const invalidProperties = templateProperties();
    invalidProperties.Bought.type = "rich_text";
    const invalid = templateFetch({ properties: invalidProperties });
    await expect(new NotionOAuthApi(CLIENT_ID, CLIENT_SECRET, "https://example.test/callback", invalid.fetcher)
      .discoverList(ACCESS_TOKEN, PAGE_ID, "UK", signal)).rejects.toMatchObject({ code: "invalid_config" });
  });

  it("returns unbought row IDs only and follows bounded data-source pagination", async () => {
    const requests: Array<{ url: string; body: string; headers: Headers }> = [];
    const api = new NotionOAuthApi(CLIENT_ID, CLIENT_SECRET, "https://example.test/callback", async (input, init = {}) => {
      const url = String(input);
      requests.push({ url, body: String(init.body), headers: new Headers(init.headers) });
      return requests.length === 1
        ? jsonResponse({ results: [{ id: "row-1", properties: { Item: { title: [{ plain_text: "private item name" }] } } }], has_more: true, next_cursor: "cursor-1" })
        : jsonResponse({ results: [{ id: "row-2" }], has_more: false, next_cursor: null });
    });
    const binding = await new NotionOAuthApi(CLIENT_ID, CLIENT_SECRET, "https://example.test/callback", templateFetch().fetcher)
      .discoverList(ACCESS_TOKEN, PAGE_ID, "UK", signal);

    await expect(api.listUnboughtPageIds(ACCESS_TOKEN, binding, signal)).resolves.toEqual(["row-1", "row-2"]);
    expect(requests[0].url).toBe(`https://api.notion.com/v1/data_sources/${DATA_SOURCE_ID}/query`);
    expect(JSON.parse(requests[0].body)).toMatchObject({
      page_size: 100,
      filter: { property: "property-3", checkbox: { equals: false } },
    });
    expect(requests[0].headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(requests[1].body)).toMatchObject({ start_cursor: "cursor-1" });
    expect(JSON.stringify(await api.listUnboughtPageIds(ACCESS_TOKEN, binding, signal))).not.toContain("private item name");
  });

  it("rejects oversized API responses and row sets without leaking response content", async () => {
    const oversized = new NotionOAuthApi(CLIENT_ID, CLIENT_SECRET, "https://example.test/callback", async () =>
      new Response("x".repeat(256 * 1024 + 1), { status: 200 }));
    await expect(oversized.exchange("code-private", signal)).rejects.toMatchObject({ code: "temporary" });

    const rowSet = new NotionOAuthApi(CLIENT_ID, CLIENT_SECRET, "https://example.test/callback", async () =>
      jsonResponse({ results: [], has_more: true, next_cursor: "next" }));
    const binding = await new NotionOAuthApi(CLIENT_ID, CLIENT_SECRET, "https://example.test/callback", templateFetch().fetcher)
      .discoverList(ACCESS_TOKEN, PAGE_ID, "UK", signal);
    await expect(rowSet.listUnboughtPageIds(ACCESS_TOKEN, binding, signal)).rejects.toMatchObject({ code: "temporary" });
  });

  it("rejects empty repeated block cursors and cursors returned after pagination ends", async () => {
    const run = async (childrenResponses: unknown[]) => {
      let childrenCall = 0;
      const api = new NotionOAuthApi(CLIENT_ID, CLIENT_SECRET, "https://example.test/callback", async (input) => {
        const url = String(input);
        if (url.endsWith(`/pages/${PAGE_ID}`)) return jsonResponse({ id: PAGE_ID });
        if (url.includes(`/blocks/${PAGE_ID}/children`)) return jsonResponse(childrenResponses[childrenCall++]);
        throw new Error(`Unexpected URL ${url}`);
      });
      await expect(api.discoverList(ACCESS_TOKEN, PAGE_ID, "UK", signal)).rejects.toMatchObject({ code: "invalid_config" });
      return childrenCall;
    };

    await expect(run([
      { results: [], has_more: true, next_cursor: "repeat" },
      { results: [], has_more: true, next_cursor: "repeat" },
    ])).resolves.toBe(2);
    await expect(run([{ results: [], has_more: false, next_cursor: "unexpected" }])).resolves.toBe(1);
  });

  it("rejects callback URLs with query strings, fragments, or credentials", () => {
    expect(() => new NotionOAuthApi(CLIENT_ID, CLIENT_SECRET, "https://user:pass@example.test/callback")).toThrow();
    expect(() => new NotionOAuthApi(CLIENT_ID, CLIENT_SECRET, "https://example.test/callback?next=elsewhere")).toThrow();
    expect(() => new NotionOAuthApi(CLIENT_ID, CLIENT_SECRET, "http://example.test/callback")).toThrow();
    expect(() => new NotionOAuthApi(CLIENT_ID, CLIENT_SECRET, "http://localhost:3000/callback")).not.toThrow();
  });

  it("maps API failures to redacted worker errors and never follows redirects", async () => {
    let redirect: RequestRedirect | undefined;
    const api = new NotionOAuthApi(CLIENT_ID, CLIENT_SECRET, "https://example.test/callback", async (_input, init = {}) => {
      redirect = init.redirect;
      return new Response(JSON.stringify({ message: ACCESS_TOKEN, secret: CLIENT_SECRET }), { status: 401 });
    });
    let message = "";
    try { await api.refresh(REFRESH_TOKEN, signal); } catch (error) { message = error instanceof Error ? error.message : String(error); }
    expect(redirect).toBe("error");
    expect(message).toContain("revoked or denied");
    expect(message).not.toContain(ACCESS_TOKEN);
    expect(message).not.toContain(CLIENT_SECRET);
  });
});
