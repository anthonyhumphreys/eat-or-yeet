import { NextRequest, NextResponse } from "next/server";

import { CheckRequestSchema } from "@/lib/domain/schemas";
import { checkProduct } from "@/lib/checks/service";
import { anonymousSubject, attachAnonymousCookie, trustedNetworkSubject } from "@/lib/security/anonymous";
import { readBoundedJson } from "@/lib/security/request-body";
import { takeRateLimits } from "@/lib/security/rate-limit";
import { createShareToken } from "@/lib/security/share-token";

export const runtime = "nodejs";

const maxBodyBytes = 16 * 1024;

function jsonResponse(
  body: unknown,
  status: number,
  cookieValue?: string,
  headers?: Record<string, string>,
) {
  const response = NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
  attachAnonymousCookie(response, cookieValue);
  return response;
}

export async function POST(request: NextRequest) {
  let cookieValue: string | undefined;
  try {
    const subject = anonymousSubject(request);
    cookieValue = subject.cookieValue;
    const networkSubject = trustedNetworkSubject(request);
    const limits = await takeRateLimits([
      { subject: subject.id, scope: "anonymous" },
      ...(networkSubject ? [{ subject: networkSubject, scope: "network" as const }] : []),
    ], "check");
    if (limits.some((limit) => !limit.allowed)) {
      return jsonResponse(
        { error: "Check limit reached. Try again after the current hour." },
        429,
        cookieValue,
        { "X-RateLimit-Remaining": String(Math.min(...limits.map((limit) => limit.remaining))) },
      );
    }

    const body = await readBoundedJson(request, maxBodyBytes);
    if (!body.ok && body.reason === "too_large") {
      return jsonResponse({ error: "The product details were too large to check." }, 413, cookieValue);
    }
    const parsed = CheckRequestSchema.safeParse(body.ok ? body.value : null);
    if (!parsed.success) return jsonResponse({ error: "The product details were not valid." }, 400, cookieValue);

    const { result } = await checkProduct(parsed.data.observation, parsed.data.region);
    const response = jsonResponse({ ...result, shareToken: createShareToken(result) ?? undefined }, 200, cookieValue, {
      "X-RateLimit-Remaining": String(Math.min(...limits.map((limit) => limit.remaining))),
    });
    return response;
  } catch {
    return jsonResponse(
      { error: "We couldn't reach the warning database. No verdict was issued." },
      503,
      cookieValue,
    );
  }
}
