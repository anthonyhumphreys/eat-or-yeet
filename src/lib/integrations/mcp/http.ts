import "server-only";

import { integrationIngress, IntegrationIngressError } from "./ingress";
import { untilAborted } from "./services";
import { readResponseText } from "@/lib/http/bounded-response";
import { readBoundedJson } from "@/lib/security/request-body";

const deadlineMs = 20_000;
const maxConcurrentRequests = 8;

type McpTransport = { fetch: (request: Request) => Promise<Response>; close: () => Promise<void> };
type HandlerOptions = {
  enabled: () => boolean;
  createTransport: (network: string, context?: unknown) => McpTransport;
  authorize?: (request: Request) => Promise<{ ok: true; context?: unknown } | { ok: false; status: 401 | 503 }>;
  privatePreflight?: boolean;
};

function failure(status: number, message: string, headers?: Record<string, string>) {
  return Response.json({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }, {
    status, headers: { "Cache-Control": "no-store", ...headers },
  });
}

function isAllowedPrivatePreflight(request: Request) {
  if (!request.headers.get("origin") || request.headers.get("access-control-request-method") !== "POST") return false;
  const requested = request.headers.get("access-control-request-headers")?.split(",").map((header) => header.trim().toLowerCase()).filter(Boolean) ?? [];
  return requested.every((header) => ["authorization", "content-type", "mcp-protocol-version", "accept"].includes(header));
}

export function createMcpHttpHandler(options: HandlerOptions) {
  let pendingRequests = 0;
  return async function handleMcpHttp(request: Request) {
    if (!options.enabled()) return failure(404, "The integration is not enabled.");
    let ingress: ReturnType<typeof integrationIngress>;
    try { ingress = integrationIngress(request); }
    catch (error) {
      return failure(error instanceof IntegrationIngressError ? error.status : 503, "The integration request could not be accepted.");
    }
    const cors: Record<string, string> = ingress.origin ? { "Access-Control-Allow-Origin": ingress.origin, Vary: "Origin" } : {};
    if (request.method === "OPTIONS") {
      if (options.privatePreflight && !isAllowedPrivatePreflight(request)) return failure(400, "The preflight request could not be accepted.", cors);
      return new Response(null, { status: 204, headers: { ...cors, "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": options.privatePreflight ? "Authorization, Content-Type, MCP-Protocol-Version, Accept" : "Content-Type, MCP-Protocol-Version, Accept",
        "Cache-Control": "no-store" } });
    }
    let authorizationContext: unknown;
    if (options.authorize) {
      let authorization: Awaited<ReturnType<NonNullable<HandlerOptions["authorize"]>>>;
      try { authorization = await options.authorize(request); }
      catch { return failure(503, "The integration request could not be accepted.", cors); }
      if (!authorization.ok) return failure(authorization.status, authorization.status === 401 ? "A valid connection bearer token is required." : "The integration is temporarily unavailable.", cors);
      authorizationContext = authorization.context;
    }
    if (request.method !== "POST") return failure(405, "Use stateless Streamable HTTP POST.", { ...cors, Allow: "POST, OPTIONS" });
    if (pendingRequests >= maxConcurrentRequests) return failure(503, "The integration is busy. Retry shortly.", { ...cors, "Retry-After": "5" });
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(deadlineMs)]);
    const transport = options.createTransport(ingress.network, authorizationContext);
    pendingRequests += 1;
    try {
      const body = await untilAborted(readBoundedJson(request, 32 * 1024), signal);
      if (!body.ok) return failure(body.reason === "too_large" ? 413 : 400, "Supply a valid bounded JSON-RPC request.", cors);
      if (Array.isArray(body.value)) return failure(400, "Send one JSON-RPC request at a time.", cors);
      signal.throwIfAborted();
      const headers = new Headers(request.headers);
      headers.delete("content-length");
      const response = await untilAborted(transport.fetch(new Request(request.url, {
        method: "POST", headers, body: JSON.stringify(body.value), signal,
      })), signal);
      const text = await untilAborted(readResponseText(response, 256 * 1024), signal);
      const responseHeaders = new Headers(response.headers);
      responseHeaders.set("Cache-Control", "no-store");
      for (const [key, value] of Object.entries(cors)) responseHeaders.set(key, value);
      return new Response(response.status === 202 || response.status === 204 ? null : text, {
        status: response.status, headers: responseHeaders,
      });
    } catch {
      return failure(signal.aborted ? (request.signal.aborted ? 408 : 504) : 503, "The integration request did not complete.", cors);
    } finally {
      pendingRequests -= 1;
      await transport.close().catch(() => undefined);
    }
  };
}
