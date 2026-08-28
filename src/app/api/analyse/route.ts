import { NextRequest, NextResponse } from "next/server";

import { extractProductObservation } from "@/lib/ai/extract";
import { anonymousSubject, attachAnonymousCookie } from "@/lib/security/anonymous";
import { takeRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 45;

const acceptedTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

export async function POST(request: NextRequest) {
  const subject = anonymousSubject(request);
  const limit = await takeRateLimit(subject.id, "analyse");
  if (!limit.allowed) {
    const response = NextResponse.json(
      { error: "Photo limit reached. Try again after the current hour." },
      { status: 429 },
    );
    response.headers.set("Retry-After", String(Math.max(1, Math.ceil((limit.resetAt.getTime() - Date.now()) / 1000))));
    attachAnonymousCookie(response, subject.cookieValue);
    return response;
  }

  try {
    const form = await request.formData();
    const file = form.get("image");
    if (!(file instanceof File)) return NextResponse.json({ error: "Choose a packaging photo." }, { status: 400 });
    if (!acceptedTypes.has(file.type)) return NextResponse.json({ error: "Use a JPEG, PNG, WebP, HEIC, or HEIF image." }, { status: 415 });
    if (file.size > 8 * 1024 * 1024) return NextResponse.json({ error: "That image is over the 8 MB limit." }, { status: 413 });
    const observation = await extractProductObservation(file);
    const response = NextResponse.json({ observation });
    response.headers.set("X-RateLimit-Limit", String(limit.limit));
    response.headers.set("X-RateLimit-Remaining", String(limit.remaining));
    response.headers.set("Cache-Control", "no-store");
    attachAnonymousCookie(response, subject.cookieValue);
    return response;
  } catch (error) {
    const message = error instanceof Error && error.message === "Photo analysis is not configured"
      ? error.message
      : "We couldn't read that photo. Try a sharper shot of the label or barcode.";
    return NextResponse.json({ error: message }, { status: message.includes("configured") ? 503 : 422 });
  }
}
