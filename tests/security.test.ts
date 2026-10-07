import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("convex/nextjs", () => ({ fetchMutation: vi.fn(async () => 1) }));

import { fetchMutation } from "convex/nextjs";
import { anonymousSubject, trustedNetworkSubject } from "@/lib/security/anonymous";
import { securitySecret } from "@/lib/security/config";
import { readBoundedJson } from "@/lib/security/request-body";
import { takeRateLimit } from "@/lib/security/rate-limit";

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
    await takeRateLimit(firstAnonymous.id, "check", "anonymous");
    await takeRateLimit(firstNetwork, "check", "network");
    await takeRateLimit(resetAnonymous.id, "check", "anonymous");
    await takeRateLimit(resetNetwork, "check", "network");

    const calls = vi.mocked(fetchMutation).mock.calls;
    const keys = calls.map((call) => (call[1] as { key: string }).key);
    expect(keys[0]).not.toBe(keys[2]);
    expect(keys[1]).toBe(keys[3]);
    expect(calls.every((call) => (call[1] as { action: string }).action === "check")).toBe(true);
  });
});
