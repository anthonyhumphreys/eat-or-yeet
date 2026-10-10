import { integrationIngress, IntegrationIngressError } from "@/lib/integrations/mcp/ingress";
import { createMcpTransport } from "@/lib/integrations/mcp/server";
import { untilAborted } from "@/lib/integrations/mcp/services";
import { readResponseText } from "@/lib/http/bounded-response";
import { readBoundedJson } from "@/lib/security/request-body";

export const runtime = "nodejs";
export const maxDuration = 30;

const deadlineMs = 20_000;
const maxConcurrentRequests = 8;
let pendingRequests = 0;

function failure(status: number, message: string, headers?: Record<string, string>) {
  return Response.json({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }, {
    status, headers: { "Cache-Control": "no-store", ...headers },
  });
}

async function handle(request: Request) {
  if (process.env.MCP_ENABLED !== "true") return failure(404, "The integration is not enabled.");
  let ingress: ReturnType<typeof integrationIngress>;
  try { ingress = integrationIngress(request); }
  catch (error) {
    return failure(error instanceof IntegrationIngressError ? error.status : 503, "The integration request could not be accepted.");
  }
  const cors: Record<string, string> = ingress.origin ? { "Access-Control-Allow-Origin": ingress.origin, Vary: "Origin" } : {};
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { ...cors, "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, MCP-Protocol-Version, Accept", "Cache-Control": "no-store" } });
  }
  if (request.method !== "POST") return failure(405, "Use stateless Streamable HTTP POST.", { ...cors, Allow: "POST, OPTIONS" });
  if (pendingRequests >= maxConcurrentRequests) return failure(503, "The integration is busy. Retry shortly.", { ...cors, "Retry-After": "5" });
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(deadlineMs)]);
  const transport = createMcpTransport(ingress.network);
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
    // Legacy clients receive a finite SSE exchange. Buffer it under the same
    // deadline so concurrency limits cover tool work, not just response headers.
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
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
export const OPTIONS = handle;
