import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("convex/nextjs", () => ({ fetchMutation: vi.fn() }));

import { fetchMutation } from "convex/nextjs";

import { api } from "@convex/_generated/api";
import { takeRateLimits } from "@/lib/security/rate-limit";
import { takeIntegrationRateLimits } from "@/lib/security/integration-rate-limit";
import { createBackend } from "./convex-harness";

const originalNodeEnv = process.env.NODE_ENV;
const originalSalt = process.env.RATE_LIMIT_SALT;
const originalConvexSecret = process.env.CONVEX_SERVER_SECRET;
const secret = "test-convex-secret";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-03-04T23:30:00.000Z"));
  Reflect.set(process.env, "NODE_ENV", "test");
  process.env.RATE_LIMIT_SALT = "test-integration-rate-limit-salt";
  process.env.CONVEX_SERVER_SECRET = secret;
  vi.mocked(fetchMutation).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  if (originalNodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
  else Reflect.set(process.env, "NODE_ENV", originalNodeEnv);
  if (originalSalt === undefined) delete process.env.RATE_LIMIT_SALT;
  else process.env.RATE_LIMIT_SALT = originalSalt;
  if (originalConvexSecret === undefined) delete process.env.CONVEX_SERVER_SECRET;
  else process.env.CONVEX_SERVER_SECRET = originalConvexSecret;
});

