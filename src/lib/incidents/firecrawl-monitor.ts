import { z } from "zod";
import { readResponseJson } from "../http/bounded-response";

export const FDA_LISTING_URL = "https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts";
export const monitorPageSchema = z.object({
  monitorId: z.string().uuid(), checkId: z.string().uuid(),
  url: z.string().url().max(2_000),
  status: z.enum(["same", "new", "changed", "removed", "error"]),
});
export const monitorWebhookSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("monitor.page"), id: z.string().uuid(), data: z.array(monitorPageSchema).min(1).max(25) }),
  z.object({ type: z.literal("monitor.check.completed"), id: z.string().uuid(), data: z.array(z.object({
    monitorId: z.string().uuid(), checkId: z.string().uuid(),
    status: z.enum(["completed", "failed", "partial", "skipped_overlap", "skipped_no_credits"]),
  })).min(1).max(1) }),
]);
export type MonitorWebhook = z.infer<typeof monitorWebhookSchema>;

export function fdaMonitorPath(value: string) {
  const url = new URL(value);
  if (url.href === FDA_LISTING_URL) return null;
  if (url.origin !== "https://www.fda.gov" || url.username || url.password || url.search || url.hash
    || !/^\/safety\/recalls-market-withdrawals-safety-alerts\/[^/]+$/.test(url.pathname)) {
    throw new Error("Unexpected FDA monitor URL");
  }
  return url.pathname;
}

export async function verifyMonitorSignature(body: string, signature: string | null, secret: string | undefined) {
  if (!secret || !signature || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const bytes = Uint8Array.from(signature.slice(7).match(/../g)!, byte => parseInt(byte, 16));
  return crypto.subtle.verify("HMAC", key, bytes, new TextEncoder().encode(body));
}

export function monitorTargets(urls: string[], detailLimit: number) {
  if (!Number.isSafeInteger(detailLimit) || detailLimit < 0 || detailLimit > 10_000) throw new Error("Choose 0–10000 monitored detail pages");
  for (const url of urls) fdaMonitorPath(url);
  return [FDA_LISTING_URL, ...new Set(urls.filter(url => url !== FDA_LISTING_URL))].slice(0, detailLimit + 1);
}
export const monitorScrapeOptions = { formats: ["markdown"], onlyMainContent: false, maxAge: 0, timeout: 30_000, location: { country: "US", languages: ["en-US"] } };
export class MonitorRateLimit extends Error {
  constructor(readonly delay: number) { super("Firecrawl Monitor control API rate limited"); }
}
export async function monitorRequest(path: string, apiKey: string | undefined, method = "GET", body?: unknown) {
  if (!apiKey?.trim()) throw new Error("FIRECRAWL_API_KEY is required");
  if (!/^\/monitor(?:\/[a-f0-9-]{36})?$/.test(path)) throw new Error("Invalid monitor endpoint");
  let response: Response;
  try {
    response = await fetch(`https://api.firecrawl.dev/v2${path}`, { method, headers: { Authorization: `Bearer ${apiKey.trim()}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: "manual", signal: AbortSignal.timeout(35_000) });
  } catch { throw new Error("Firecrawl Monitor control request failed"); }
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 429) {
      const seconds = Number(response.headers.get("retry-after"));
      throw new MonitorRateLimit(Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 120) * 1000 : 60_000);
    }
    throw new Error(`Firecrawl Monitor control returned HTTP ${response.status}`);
  }
  return readResponseJson(response, 2 * 1024 * 1024);
}
export const monitorResponseSchema = z.object({ success: z.literal(true), data: z.object({
  id: z.string().uuid(), name: z.string().startsWith("Eat or Yeet FDA"),
  judgeEnabled: z.boolean().optional(),
  targets: z.array(z.object({ id: z.string().uuid(), type: z.literal("scrape"), urls: z.array(z.string().url()) })).length(1),
}) });
