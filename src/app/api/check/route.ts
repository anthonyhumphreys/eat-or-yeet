import { NextRequest, NextResponse } from "next/server";

import { getActiveIncidents } from "@/db/queries";
import { CheckRequestSchema } from "@/lib/domain/schemas";
import { runMatcher } from "@/lib/matching/matcher";
import { enrichObservation } from "@/lib/products/enrich";
import { anonymousSubject, attachAnonymousCookie } from "@/lib/security/anonymous";
import { takeRateLimit } from "@/lib/security/rate-limit";
import { createShareToken } from "@/lib/security/share-token";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const subject = anonymousSubject(request);
  const limit = await takeRateLimit(subject.id, "check");
  if (!limit.allowed) {
    const response = NextResponse.json({ error: "Check limit reached. Try again after the current hour." }, { status: 429 });
    attachAnonymousCookie(response, subject.cookieValue);
    return response;
  }
  const parsed = CheckRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "The product details were not valid." }, { status: 400 });
  try {
    const [observation, activeIncidents] = await Promise.all([
      enrichObservation(parsed.data.observation),
      getActiveIncidents(parsed.data.region),
    ]);
    const result = runMatcher(observation, activeIncidents, [parsed.data.region]);
    const response = NextResponse.json({ ...result, shareToken: createShareToken(result) ?? undefined });
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("X-RateLimit-Remaining", String(limit.remaining));
    attachAnonymousCookie(response, subject.cookieValue);
    return response;
  } catch {
    return NextResponse.json(
      { error: "We couldn't reach the warning database. No verdict was issued." },
      { status: 503 },
    );
  }
}
