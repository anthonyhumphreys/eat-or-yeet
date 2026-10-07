import "server-only";

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

import type { NextRequest, NextResponse } from "next/server";

import { securitySecret } from "./config";

const cookieName = "eoy_anon";

function sign(value: string): string {
  return createHmac("sha256", securitySecret()).update(value).digest("base64url");
}

function validSignedId(value: string | undefined): string | null {
  if (!value) return null;
  const segments = value.split(".");
  if (segments.length !== 2) return null;
  const [id, provided] = segments;
  if (!id || !provided || !isCanonicalUuid(id) || !/^[A-Za-z0-9_-]{43}$/.test(provided)) return null;
  const expected = sign(id);
  const providedBytes = Buffer.from(provided, "ascii");
  const expectedBytes = Buffer.from(expected, "ascii");
  if (providedBytes.length !== expectedBytes.length) return null;
  return timingSafeEqual(providedBytes, expectedBytes) ? id : null;
}

function isCanonicalUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
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

/**
 * Uses only Vercel's platform-overwritten client address in production. Local
 * development and tests intentionally skip this second, network-wide counter.
 */
export function trustedNetworkSubject(request: NextRequest): string | null {
  if (process.env.NODE_ENV !== "production") return null;
  if (process.env.VERCEL !== "1") {
    throw new Error("A trusted client IP source is required in production");
  }

  const address = request.headers.get("x-forwarded-for")?.trim();
  if (!address || address.includes(",")) {
    throw new Error("Vercel did not provide a single trusted client IP");
  }

  const normalized = normalizeNetworkAddress(address);
  if (!normalized) throw new Error("Vercel provided an invalid client IP");
  return `network:${normalized}`;
}

function normalizeNetworkAddress(address: string): string | null {
  const version = isIP(address);
  if (version === 4) return `ipv4:${address}`;
  if (version !== 6) return null;

  let value = address.toLowerCase();
  let ipv4Tail: string | null = null;
  const tail = value.match(/(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (tail) {
    ipv4Tail = tail[1];
    const octets = ipv4Tail.split(".").map(Number);
    if (octets.some((octet) => octet > 255)) return null;
    const firstGroup = ((octets[0] << 8) | octets[1]).toString(16);
    const secondGroup = ((octets[2] << 8) | octets[3]).toString(16);
    value = value.slice(0, -ipv4Tail.length) + `${firstGroup}:${secondGroup}`;
  }

  const separator = value.indexOf("::");
  const left = (separator >= 0 ? value.slice(0, separator) : value).split(":").filter(Boolean);
  const right = separator >= 0 ? value.slice(separator + 2).split(":").filter(Boolean) : [];
  const missing = 8 - left.length - right.length;
  if ((separator < 0 && missing !== 0) || (separator >= 0 && missing < 1)) return null;
  const groups = [...left, ...Array.from({ length: missing }, () => "0"), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;

  // Keep IPv4-mapped clients distinct instead of pooling all mapped addresses.
  if (groups.slice(0, 5).every((group) => Number.parseInt(group, 16) === 0) && groups[5] === "ffff") {
    const sixthGroup = Number.parseInt(groups[6], 16);
    const seventhGroup = Number.parseInt(groups[7], 16);
    const octets = [sixthGroup >> 8, sixthGroup & 255, seventhGroup >> 8, seventhGroup & 255];
    return `ipv4:${octets.join(".")}`;
  }

  return `ipv6:${groups.slice(0, 4).map((group) => Number.parseInt(group, 16).toString(16).padStart(4, "0")).join(":")}/64`;
}
