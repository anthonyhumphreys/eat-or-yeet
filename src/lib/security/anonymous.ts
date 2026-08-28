import "server-only";

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import type { NextRequest, NextResponse } from "next/server";

const cookieName = "eoy_anon";

function secret(): string {
  return process.env.RATE_LIMIT_SALT || "local-development-only";
}

function sign(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

function validSignedId(value: string | undefined): string | null {
  if (!value) return null;
  const [id, signature] = value.split(".");
  if (!id || !signature) return null;
  const expected = sign(id);
  if (signature.length !== expected.length) return null;
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) ? id : null;
}

export function anonymousSubject(request: NextRequest): { id: string; cookieValue?: string } {
  const existing = validSignedId(request.cookies.get(cookieName)?.value);
  if (existing) return { id: existing };
  const id = randomUUID();
  return { id, cookieValue: `${id}.${sign(id)}` };
}

export function attachAnonymousCookie(response: NextResponse, value?: string): void {
  if (!value) return;
  response.cookies.set(cookieName, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}
