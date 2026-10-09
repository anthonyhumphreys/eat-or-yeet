import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@convex/_generated/api";
import { createBackend } from "./convex-harness";

const secret = "integration-quota-test-secret";

beforeEach(() => {
  vi.stubEnv("CONVEX_SERVER_SECRET", secret);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function integrationBucket(key: string, subjectHash: string, limit: number, cost = 1) {
  return {
    key,
    subjectHash,
    action: "mcp_check" as const,
    windowStartedAt: 1_000,
    expiresAt: 7_201_000,
    cost,
    limit,
  };
}

function storedBucket(bucket: ReturnType<typeof integrationBucket>, count: number) {
  const { key, subjectHash, action, windowStartedAt, expiresAt } = bucket;
  return { key, subjectHash, action, windowStartedAt, expiresAt, count };
}

describe("atomic integration quota admission", () => {
  it("does not charge global units when one network is over cap, then admits another network", async () => {
    const t = createBackend();
    const networkA = integrationBucket("integration:network-a", "network-a", 3, 2);
    const networkB = integrationBucket("integration:network-b", "network-b", 3, 2);
    const global = integrationBucket("integration:global", "global", 100, 2);

    await t.run(async (ctx) => {
      await ctx.db.insert("rateLimits", storedBucket(networkA, 3));
      await ctx.db.insert("rateLimits", storedBucket(global, 10));
    });

    await expect(t.mutation(api.rateLimits.takeMany, {
      secret,
      buckets: [networkA, global],
    })).resolves.toEqual([5, 12]);
    let rows = await t.run((ctx) => ctx.db.query("rateLimits").collect());
    expect(rows.map(({ key, count }) => ({ key, count }))).toEqual([
      { key: networkA.key, count: 3 },
      { key: global.key, count: 10 },
    ]);

    await expect(t.mutation(api.rateLimits.takeMany, {
      secret,
      buckets: [networkB, global],
    })).resolves.toEqual([2, 12]);
    rows = await t.run((ctx) => ctx.db.query("rateLimits").collect());
    expect(rows.map(({ key, count }) => ({ key, count })).sort((a, b) => a.key.localeCompare(b.key))).toEqual([
      { key: global.key, count: 12 },
      { key: networkA.key, count: 3 },
      { key: networkB.key, count: 2 },
    ]);
  });

  it("does not charge the network bucket when the shared global cap is reached", async () => {
    const t = createBackend();
    const network = integrationBucket("integration:network", "network", 10, 2);
    const global = integrationBucket("integration:global", "global", 5, 2);

    await t.run((ctx) => ctx.db.insert("rateLimits", storedBucket(global, 5)));

    await expect(t.mutation(api.rateLimits.takeMany, {
      secret,
      buckets: [network, global],
    })).resolves.toEqual([2, 7]);

    const rows = await t.run((ctx) => ctx.db.query("rateLimits").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: global.key, count: 5 });
  });

  it("fails closed on invalid stored counts and rejects duplicate limited keys", async () => {
    const t = createBackend();
    const corrupt = integrationBucket("integration:corrupt", "corrupt", 10);
    await t.run((ctx) => ctx.db.insert("rateLimits", storedBucket(corrupt, 1.5)));

    await expect(t.mutation(api.rateLimits.takeMany, {
      secret,
      buckets: [corrupt],
    })).rejects.toThrow("invalid count");

    await expect(t.mutation(api.rateLimits.takeMany, {
      secret,
      buckets: [integrationBucket("integration:duplicate", "duplicate", 10), integrationBucket("integration:duplicate", "duplicate", 10)],
    })).rejects.toThrow("duplicate bucket keys");
  });
});
