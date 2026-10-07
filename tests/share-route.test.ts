import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("convex/nextjs", () => ({ fetchMutation: vi.fn(async () => undefined) }));
vi.mock("@/lib/security/anonymous", () => ({
  anonymousSubject: vi.fn(() => ({ id: "test-user" })),
  attachAnonymousCookie: vi.fn(),
  trustedNetworkSubject: vi.fn(() => null),
}));
vi.mock("@/lib/security/rate-limit", () => ({
  takeRateLimit: vi.fn(async () => ({ allowed: true, limit: 20, remaining: 19, resetAt: new Date() })),
}));
vi.mock("@/lib/security/share-token", () => ({
  verifyShareToken: vi.fn(() => ({
    verdict: "YEET",
    matchLevel: "probable",
    productName: "Official oat recall",
    reason: "This result reflects the official food safety data available at the time of the check.",
    incidentSlug: "official-oat-recall",
    checkedAt: "2026-10-07T12:00:00.000Z",
    datasetRegions: ["UK"],
    sourceScope: "UK FSA",
    expiresAt: Date.now() + 15 * 60 * 1000,
  })),
}));

import { fetchMutation } from "convex/nextjs";
import { POST } from "@/app/api/share/route";
import { takeRateLimit } from "@/lib/security/rate-limit";
import { verifyShareToken } from "@/lib/security/share-token";

const originalNodeEnv = process.env.NODE_ENV;
const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;
const originalServerSecret = process.env.CONVEX_SERVER_SECRET;

function shareRequest(body: string, origin = "http://localhost") {
  return new NextRequest(`${origin}/api/share`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

describe("POST /api/share", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Reflect.set(process.env, "NODE_ENV", "test");
    delete process.env.NEXT_PUBLIC_APP_URL;
    process.env.CONVEX_SERVER_SECRET = "test-only-convex-secret";
    vi.mocked(fetchMutation).mockResolvedValue(undefined as never);
    vi.mocked(takeRateLimit).mockResolvedValue({ allowed: true, limit: 20, remaining: 19, resetAt: new Date() });
    vi.mocked(verifyShareToken).mockReturnValue({
      verdict: "YEET",
      matchLevel: "probable",
      productName: "Official oat recall",
      reason: "This result reflects the official food safety data available at the time of the check.",
      incidentSlug: "official-oat-recall",
      checkedAt: "2026-10-07T12:00:00.000Z",
      datasetRegions: ["UK"],
      sourceScope: "UK FSA",
      expiresAt: Date.now() + 15 * 60 * 1000,
    });
  });

  afterEach(() => {
    if (originalNodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
    else Reflect.set(process.env, "NODE_ENV", originalNodeEnv);
    if (originalAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
    if (originalServerSecret === undefined) delete process.env.CONVEX_SERVER_SECRET;
    else process.env.CONVEX_SERVER_SECRET = originalServerSecret;
  });

  it("persists only approved incident details with a 24-hour public lifetime", async () => {
    const before = Date.now();
    const response = await POST(shareRequest(JSON.stringify({ token: "a".repeat(60) })));
    const after = Date.now();

    expect(response.status).toBe(200);
    const args = vi.mocked(fetchMutation).mock.calls[0]?.[1] as Record<string, unknown>;
    expect(args).toMatchObject({
      productName: "Official oat recall",
      incidentSlug: "official-oat-recall",
      reason: "This result reflects the official food safety data available at the time of the check.",
      checkedAt: new Date("2026-10-07T12:00:00.000Z").getTime(),
      datasetRegions: ["UK"],
      sourceScope: "UK FSA",
    });
    expect(args).not.toHaveProperty("barcode");
    expect(args).not.toHaveProperty("observation");
    expect(args.expiresAt as number).toBeGreaterThanOrEqual(before + 24 * 60 * 60 * 1000);
    expect(args.expiresAt as number).toBeLessThanOrEqual(after + 24 * 60 * 60 * 1000);
    await expect(response.json()).resolves.toMatchObject({ url: expect.stringMatching(/^http:\/\/localhost\/s\//) });
  });

  it("fails closed in production when the public origin is missing, before persisting", async () => {
    Reflect.set(process.env, "NODE_ENV", "production");
    delete process.env.NEXT_PUBLIC_APP_URL;

    const response = await POST(shareRequest(JSON.stringify({ token: "a".repeat(60) })));

    expect(response.status).toBe(503);
    expect(fetchMutation).not.toHaveBeenCalled();
    expect(takeRateLimit).not.toHaveBeenCalled();
  });

  it.each([
    "http://safe.example/",
    "https://user:secret@safe.example/",
    "https://safe.example/?redirect=elsewhere",
    "https://safe.example/#share",
    "https://safe.example/path",
  ])("rejects unsafe production origin configuration: %s", async (configuredOrigin) => {
    Reflect.set(process.env, "NODE_ENV", "production");
    process.env.NEXT_PUBLIC_APP_URL = configuredOrigin;

    const response = await POST(shareRequest(JSON.stringify({ token: "a".repeat(60) })));

    expect(response.status).toBe(503);
    expect(fetchMutation).not.toHaveBeenCalled();
    expect(takeRateLimit).not.toHaveBeenCalled();
  });

  it("uses a configured HTTPS origin even when the request host is malicious", async () => {
    Reflect.set(process.env, "NODE_ENV", "production");
    process.env.NEXT_PUBLIC_APP_URL = "https://safe.example/";

    const response = await POST(shareRequest(JSON.stringify({ token: "a".repeat(60) }), "https://attacker.example"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ url: expect.stringMatching(/^https:\/\/safe\.example\/s\//) });
    expect(fetchMutation).toHaveBeenCalledOnce();
  });

  it("accepts a valid configured HTTPS origin", async () => {
    Reflect.set(process.env, "NODE_ENV", "production");
    process.env.NEXT_PUBLIC_APP_URL = "https://safe.example";

    const response = await POST(shareRequest(JSON.stringify({ token: "a".repeat(60) }), "https://safe.example"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ url: expect.stringMatching(/^https:\/\/safe\.example\/s\//) });
    expect(fetchMutation).toHaveBeenCalledOnce();
  });

  it("returns JSON 503 when public-share persistence fails", async () => {
    vi.mocked(fetchMutation).mockRejectedValueOnce(new Error("Convex unavailable"));

    const response = await POST(shareRequest(JSON.stringify({ token: "a".repeat(60) })));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: expect.any(String) });
  });

  it("bounds share request bodies before token verification", async () => {
    const response = await POST(shareRequest(JSON.stringify({ token: "a".repeat(60), padding: "x".repeat(4 * 1024) })));

    expect(response.status).toBe(413);
    expect(verifyShareToken).not.toHaveBeenCalled();
  });
});
