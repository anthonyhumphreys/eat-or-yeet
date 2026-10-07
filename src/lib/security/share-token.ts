import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import type { VerdictResult } from "@/lib/domain/types";
import { securitySecret } from "./config";

const shareReason = "This result reflects the official food safety data available at the time of the check.";
const regionSchema = z.enum(["UK", "US"]);
const payloadSchema = z.object({
  verdict: z.enum(["EAT", "YEET", "MAYBE_YEET"]),
  matchLevel: z.enum(["confirmed", "probable", "possible", "contextual", "none"]),
  productName: z.string().max(120).nullable(),
  reason: z.literal(shareReason),
  incidentSlug: z.string().max(120).nullable(),
  checkedAt: z.string().refine((value) => {
    const date = new Date(value);
    return Number.isFinite(date.valueOf()) && date.toISOString() === value;
  }),
  datasetRegions: z.array(regionSchema).min(1).max(2).refine((regions) => new Set(regions).size === regions.length),
  sourceScope: z.string().trim().min(1).max(120).optional(),
  expiresAt: z.number().int().positive().safe(),
}).strict();

export type ShareTokenPayload = z.infer<typeof payloadSchema>;

function signature(payload: string) {
  return createHmac("sha256", securitySecret()).update(payload).digest("base64url");
}

function sourceScope(result: VerdictResult): string | undefined {
  const status = result.datasetStatus;
  if (!status) return undefined;
  const scopes = [...new Set(status.sources.map((source) => source.scope.trim()).filter(Boolean))];
  const joined = scopes.join("; ").slice(0, 120).trim();
  return joined || undefined;
}

export function createShareToken(result: VerdictResult): string | null {
  if (result.verdict === "NO_CLUE") return null;
  const topMatch = result.matches[0];
  const data: ShareTokenPayload = {
    verdict: result.verdict,
    matchLevel: result.matchLevel,
    // This existing field now carries only a title from the official incident dataset.
    productName: topMatch?.incident.title.slice(0, 120) ?? null,
    reason: shareReason,
    incidentSlug: topMatch?.incident.slug ?? null,
    checkedAt: result.checkedAt,
    datasetRegions: result.datasetRegions,
    sourceScope: sourceScope(result),
    expiresAt: Date.now() + 15 * 60 * 1000,
  };
  const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

export function verifyShareToken(token: string): ShareTokenPayload | null {
  if (token.length > 4096) return null;
  const segments = token.split(".");
  if (segments.length !== 2) return null;
  const [payload, provided] = segments;
  if (!payload || !/^[A-Za-z0-9_-]{43}$/.test(provided)) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(payload) || payload.length > 2048 || payload.length % 4 === 1) return null;
  const payloadBytes = Buffer.from(payload, "base64url");
  if (payloadBytes.toString("base64url") !== payload) return null;
  const expected = signature(payload);
  const providedBytes = Buffer.from(provided, "ascii");
  const expectedBytes = Buffer.from(expected, "ascii");
  if (providedBytes.length !== expectedBytes.length || !timingSafeEqual(providedBytes, expectedBytes)) return null;

  let json: string;
  try {
    json = new TextDecoder("utf-8", { fatal: true }).decode(payloadBytes);
  } catch {
    return null;
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(json) as unknown;
  } catch {
    return null;
  }
  const parsed = payloadSchema.safeParse(parsedJson);
  return parsed.success && parsed.data.expiresAt > Date.now() ? parsed.data : null;
}
