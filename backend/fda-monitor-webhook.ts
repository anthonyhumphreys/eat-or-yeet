import { z } from "zod";
import type { CloudflareBindings } from "./bindings";
import { workerRuntime } from "./runtime";
import { internal } from "./api";
import { fdaMonitorPath, monitorWebhookSchema, verifyMonitorSignature } from "../src/lib/incidents/firecrawl-monitor";
import { readResponseText, ResponseTooLargeError } from "../src/lib/http/bounded-response";

export async function receiveMonitorWebhook(request: Request, env: CloudflareBindings) {
  const json = (body: unknown, status: number) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (process.env.FDA_MONITOR_ENABLED !== "true") return json({ error: "Not found" }, 404);
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!process.env.FIRECRAWL_WEBHOOK_SECRET || !process.env.FDA_MONITOR_ID || process.env.FDA_ANNOUNCEMENTS_FETCH_MODE !== "firecrawl") return json({ error: "Monitor is not configured" }, 503);
  try {
    const body = await readResponseText(new Response(request.body, { headers: request.headers }), 256 * 1024);
    if (!await verifyMonitorSignature(body, request.headers.get("x-firecrawl-signature"), process.env.FIRECRAWL_WEBHOOK_SECRET)) return json({ error: "Unauthorized" }, 401);
    const event = monitorWebhookSchema.parse(JSON.parse(body));
    for (const page of event.data) {
      if (page.monitorId !== process.env.FDA_MONITOR_ID || page.checkId !== event.id) return json({ error: "Unexpected monitor identity" }, 400);
      if ("url" in page) fdaMonitorPath(page.url);
    }
    await workerRuntime(env).invoke(internal.fdaMonitor.receive, { event });
    return json({ accepted: true }, 202);
  } catch (error) {
    if (error instanceof ResponseTooLargeError) return json({ error: "Payload too large" }, 413);
    if (error instanceof z.ZodError || error instanceof SyntaxError || error instanceof TypeError || (error instanceof Error && error.message === "Unexpected FDA monitor URL")) return json({ error: "Invalid payload" }, 400);
    return json({ error: "Monitor receipt failed" }, 503);
  }
}
