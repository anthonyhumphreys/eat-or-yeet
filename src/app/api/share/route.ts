import { randomBytes } from "node:crypto";

import { fetchMutation } from "convex/nextjs";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { api } from "@convex/_generated/api";
import { anonymousSubject, attachAnonymousCookie } from "@/lib/security/anonymous";
import { takeRateLimit } from "@/lib/security/rate-limit";
import { verifyShareToken } from "@/lib/security/share-token";

const shareSchema = z.object({ token: z.string().min(40).max(2000) });

export async function POST(request: NextRequest) {
  const subject = anonymousSubject(request);
  const limit = await takeRateLimit(subject.id, "share");
  if (!limit.allowed) return NextResponse.json({ error: "Share limit reached." }, { status: 429 });
  const parsed = shareSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "That verdict cannot be shared." }, { status: 400 });
  const verified = verifyShareToken(parsed.data.token);
  if (!verified) return NextResponse.json({ error: "That verdict has expired. Run the check again." }, { status: 400 });
  const id = randomBytes(9).toString("base64url");
  const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
  await fetchMutation(api.shares.create, {
    secret: process.env.CONVEX_SERVER_SECRET ?? "",
    shareId: id,
    verdict: verified.verdict,
    matchLevel: verified.matchLevel,
    productName: verified.productName ?? undefined,
    reason: verified.reason,
    incidentSlug: verified.incidentSlug ?? undefined,
    expiresAt,
  });
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin;
  const response = NextResponse.json({ url: `${origin}/s/${id}` });
  attachAnonymousCookie(response, subject.cookieValue);
  return response;
}
