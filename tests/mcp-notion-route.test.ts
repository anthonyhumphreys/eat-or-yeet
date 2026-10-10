import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/integrations/mcp/notion-server", () => ({ createNotionMcpTransport: vi.fn() }));

import { OPTIONS, POST } from "@/app/mcp/notion/route";
import { createNotionMcpTransport } from "@/lib/integrations/mcp/notion-server";

const token = "private-notion-test-token-0123456789";
const key = JSON.stringify([{ id: "notion-shopping", sha256: createHash("sha256").update(token).digest("hex"), dailyLimit: 40, expiresAt: "2099-01-01T00:00:00.000Z" }]);
const fetchHandler = vi.fn(async () => Response.json({ jsonrpc: "2.0", id: 1, result: {} }));
const close = vi.fn(async () => undefined);

function request(headers: HeadersInit = {}, body: unknown = { jsonrpc: "2.0", method: "tools/list", id: 1 }) {
  return new Request("https://eatoryeet.app/mcp/notion", {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
  });
}

describe("private Notion MCP route", () => {
  beforeEach(() => {
    vi.stubEnv("MCP_ENABLED", "true");
    vi.stubEnv("MCP_NOTION_ENABLED", "true");
    vi.stubEnv("MCP_CONNECTION_KEYS", key);
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://eatoryeet.app");
    vi.stubEnv("MCP_ALLOWED_ORIGINS", "");
    vi.stubEnv("VERCEL_URL", "");
    vi.clearAllMocks();
    fetchHandler.mockImplementation(async () => Response.json({ jsonrpc: "2.0", id: 1, result: {} }));
    vi.mocked(createNotionMcpTransport).mockReturnValue({ fetch: fetchHandler, close } as never);
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it("gates disabled routes before authentication and protocol work", async () => {
    vi.stubEnv("MCP_NOTION_ENABLED", "false");
    expect((await POST(request({ authorization: `Bearer ${token}` }))).status).toBe(404);
    expect(createNotionMcpTransport).not.toHaveBeenCalled();
  });

  it("authenticates before malformed or valid protocol bodies reach the transport", async () => {
    expect((await POST(request())).status).toBe(401);
    expect((await POST(request({ authorization: "Bearer wrong" }))).status).toBe(401);
    expect((await POST(request({ authorization: `Bearer ${token}` }, { jsonrpc: "2.0", method: "tools/list", id: 1 }))).status).toBe(200);
    expect(createNotionMcpTransport).toHaveBeenCalledOnce();
    expect(createNotionMcpTransport).toHaveBeenCalledWith("local-development", { id: "notion-shopping", dailyLimit: 40 });
  });

  it("returns a redacted service failure for malformed key configuration", async () => {
    vi.stubEnv("MCP_CONNECTION_KEYS", "not-json-secret");
    const response = await POST(request({ authorization: `Bearer ${token}` }));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("not-json-secret");
    expect(createNotionMcpTransport).not.toHaveBeenCalled();
  });

  it("allows only an origin-checked unauthenticated CORS preflight", async () => {
    const preflight = new Request("https://eatoryeet.app/mcp/notion", {
      method: "OPTIONS",
      headers: {
        origin: "https://eatoryeet.app",
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization, content-type",
      },
    });
    const response = await OPTIONS(preflight);
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-headers")).toContain("Authorization");
    expect(createNotionMcpTransport).not.toHaveBeenCalled();

    const invalid = new Request("https://eatoryeet.app/mcp/notion", { method: "OPTIONS" });
    expect((await OPTIONS(invalid)).status).toBe(400);
  });
});
