import { randomBytes } from "node:crypto";

import { fetchMutation } from "convex/nextjs";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { api } from "@convex/_generated/api";
import { anonymousSubject, attachAnonymousCookie, trustedNetworkSubject } from "@/lib/security/anonymous";
import { readBoundedJson } from "@/lib/security/request-body";
import { takeRateLimits } from "@/lib/security/rate-limit";
import { verifyShareToken } from "@/lib/security/share-token";

export const runtime = "nodejs";

const shareSchema = z.object({ token: z.string().min(40).max(2000) }).strict();
const maxBodyBytes = 4 * 1024;

function jsonResponse(body: unknown, status: number, cookieValue?: string) {
  const response = NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  attachAnonymousCookie(response, cookieValue);
  return response;
}

function resolvePublicOrigin(request: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (!configured) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("NEXT_PUBLIC_APP_URL must be configured in production");
    }
    return request.nextUrl.origin;
  }

  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error("NEXT_PUBLIC_APP_URL must be a valid origin");
  }

  const originOnlySyntax = /^https?:\/\/[^/?#]+\/?$/i.test(configured);
  const validProtocol = url.protocol === "https:" || (process.env.NODE_ENV !== "production" && url.protocol === "http:");
  if (
    !originOnlySyntax ||
    !validProtocol ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.href.includes("@")
  ) {
    throw new Error("NEXT_PUBLIC_APP_URL must be an HTTP(S) origin without credentials or a path");
  }

  return url.origin;
}

export async function POST(request: NextRequest) {
  let cookieValue: string | undefined;
  try {
    const origin = resolvePublicOrigin(request);
    const subject = anonymousSubject(request);
    cookieValue = subject.cookieValue;
    const networkSubject = trustedNetworkSubject(request);
    const limits = await takeRateLimits([
      { subject: subject.id, scope: "anonymous" },
      ...(networkSubject ? [{ subject: networkSubject, scope: "network" as const }] : []),
    ], "share");

    if (limits.some((limit) => !limit.allowed)) {
      return jsonResponse({ error: "Share limit reached." }, 429, cookieValue);
    }

    const body = await readBoundedJson(request, maxBodyBytes);
    if (!body.ok && body.reason === "too_large") {
      return jsonResponse({ error: "That verdict cannot be shared." }, 413, cookieValue);
    }
    const parsed = shareSchema.safeParse(body.ok ? body.value : null);
    if (!parsed.success) return jsonResponse({ error: "That verdict cannot be shared." }, 400, cookieValue);

    const verified = verifyShareToken(parsed.data.token);
    if (!verified) return jsonResponse({ error: "That verdict has expired. Run the check again." }, 400, cookieValue);

    const id = randomBytes(9).toString("base64url");
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
    await fetchMutation(api.shares.create, {
      secret: process.env.CONVEX_SERVER_SECRET ?? "",
      shareId: id,
      verdict: verified.verdict,
      matchLevel: verified.matchLevel,
      productName: verified.productName ?? undefined,
      reason: verified.reason,
      incidentSlug: verified.incidentSlug ?? undefined,
      checkedAt: new Date(verified.checkedAt).getTime(),
      datasetRegions: verified.datasetRegions,
      sourceScope: verified.sourceScope,
      expiresAt,
    });
    return jsonResponse({ url: `${origin}/s/${id}` }, 200, cookieValue);
  } catch {
    return jsonResponse({ error: "We couldn't save that verdict right now." }, 503, cookieValue);
  }
}
