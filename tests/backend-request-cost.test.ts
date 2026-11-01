import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "@backend/values";
import { api, internal } from "@backend/api";
import { createBackend } from "./backend-harness";

const serverSecret = "test-backend-secret";

beforeEach(() => {
  vi.stubEnv("BACKEND_SECRET", serverSecret);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("combined backend request queries and mutations", () => {
  it("recovers all official risk statements from archived FSA and FSIS records", async () => {
    for (const originalSourceData of [
      { problem: [{ riskStatement: "Undeclared milk and egg. " + "Source context. ".repeat(50) + "Sesame allergen" }, { riskStatement: "Mustard allergen" }] },
      { field_recall_reason: ["Undeclared milk and egg", "Source context. ".repeat(50) + "Sesame and mustard allergens"] },
    ]) {
      const t = createBackend();
      await t.run(ctx => ctx.db.insert("incidents", {
        title: "Various products recalled", slug: "various-products", region: "UK", status: "active", startsAt: 0, isDemo: false,
        hazard: "Undeclared milk and egg", summary: "Check the pack", consumerAdvice: "Return it", authority: "Food Standards Agency",
        authorityUrl: "https://alerts.food.gov.uk/", sourceId: "test", publishedAt: 1, updatedAt: 1, retrievedAt: 1,
        severity: "medium", confidence: 1, targets: [], originalSourceData,
      }));
      await t.action(internal.incidents.backfillMatchDataInternal, {});
      const { page } = await t.query(api.incidents.listActivePage, { region: "UK", cursor: null });
      expect(page[0].searchText).toContain("sesame");
      expect(page[0].searchText).toContain("mustard");
      expect(page[0].browseHazard).toMatchObject({ kind: "allergen", label: "Milk, egg, sesame +1 more" });
      expect(page[0]).not.toHaveProperty("originalSourceData");
    }
  });

  it("projects complete hazard and affected product names without exposing raw payloads", async () => {
    const t = createBackend();
    await t.run((ctx) => ctx.db.insert("incidentMatchData", {
      incidentId: "incidents:test" as Id<"incidents">, title: "Various products recalled", slug: "various-products", region: "UK", status: "active",
      startsAt: 0, isDemo: false, hazard: "Undeclared milk and egg. " + "Additional source detail. ".repeat(30) + "Sesame allergen",
      summary: "Check the pack", consumerAdvice: "Return it", authority: "Food Standards Agency", authorityUrl: "https://alerts.food.gov.uk/",
      sourceId: "test", publishedAt: 1, updatedAt: 1, severity: "medium", confidence: 1,
      categories: ["Snacks & sweets"], stores: [], targets: [
        { type: "product", value: "Sesame crunch", valueNormalized: "sesamecrunch", matchType: "exact", weight: 25, confidence: 1 },
        { type: "brand", value: "Northstar", valueNormalized: "northstar", matchType: "exact", weight: 25, confidence: 1 },
      ],
    }));
    const { page } = await t.query(api.incidents.listActivePage, { region: "UK", cursor: null });
    expect(page[0].searchText).toContain("sesameallergen");
    expect(page[0].searchText).toContain("sesamecrunch");
    expect(page[0].searchText).toContain("northstar");
    expect(page[0].hazard).toHaveLength(400);
    expect(page[0]).not.toHaveProperty("targets");
    expect(page[0]).not.toHaveProperty("originalSourceData");
  });

  it("guards public pages against dataset changes in the same query transaction", async () => {
    const t = createBackend();
    const version = await t.query(api.incidents.getDatasetVersion, { region: "UK" });
    await expect(t.query(api.incidents.listActivePage, { region: "UK", cursor: null, snapshot: true, expectedVersion: version })).resolves.toMatchObject({ page: [], isDone: true });
    await t.run((ctx) => ctx.db.insert("datasetVersions", { region: "UK", revision: 1 }));
    await expect(t.query(api.incidents.listActivePage, { region: "UK", cursor: null, snapshot: true, expectedVersion: version })).rejects.toThrow("DATASET_REVISION_CHANGED");
    // Older deployed callers remain compatible until the frontend rollout.
    await expect(t.query(api.incidents.listActivePage, { region: "UK", cursor: null })).resolves.toMatchObject({ page: [] });
  });
  it("uses local product data first and preserves cached unknown and expiry behavior", async () => {
    const t = createBackend();
    await t.run(async (ctx) => {
      await ctx.db.insert("products", {
        gtin: "0004006381333931", name: "Curated name", brand: "Curated brand", metadata: {}, updatedAt: Date.now(),
      });
      await ctx.db.insert("productMetadataCache", {
        gtin: "0004006381333931", source: "open-food-facts", metadata: { product_name: "Stale fallback" },
        expiresAt: Date.now() + 60_000, updatedAt: Date.now(),
      });
      await ctx.db.insert("productMetadataCache", {
        gtin: "0004006381333932", source: "open-food-facts", metadata: null,
        expiresAt: Date.now() + 60_000, updatedAt: Date.now(),
      });
      await ctx.db.insert("productMetadataCache", {
        gtin: "0004006381333933", source: "open-food-facts", metadata: { product_name: "Expired" },
        expiresAt: Date.now() - 1, updatedAt: Date.now(),
      });
    });

    await expect(t.query(api.products.lookupByGtin, { gtin: "0004006381333931" })).resolves.toMatchObject({
      product: { name: "Curated name" }, metadata: null,
    });
    await expect(t.query(api.products.lookupByGtin, { gtin: "0004006381333932" })).resolves.toMatchObject({
      product: null, metadata: { metadata: null },
    });
    await expect(t.query(api.products.lookupByGtin, { gtin: "0004006381333933" })).resolves.toEqual({
      product: null, metadata: null,
    });
    await expect(t.query(api.products.lookupByGtin, { gtin: "0004006381333934" })).resolves.toEqual({
      product: null, metadata: null,
    });
  });

  it("increments anonymous and network buckets atomically and shares counters with the old endpoint", async () => {
    const t = createBackend();
    const buckets = [
      { key: "anonymous:check:hour", subjectHash: "anon-hash", action: "check" as const, windowStartedAt: 1_000, expiresAt: 7_201_000 },
      { key: "network:check:hour", subjectHash: "network-hash", action: "check" as const, windowStartedAt: 1_000, expiresAt: 7_201_000 },
    ];

    await expect(t.mutation(api.rateLimits.takeMany, { secret: serverSecret, buckets })).resolves.toEqual([1, 1]);
    await expect(t.mutation(api.rateLimits.takeMany, { secret: serverSecret, buckets })).resolves.toEqual([2, 2]);
    await expect(t.mutation(api.rateLimits.take, {
      secret: serverSecret, ...buckets[0],
    })).resolves.toBe(3);

    const rows = await t.run((ctx) => ctx.db.query("rateLimits").collect());
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.key === buckets[0].key)?.count).toBe(3);
    expect(rows.find((row) => row.key === buckets[1].key)?.count).toBe(2);
    await expect(t.mutation(api.rateLimits.takeMany, { secret: "wrong-secret", buckets })).rejects.toThrow("Unauthorized");
  });

  it("creates a fresh bucket through the old endpoint without persisting its secret argument", async () => {
    const t = createBackend();
    const bucket = {
      key: "legacy:fresh:bucket", subjectHash: "legacy-hash", action: "share" as const,
      windowStartedAt: 1_000, expiresAt: 7_201_000,
    };

    await expect(t.mutation(api.rateLimits.take, { secret: serverSecret, ...bucket })).resolves.toBe(1);

    const rows = await t.run((ctx) => ctx.db.query("rateLimits").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ...bucket, count: 1 });
    expect(rows[0]).not.toHaveProperty("secret");
  });

  it("rolls back earlier bucket updates if a later bucket operation fails", async () => {
    const t = createBackend();
    const first = { key: "valid:first", subjectHash: "first", action: "check" as const, windowStartedAt: 1, expiresAt: 2 };
    const duplicate = { key: "duplicate:later", subjectHash: "dup", action: "check" as const, windowStartedAt: 1, expiresAt: 2 };
    await t.run(async (ctx) => {
      await ctx.db.insert("rateLimits", { ...first, count: 4 });
      await ctx.db.insert("rateLimits", { ...duplicate, count: 2 });
      await ctx.db.insert("rateLimits", { ...duplicate, subjectHash: "dup-second", count: 7 });
    });

    await expect(t.mutation(api.rateLimits.takeMany, { secret: serverSecret, buckets: [first, duplicate] })).rejects.toThrow();

    const rows = await t.run((ctx) => ctx.db.query("rateLimits").collect());
    expect(rows.find((row) => row.key === first.key)?.count).toBe(4);
    expect(rows.filter((row) => row.key === duplicate.key).map((row) => row.count).sort()).toEqual([2, 7]);
  });
});
