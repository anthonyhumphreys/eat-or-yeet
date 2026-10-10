import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { authenticateMcpConnection } from "@/lib/integrations/mcp/connection-auth";

const token = "notion-review-test-token-0123456789";
const digest = createHash("sha256").update(token).digest("hex");
const live = JSON.stringify([{ id: "notion-shopping", sha256: digest, dailyLimit: 40, expiresAt: "2099-01-01T00:00:00.000Z" }]);

function request(authorization?: string) {
  return new Request("https://eatoryeet.app/mcp/notion", { headers: authorization ? { authorization } : {} });
}

describe("private MCP connection authentication", () => {
  afterEach(() => vi.useRealTimers());

  it("authenticates only a configured unexpired bearer digest", () => {
    expect(authenticateMcpConnection(request(`Bearer ${token}`), live)).toEqual({
      ok: true,
      connection: { id: "notion-shopping", dailyLimit: 40 },
    });
    expect(authenticateMcpConnection(request(), live)).toEqual({ ok: false, status: 401 });
    expect(authenticateMcpConnection(request("Bearer wrong"), live)).toEqual({ ok: false, status: 401 });
  });

  it("rejects expired and revoked keys", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-09T00:00:00.000Z"));
    const expired = JSON.stringify([{ id: "notion-shopping", sha256: digest, dailyLimit: 40, expiresAt: "2026-10-08T23:59:59.000Z" }]);
    expect(authenticateMcpConnection(request(`Bearer ${token}`), expired)).toEqual({ ok: false, status: 401 });
    expect(authenticateMcpConnection(request(`Bearer ${token}`), "[]")).toEqual({ ok: false, status: 503 });
  });

  it("fails closed on malformed configuration without exposing its contents", () => {
    const duplicateDigest = JSON.stringify([
      { id: "first", sha256: digest, dailyLimit: 2, expiresAt: "2099-01-01T00:00:00.000Z" },
      { id: "second", sha256: digest.toUpperCase(), dailyLimit: 2, expiresAt: "2099-01-01T00:00:00.000Z" },
    ]);
    const rolloverDate = JSON.stringify([{ id: "bad-date", sha256: digest, dailyLimit: 2, expiresAt: "2026-02-30T00:00:00.000Z" }]);
    const oversized = `${live}${" ".repeat(16 * 1024)}`;
    for (const invalid of [
      "not-json",
      "{}",
      "[]",
      JSON.stringify([{ id: "bad id", sha256: digest, dailyLimit: 2, expiresAt: "2099-01-01T00:00:00.000Z" }]),
      duplicateDigest,
      rolloverDate,
      oversized,
    ]) {
      expect(authenticateMcpConnection(request(`Bearer ${token}`), invalid)).toEqual({ ok: false, status: 503 });
    }
  });
});
