import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("convex/nextjs", () => ({ fetchMutation: vi.fn(async (_reference, args) => args.buckets.map(() => 1)) }));

import { fetchMutation } from "convex/nextjs";
import { anonymousSubject, trustedNetworkSubject } from "@/lib/security/anonymous";
import { securitySecret } from "@/lib/security/config";
import { readBoundedJson } from "@/lib/security/request-body";
import { takeRateLimit, takeRateLimits } from "@/lib/security/rate-limit";

const originalNodeEnv = process.env.NODE_ENV;
const originalVercel = process.env.VERCEL;
const originalSalt = process.env.RATE_LIMIT_SALT;
const originalConvexSecret = process.env.CONVEX_SERVER_SECRET;

function request(url: string, headers?: HeadersInit) {
  return new NextRequest(url, { headers });
}

describe("security boundaries", () => {
  beforeEach(() => {
    Reflect.set(process.env, "NODE_ENV", "test");
    process.env.RATE_LIMIT_SALT = "test-only-security-secret";
    process.env.CONVEX_SERVER_SECRET = "test-only-convex-secret";
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalNodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
    else Reflect.set(process.env, "NODE_ENV", originalNodeEnv);
    if (originalVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = originalVercel;
    if (originalSalt === undefined) delete process.env.RATE_LIMIT_SALT;
    else process.env.RATE_LIMIT_SALT = originalSalt;
    if (originalConvexSecret === undefined) delete process.env.CONVEX_SERVER_SECRET;
    else process.env.CONVEX_SERVER_SECRET = originalConvexSecret;
  });

  it("replaces a signed cookie with non-ASCII signature bytes without throwing", () => {
    const uuid = "f65d3bc8-2fac-4b94-9f37-0472c0be5d5e";
    const subject = anonymousSubject(request("http://localhost/api/check", { cookie: `eoy_anon=${uuid}.é` }));

    expect(subject.id).not.toBe(uuid);
    expect(subject.cookieValue).toMatch(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/);
  });

  it("uses Vercel's overwritten client address and coalesces IPv6 addresses by /64", () => {
    Reflect.set(process.env, "NODE_ENV", "production");
    process.env.VERCEL = "1";

    const first = trustedNetworkSubject(request("https://example.test", { "x-forwarded-for": "2001:db8::1" }));
    const sameSubnet = trustedNetworkSubject(request("https://example.test", { "x-forwarded-for": "2001:0db8:0000:0000:abcd::2" }));
    const ipv4 = trustedNetworkSubject(request("https://example.test", { "x-forwarded-for": "198.51.100.17" }));

    expect(first).toBe(sameSubnet);
    expect(ipv4).toBe("network:ipv4:198.51.100.17");
    expect(() => trustedNetworkSubject(request("https://example.test", { "x-forwarded-for": "198.51.100.17, 203.0.113.8" }))).toThrow();
  });

  it("fails closed in production without a trusted network identity or signing salt", () => {
    Reflect.set(process.env, "NODE_ENV", "production");
    delete process.env.VERCEL;
    delete process.env.RATE_LIMIT_SALT;

    expect(() => trustedNetworkSubject(request("https://example.test", { "x-forwarded-for": "198.51.100.17" }))).toThrow();
    expect(() => securitySecret()).toThrow("RATE_LIMIT_SALT is not configured");
  });

  it("bounds streamed bodies even when Content-Length is absent", async () => {
    const oversized = new Request("http://localhost/api/check", {
      method: "POST",
      body: JSON.stringify({ padding: "x".repeat(64) }),
    });
    const malformed = new Request("http://localhost/api/check", { method: "POST", body: "{\"x\":" });

    await expect(readBoundedJson(oversized, 32)).resolves.toEqual({ ok: false, reason: "too_large" });
    await expect(readBoundedJson(malformed, 32)).resolves.toEqual({ ok: false, reason: "invalid_json" });
  });

  it("keeps a shared network bucket stable when a client resets its anonymous cookie", async () => {
    Reflect.set(process.env, "NODE_ENV", "production");
    process.env.VERCEL = "1";
    const firstRequest = request("https://example.test", { "x-forwarded-for": "198.51.100.17" });
    const resetCookieRequest = request("https://example.test", {
      "x-forwarded-for": "198.51.100.17",
      cookie: "eoy_anon=not-a-valid-signed-cookie",
    });
    const firstAnonymous = anonymousSubject(firstRequest);
    const resetAnonymous = anonymousSubject(resetCookieRequest);
    const firstNetwork = trustedNetworkSubject(firstRequest)!;
    const resetNetwork = trustedNetworkSubject(resetCookieRequest)!;

    expect(firstAnonymous.id).not.toBe(resetAnonymous.id);
    expect(firstNetwork).toBe(resetNetwork);
    await takeRateLimits([
      { subject: firstAnonymous.id, scope: "anonymous" },
      { subject: firstNetwork, scope: "network" },
    ], "check");
    await takeRateLimits([
      { subject: resetAnonymous.id, scope: "anonymous" },
      { subject: resetNetwork, scope: "network" },
    ], "check");

    const calls = vi.mocked(fetchMutation).mock.calls;
    const firstBuckets = (calls[0]?.[1] as { buckets: Array<{ key: string; action: string }> }).buckets;
    const resetBuckets = (calls[1]?.[1] as { buckets: Array<{ key: string; action: string }> }).buckets;
    expect(calls).toHaveLength(2);
    expect(firstBuckets[0]?.key).not.toBe(resetBuckets[0]?.key);
    expect(firstBuckets[1]?.key).toBe(resetBuckets[1]?.key);
    expect([...firstBuckets, ...resetBuckets].every((item) => item.action === "check")).toBe(true);
  });

  it("consumes anonymous and network buckets in one call and applies each scope cap", async () => {
    vi.mocked(fetchMutation).mockResolvedValueOnce([121, 600] as never);

    const limits = await takeRateLimits([
      { subject: "person", scope: "anonymous" },
      { subject: "network:ipv4:198.51.100.17", scope: "network" },
    ], "check");

    expect(fetchMutation).toHaveBeenCalledOnce();
    expect(vi.mocked(fetchMutation).mock.calls[0]?.[1]).toMatchObject({
      buckets: [
        { action: "check", windowStartedAt: expect.any(Number), expiresAt: expect.any(Number) },
        { action: "check", windowStartedAt: expect.any(Number), expiresAt: expect.any(Number) },
      ],
    });
    expect(limits.map(({ scope, allowed, limit }) => ({ scope, allowed, limit }))).toEqual([
      { scope: "anonymous", allowed: false, limit: 120 },
      { scope: "network", allowed: true, limit: 600 },
    ]);
  });

  it("keeps hourly bucket keys stable within an hour and rolls them over together", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(30 * 60 * 1000));
    const subject = [{ subject: "person", scope: "anonymous" as const }];

    await takeRateLimits(subject, "check");
    vi.setSystemTime(new Date(59 * 60 * 1000 + 59_999));
    await takeRateLimits(subject, "check");
    vi.setSystemTime(new Date(60 * 60 * 1000));
    await takeRateLimits(subject, "check");

    const buckets = vi.mocked(fetchMutation).mock.calls.map((call) =>
      (call[1] as { buckets: Array<{ key: string; windowStartedAt: number; expiresAt: number }> }).buckets[0],
    );
    expect(buckets[0]?.key).toBe(buckets[1]?.key);
    expect(buckets[2]?.key).not.toBe(buckets[1]?.key);
    expect(buckets[0]).toMatchObject({ windowStartedAt: 0, expiresAt: 2 * 60 * 60 * 1000 });
    expect(buckets[2]).toMatchObject({ windowStartedAt: 60 * 60 * 1000, expiresAt: 3 * 60 * 60 * 1000 });
  });

  it("fails closed when the batched datastore returns an incomplete count list", async () => {
    vi.mocked(fetchMutation).mockResolvedValueOnce([1] as never);

    await expect(takeRateLimits([
      { subject: "person", scope: "anonymous" },
      { subject: "network:ipv4:198.51.100.17", scope: "network" },
    ], "check")).rejects.toThrow("rate-limit datastore returned invalid counts");
  });

  it("keeps the single-bucket helper contract through the batched mutation", async () => {
    await takeRateLimit("person", "share", "anonymous");

    expect(fetchMutation).toHaveBeenCalledOnce();
    expect(vi.mocked(fetchMutation).mock.calls[0]?.[1]).toMatchObject({
      buckets: [{ action: "share" }],
    });
  });
});