describe("integration rate limits", () => {
  it("consumes network and global units with one namespaced mutation", async () => {
    vi.mocked(fetchMutation).mockResolvedValueOnce([9, 31] as never);

    const result = await takeIntegrationRateLimits("network:ipv4:198.51.100.17", "mcp_browse", 4);

    expect(fetchMutation).toHaveBeenCalledOnce();
    expect(result).toEqual([
      { scope: "network", allowed: true, limit: 900, remaining: 891, resetAt: new Date("2026-03-05T00:00:00.000Z") },
      { scope: "global", allowed: true, limit: 3_000, remaining: 2_969, resetAt: new Date("2026-03-05T00:00:00.000Z") },
    ]);

    const args = vi.mocked(fetchMutation).mock.calls[0]?.[1] as {
      buckets: Array<{ key: string; subjectHash: string; action: string; windowStartedAt: number; expiresAt: number; cost: number; limit: number }>;
    };
    expect(args.buckets).toHaveLength(2);
    expect(args.buckets.map(({ action, cost }) => ({ action, cost }))).toEqual([
      { action: "mcp_browse", cost: 4 },
      { action: "mcp_browse", cost: 4 },
    ]);
    expect(args.buckets.map(({ limit }) => limit)).toEqual([900, 3_000]);
    expect(args.buckets[0]?.key).toMatch(/^integration:[0-9a-f]{64}:mcp_browse:network:/);
    expect(args.buckets[1]?.key).toMatch(/^integration:[0-9a-f]{64}:mcp_browse:global:/);
    expect(args.buckets.every(({ key }) => !key.includes("198.51.100.17"))).toBe(true);
    expect(args.buckets[0]?.subjectHash).not.toBe(args.buckets[1]?.subjectHash);
    expect(args.buckets[0]).toMatchObject({
      windowStartedAt: Date.parse("2026-03-04T23:00:00.000Z"),
      expiresAt: Date.parse("2026-03-05T01:00:00.000Z"),
    });
    expect(args.buckets[1]).toMatchObject({
      windowStartedAt: Date.parse("2026-03-04T00:00:00.000Z"),
      expiresAt: Date.parse("2026-03-06T00:00:00.000Z"),
    });
  });

  it("uses UTC day windows and keeps website hourly keys and increments unchanged", async () => {
    vi.mocked(fetchMutation).mockResolvedValueOnce([1] as never);
    vi.mocked(fetchMutation).mockResolvedValueOnce([1, 1] as never);
    await takeRateLimits([{ subject: "website-subject", scope: "network" }], "check");
    await takeIntegrationRateLimits("network:ipv4:198.51.100.17", "mcp_check");

    const calls = vi.mocked(fetchMutation).mock.calls;
    expect(calls).toHaveLength(2);
    const websiteBuckets = (calls[0]?.[1] as { buckets: Array<{ key: string; action: string; windowStartedAt: number; expiresAt: number }> }).buckets;
    const integrationBuckets = (calls[1]?.[1] as { buckets: Array<{ key: string; action: string; windowStartedAt: number }> }).buckets;
    expect(websiteBuckets[0]).toMatchObject({
      action: "check",
      windowStartedAt: Date.parse("2026-03-04T23:00:00.000Z"),
      expiresAt: Date.parse("2026-03-05T01:00:00.000Z"),
    });
    expect(websiteBuckets[0]?.key).toMatch(/:network:check:\d+$/);
    expect(integrationBuckets.map(({ action, windowStartedAt }) => ({ action, windowStartedAt }))).toEqual([
      { action: "mcp_check", windowStartedAt: Date.parse("2026-03-04T23:00:00.000Z") },
      { action: "mcp_check", windowStartedAt: Date.parse("2026-03-04T00:00:00.000Z") },
    ]);

    vi.setSystemTime(new Date("2026-03-05T00:00:00.000Z"));
    vi.mocked(fetchMutation).mockResolvedValueOnce([1, 1] as never);
    await takeIntegrationRateLimits("network:ipv4:198.51.100.17", "mcp_check");
    const nextBuckets = (vi.mocked(fetchMutation).mock.calls[2]?.[1] as { buckets: Array<{ key: string }> }).buckets;
    expect(nextBuckets[0]?.key).not.toBe(integrationBuckets[0]?.key);
    expect(nextBuckets[1]?.key).not.toBe(integrationBuckets[1]?.key);
  });

  it("fails closed on invalid units or datastore counts", async () => {
    await expect(takeIntegrationRateLimits("trusted-network", "mcp_check", 0)).rejects.toThrow("units must be an integer");
    expect(fetchMutation).not.toHaveBeenCalled();

    vi.mocked(fetchMutation).mockResolvedValueOnce([1, 0] as never);
    await expect(takeIntegrationRateLimits("trusted-network", "mcp_check")).rejects.toThrow("invalid counts");
    expect(fetchMutation).toHaveBeenCalledOnce();
  });

  it("maps a denied network bucket to its own result scope", async () => {
    vi.mocked(fetchMutation).mockResolvedValueOnce([301, 100] as never);

    await expect(takeIntegrationRateLimits("trusted-network", "mcp_check")).resolves.toMatchObject([
      { scope: "network", allowed: false, limit: 300, remaining: 0 },
      { scope: "global", allowed: true, limit: 1_000, remaining: 900 },
    ]);
  });

  it("shares the private hourly network and daily global/connection quotas across tool actions", async () => {
    vi.mocked(fetchMutation).mockResolvedValueOnce([5, 20, 7] as never);
    const connection = { id: "notion-shopping", dailyLimit: 40 };
    const result = await takeIntegrationRateLimits("network:ipv4:198.51.100.17", "mcp_browse", 3, connection);

    expect(result).toEqual([
      { scope: "network", allowed: true, limit: 300, remaining: 295, resetAt: new Date("2026-03-05T00:00:00.000Z") },
      { scope: "global", allowed: true, limit: 1_000, remaining: 980, resetAt: new Date("2026-03-05T00:00:00.000Z") },
      { scope: "connection", allowed: true, limit: 40, remaining: 33, resetAt: new Date("2026-03-05T00:00:00.000Z") },
    ]);
    const buckets = (vi.mocked(fetchMutation).mock.calls[0]?.[1] as { buckets: Array<{ key: string; action: string; cost: number; limit: number; windowStartedAt: number }> }).buckets;
    expect(buckets).toHaveLength(3);
    expect(buckets.every(({ action, cost }) => action === "mcp_shopping" && cost === 3)).toBe(true);
    expect(buckets.map(({ limit }) => limit)).toEqual([300, 1_000, 40]);
    expect(buckets.map(({ windowStartedAt }) => windowStartedAt)).toEqual([
      Date.parse("2026-03-04T23:00:00.000Z"), Date.parse("2026-03-04T00:00:00.000Z"), Date.parse("2026-03-04T00:00:00.000Z"),
    ]);
    expect(buckets[0]?.key).toMatch(/^integration:[0-9a-f]{64}:mcp_shopping:network:\d+$/);
    expect(buckets[2]?.key).toMatch(/^integration:[0-9a-f]{64}:mcp_shopping:connection:/);
    expect(buckets[2]?.key).not.toContain(connection.id);
  });

  it("atomically increments backend buckets by each validated cost", async () => {
    const t = createBackend();
    const buckets = [
      { key: "integration:network:mcp_check:hour", subjectHash: "network-hash", action: "mcp_check" as const, windowStartedAt: 1_000, expiresAt: 7_201_000, cost: 3 },
      { key: "integration:global:mcp_check:day", subjectHash: "global-hash", action: "mcp_check" as const, windowStartedAt: 1_000, expiresAt: 172_801_000, cost: 5 },
    ];

    await expect(t.mutation(api.rateLimits.takeMany, { secret, buckets })).resolves.toEqual([3, 5]);
    await expect(t.mutation(api.rateLimits.takeMany, { secret, buckets })).resolves.toEqual([6, 10]);
    const rows = await t.run((ctx) => ctx.db.query("rateLimits").collect());
    expect(rows.map(({ count }) => count).sort((a, b) => a - b)).toEqual([6, 10]);

    await expect(t.mutation(api.rateLimits.takeMany, {
      secret,
      buckets: [{ ...buckets[0]!, key: "integration:invalid-cost", cost: 1.5 }],
    })).rejects.toThrow("cost must be an integer");
  });

  it("does not write any private quota bucket when one limit is exceeded", async () => {
    const t = createBackend();
    const buckets = [
      { key: "integration:network:mcp_shopping:network:day", subjectHash: "network-hash", action: "mcp_shopping" as const, windowStartedAt: 1_000, expiresAt: 172_801_000, cost: 2, limit: 10 },
      { key: "integration:global:mcp_shopping:global:day", subjectHash: "global-hash", action: "mcp_shopping" as const, windowStartedAt: 1_000, expiresAt: 172_801_000, cost: 2, limit: 10 },
      { key: "integration:connection:mcp_shopping:connection:day", subjectHash: "connection-hash", action: "mcp_shopping" as const, windowStartedAt: 1_000, expiresAt: 172_801_000, cost: 2, limit: 1 },
    ];

    await expect(t.mutation(api.rateLimits.takeMany, { secret, buckets })).resolves.toEqual([2, 2, 2]);
    const rows = await t.run((ctx) => ctx.db.query("rateLimits").collect());
    expect(rows).toHaveLength(0);
  });
});
