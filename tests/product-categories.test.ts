import { afterEach, describe, expect, it, vi } from "vitest";

import { internal } from "@backend/api";
import { createBackend } from "./backend-harness";

const notice = (overrides: Record<string, unknown> = {}) => ({
  title: "Maker recalls Heatwave Mix because of undeclared milk", slug: "heatwave", authority: "Test authority", authorityUrl: "https://example.test/recall",
  sourceId: "recall-1", sourceKey: "fsa", region: "UK" as const, status: "active" as const,
  summary: "Check the pack", consumerAdvice: "Do not eat", startsAt: 1, publishedAt: 1, updatedAt: 1,
  retrievedAt: 1, severity: "high" as const, confidence: 1, isDemo: false, originalSourceData: {},
  targets: [
    { type: "product" as const, value: "Heatwave Mix", valueNormalized: "heatwavemix", matchType: "exact" as const, confidence: 1, weight: 38, groupId: "p0" },
    { type: "gtin" as const, value: "5000328657950", valueNormalized: "05000328657950", matchType: "exact" as const, confidence: 1, weight: 75, groupId: "p0" },
  ],
  ...overrides,
});

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("product category cache", () => {
  it("looks up due barcodes from Open Food Facts and stores only the useful tags", async () => {
    const t = createBackend();
    const gtin = "05000328657950";
    await t.mutation(internal.products.queueCategoryLookups, { items: [{ gtin, due: -1 }] });
    const realFetch = globalThis.fetch;
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ status: 1, product: { categories_tags: ["en:snacks", "en:crisps"] } }), { status: 200 }));
    globalThis.fetch = fetcher as unknown as typeof fetch;
    try {
      expect(await t.action(internal.products.lookupProductCategories, {})).toEqual({ checked: 1 });
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(String((fetcher.mock.calls[0] as unknown[])[0])).toContain("/product/5000328657950.json");
    expect(await t.query(internal.products.getCategoryTags, { gtins: [gtin] })).toEqual([{ gtin, tags: ["en:snacks"] }]);
  });

  it("can be switched off", async () => {
    vi.stubEnv("PRODUCT_CATEGORY_LOOKUPS", "false");
    const t = createBackend();
    await t.mutation(internal.products.queueCategoryLookups, { items: [{ gtin: "05000328657950", due: -1 }] });
    expect(await t.action(internal.products.lookupProductCategories, {})).toEqual({ checked: 0 });
  });

  it("queues each unseen barcode once and hands out the newest notices first", async () => {
    const t = createBackend();
    await t.mutation(internal.products.queueCategoryLookups, { items: [{ gtin: "00000000000001", due: -100 }, { gtin: "00000000000002", due: -900 }] });
    await t.mutation(internal.products.queueCategoryLookups, { items: [{ gtin: "00000000000001", due: -5 }] });
    expect(await t.query(internal.products.dueCategoryLookups, { now: 0, limit: 10 })).toEqual(["00000000000002", "00000000000001"]);
    const rows = await t.run((ctx) => ctx.db.query("productCategoryCache").collect());
    expect(rows).toHaveLength(2);
  });

  it("saves answers and keeps the last answer when a recheck fails", async () => {
    const t = createBackend();
    const gtin = "05000328657950";
    await t.mutation(internal.products.queueCategoryLookups, { items: [{ gtin, due: -1 }] });
    await t.mutation(internal.products.saveCategoryLookup, { gtin, result: { status: "found", tags: ["en:snacks"] }, due: 1_000, checkedAt: 10 });
    await t.mutation(internal.products.saveCategoryLookup, { gtin, result: null, due: 2_000, checkedAt: 20 });
    expect(await t.query(internal.products.getCategoryTags, { gtins: [gtin, "00000000000009"] })).toEqual([{ gtin, tags: ["en:snacks"] }]);
    const row = await t.run((ctx) => ctx.db.query("productCategoryCache").unique());
    expect(row).toMatchObject({ status: "found", due: 2_000, checkedAt: 10 });
    expect(await t.query(internal.products.dueCategoryLookups, { now: 1_500, limit: 10 })).toEqual([]);
  });

  it("uses attached Open Food Facts tags for the browse food type", async () => {
    const t = createBackend();
    await t.mutation(internal.incidents.upsertBatch, { items: [notice({ productCategoryTags: { "05000328657950": ["en:snacks"] } })] });
    const projection = await t.run((ctx) => ctx.db.query("incidentMatchData").unique());
    expect(projection?.categories).toEqual(["Snacks & sweets"]);
  });

  it("falls back to name rules and adds extra tags without attached tags", async () => {
    const t = createBackend();
    await t.mutation(internal.incidents.upsertBatch, { items: [notice({
      title: "Royal Honey VIP recalled because of undeclared tadalafil",
      targets: [{ type: "product" as const, value: "Royal Honey VIP", valueNormalized: "royalhoneyvip", matchType: "exact" as const, confidence: 1, weight: 38 }],
    })] });
    const projection = await t.run((ctx) => ctx.db.query("incidentMatchData").unique());
    expect(projection?.categories).toEqual(["Pantry", "Pharmaceutical"]);
  });
});
