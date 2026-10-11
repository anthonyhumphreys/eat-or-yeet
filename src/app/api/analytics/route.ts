import { NextRequest } from "next/server";
import { ANALYTICS_CONSENT_COOKIE, ANALYTICS_CONSENT_VERSION, WebsiteCaptureSchema } from "@/lib/analytics/contracts";
import { analyticsEnabled, scheduleEvent } from "@/lib/analytics/server";
import { readBoundedJson } from "@/lib/security/request-body";
import { trustedNetworkSubject } from "@/lib/security/anonymous";
import { takeRateLimits } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  const reply = (status: number) => new Response(null, { status, headers: { "Cache-Control": "no-store" } });
  if (!analyticsEnabled()) return reply(204);
  if (request.headers.get("origin") !== request.nextUrl.origin) return reply(403);
  if (request.cookies.get(ANALYTICS_CONSENT_COOKIE)?.value !== `${ANALYTICS_CONSENT_VERSION}.accepted`
      || request.headers.get("sec-gpc") === "1" || request.headers.get("dnt") === "1") return reply(204);
  const body = await readBoundedJson(request, 1024);
  const parsed = WebsiteCaptureSchema.safeParse(body.ok ? body.value : null);
  if (!parsed.success) return reply(body.ok || body.reason !== "too_large" ? 400 : 413);
  try {
    const network = trustedNetworkSubject(request);
    if (!network) return reply(204);
    const [limit] = await takeRateLimits([{ subject: network, scope: "network" }], "analytics");
    if (!limit?.allowed) return reply(429);
    const { event, ...properties } = parsed.data.data;
    scheduleEvent(event, { source: "website", ...properties });
  } catch { /* Optional analytics fails closed without affecting any product check. */ }
  return reply(204);
}
