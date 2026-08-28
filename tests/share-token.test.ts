import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
      productName: "Test oats",
    });
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
});
