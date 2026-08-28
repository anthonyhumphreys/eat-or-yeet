import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import type { VerdictResult } from "@/lib/domain/types";

const payloadSchema = z.object({
  verdict: z.enum(["EAT", "YEET", "MAYBE_YEET"]),
  matchLevel: z.enum(["confirmed", "probable", "possible", "contextual", "none"]),
  productName: z.string().max(120).nullable(),
  reason: z.string().max(240),
  incidentSlug: z.string().max(120).nullable(),
  expiresAt: z.number(),
});

export type ShareTokenPayload = z.infer<typeof payloadSchema>;

function secret() {
  const value = process.env.RATE_LIMIT_SALT;
  if (!value) throw new Error("Share signing is not configured");
  return value;
}

function signature(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function createShareToken(result: VerdictResult): string | null {
  if (result.verdict === "NO_CLUE") return null;
  const topMatch = result.matches[0];
  const data: ShareTokenPayload = {
    verdict: result.verdict,
    matchLevel: result.matchLevel,
    productName: result.observation.productName?.slice(0, 120) ?? null,
    reason: (topMatch?.reasons[0]?.message ?? "No current matching warning found.").slice(0, 240),
    incidentSlug: topMatch?.incident.slug ?? null,
    expiresAt: Date.now() + 15 * 60 * 1000,
  };
  const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

export function verifyShareToken(token: string): ShareTokenPayload | null {
  const [payload, provided] = token.split(".");
  if (!payload || !provided) return null;
  const expected = signature(payload);
  if (provided.length !== expected.length || !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) return null;
  try {
    const parsed = payloadSchema.parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    return parsed.expiresAt > Date.now() ? parsed : null;
  } catch {
    return null;
  }
}
