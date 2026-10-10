import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/integrations/mcp/server", () => ({ createMcpTransport: vi.fn() }));

import { GET, DELETE, OPTIONS, POST } from "@/app/mcp/route";
import { createMcpTransport } from "@/lib/integrations/mcp/server";

const fetchHandler = vi.fn(async () => Response.json({ jsonrpc: "2.0", id: 1, result: {} }));
const close = vi.fn(async () => undefined);
function request(body: unknown = { jsonrpc: "2.0", method: "tools/list", id: 1 }, headers?: HeadersInit, signal?: AbortSignal) {
  return new Request("https://eatoryeet.app/mcp", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal });
}

describe("MCP ingress", () => {
  beforeEach(() => {
    vi.stubEnv("MCP_ENABLED", "true");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://eatoryeet.app");
    vi.stubEnv("MCP_ALLOWED_ORIGINS", "");
    vi.stubEnv("VERCEL_URL", "");
    vi.clearAllMocks();
    fetchHandler.mockImplementation(async () => Response.json({ jsonrpc: "2.0", id: 1, result: {} }));
    vi.mocked(createMcpTransport).mockReturnValue({ fetch: fetchHandler, close } as never);
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it("is disabled before protocol or datastore work", async () => {
    vi.stubEnv("MCP_ENABLED", "false");
    expect((await POST(request())).status).toBe(404);
    expect(createMcpTransport).not.toHaveBeenCalled();
  });

  it("rejects unexpected host/origin and accepts an origin-free cloud client", async () => {
    expect((await POST(request(undefined, { host: "attacker.test" }))).status).toBe(403);
    expect((await POST(request(undefined, { origin: "https://attacker.test" }))).status).toBe(403);
    expect(createMcpTransport).not.toHaveBeenCalled();
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(close).toHaveBeenCalledOnce();
  });

  it("fails closed in production when trusted Vercel identity is missing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "");
    expect((await POST(request())).status).toBe(503);
    expect(createMcpTransport).not.toHaveBeenCalled();
  });

  it("rejects oversized, malformed and batch envelopes before SDK execution", async () => {
    expect((await POST(request({ padding: "x".repeat(32769) }))).status).toBe(413);
    expect((await POST(new Request("https://eatoryeet.app/mcp", { method: "POST", body: "{" }))).status).toBe(400);
    expect((await POST(request([{ jsonrpc: "2.0", method: "tools/list", id: 1 }]))).status).toBe(400);
    expect(fetchHandler).not.toHaveBeenCalled();
  });

  it("serves strict preflight and refuses session methods without protocol work", async () => {
    const response = await OPTIONS(new Request("https://eatoryeet.app/mcp", { method: "OPTIONS", headers: { origin: "https://eatoryeet.app" } }));
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://eatoryeet.app");
    expect((await GET(new Request("https://eatoryeet.app/mcp"))).status).toBe(405);
    expect((await DELETE(new Request("https://eatoryeet.app/mcp", { method: "DELETE" }))).status).toBe(405);
    expect(createMcpTransport).not.toHaveBeenCalled();
  });

  it("keeps the concurrency slot until the legacy response body finishes", async () => {
    const finish: Array<() => void> = [];
    fetchHandler.mockImplementation(async () => new Response(new ReadableStream({ start(controller) {
      finish.push(() => { controller.enqueue(new TextEncoder().encode("event: message\ndata: {}\n\n")); controller.close(); });
    } }), { headers: { "content-type": "text/event-stream" } }));
    const pending = Array.from({ length: 8 }, () => POST(request()));
    await vi.waitFor(() => expect(finish).toHaveLength(8));
    expect((await POST(request())).status).toBe(503);
    finish.forEach((complete) => complete());
    const responses = await Promise.all(pending);
    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(await responses[0].text()).toContain("event: message");
  });

  it("settles an interrupted request and closes the transport", async () => {
    const controller = new AbortController();
    fetchHandler.mockImplementationOnce(() => new Promise(() => undefined));
    const pending = POST(request(undefined, undefined, controller.signal));
    await vi.waitFor(() => expect(fetchHandler).toHaveBeenCalledOnce());
    controller.abort();
    expect((await pending).status).toBe(408);
    expect(close).toHaveBeenCalledOnce();
  });

  it("propagates the deadline signal to the SDK and returns a bounded timeout", async () => {
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValueOnce(deadline.signal);
    let downstreamSignal: AbortSignal | undefined;
    fetchHandler.mockImplementationOnce(async (request?: Request) => {
      downstreamSignal = request?.signal;
      return new Promise(() => undefined);
    });
    const pending = POST(request());
    await vi.waitFor(() => expect(downstreamSignal).toBeDefined());
    deadline.abort(new Error("deadline"));
    expect((await pending).status).toBe(504);
    expect(downstreamSignal?.aborted).toBe(true);
    expect(close).toHaveBeenCalledOnce();
  });
});
