import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

import { emptyObservation } from "@/lib/domain/schemas";
import type { VerdictResult } from "@/lib/domain/types";
import { createShareToken, verifyShareToken } from "@/lib/security/share-token";

function eatResult(): VerdictResult {
  return {
    verdict: "EAT",
    matchLevel: "none",
    observation: {
      ...emptyObservation(),
      productName: "Test oats",
    },
    matches: [],
    checkedAt: new Date().toISOString(),
    datasetRegions: ["UK"],
  };
}

function matchedResult(): VerdictResult {
  const result = eatResult();
  const incident = {
    title: "Official oat recall",
    slug: "official-oat-recall",
  };
  result.verdict = "YEET";
  result.matchLevel = "probable";
  result.matches = [{
    incident: incident as never,
    level: "probable",
    score: 90,
    reasons: [{ type: "gtin", evidence: "0123456789012", message: "Barcode 0123456789012 matched" }],
  }];
  return result;
}

describe("public share tokens", () => {
  beforeEach(() => {
    process.env.RATE_LIMIT_SALT = "test-only-share-signing-secret";
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.RATE_LIMIT_SALT;
  });

  it("round-trips a server-issued verdict", () => {
    const token = createShareToken(eatResult());

    expect(token).not.toBeNull();
    expect(verifyShareToken(token!)).toMatchObject({
      verdict: "EAT",
      matchLevel: "none",
      productName: null,
      datasetRegions: ["UK"],
    });
  });

  it("shares only the official incident title and fixed generic reason", () => {
    const token = createShareToken(matchedResult())!;
    const payloadJson = Buffer.from(token.split(".")[0], "base64url").toString("utf8");
    const verified = verifyShareToken(token);

    expect(verified).toMatchObject({
      productName: "Official oat recall",
      incidentSlug: "official-oat-recall",
      reason: "This result reflects the official food safety data available at the time of the check.",
    });
    expect(payloadJson).not.toContain("Test oats");
    expect(payloadJson).not.toContain("0123456789012");
    expect(payloadJson).not.toContain("Barcode");
  });

  it("rejects a token whose signed payload was changed", () => {
    const token = createShareToken(eatResult())!;
    const [payload, signature] = token.split(".");
    const alteredPayload = `${payload.slice(0, -1)}${payload.endsWith("A") ? "B" : "A"}`;

    expect(verifyShareToken(`${alteredPayload}.${signature}`)).toBeNull();
  });

  it("rejects an expired token", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-28T12:00:00Z"));
    const token = createShareToken(eatResult())!;
    vi.advanceTimersByTime(16 * 60 * 1000);

    expect(verifyShareToken(token)).toBeNull();
  });

  it("rejects malformed Unicode signatures and legacy tokens without check metadata", () => {
    const token = createShareToken(eatResult())!;
    const [payload, signature] = token.split(".");

    expect(verifyShareToken(`${payload}.é${signature.slice(1)}`)).toBeNull();

    const legacyPayload = Buffer.from(JSON.stringify({
      verdict: "EAT",
      matchLevel: "none",
      productName: "Old product name",
      reason: "A user supplied explanation",
      incidentSlug: null,
      expiresAt: Date.now() + 60_000,
    })).toString("base64url");
    const legacySignature = createHmac("sha256", process.env.RATE_LIMIT_SALT!).update(legacyPayload).digest("base64url");
    expect(verifyShareToken(`${legacyPayload}.${legacySignature}`)).toBeNull();
  });
});
