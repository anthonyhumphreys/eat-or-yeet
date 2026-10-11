import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ dataset: vi.fn() }));
vi.mock("@/db/queries", () => ({ getCheckDataset: mocks.dataset }));

import { getCheckDataset } from "@/db/queries";
import { ReviewShoppingInputSchema } from "@/lib/integrations/shopping/contracts";
import type { ReviewShoppingItem } from "@/lib/integrations/shopping/contracts";
import { reviewShoppingItems } from "@/lib/integrations/shopping/review";
import type { DatasetStatus, MatchableIncident, MatchableTarget } from "@/lib/domain/types";
import { normaliseCode, normaliseGtin, normaliseText } from "@/lib/matching/normalise";
import * as matcher from "@/lib/matching/matcher";

const matcherSpy = vi.spyOn(matcher, "matchIncident");
const checkedAt = "2026-10-08T12:00:00.000Z";

function healthyStatus(region: "UK" | "US"): DatasetStatus {
  return { healthy: true, checkedAt, regions: [region], sources: [] };
}

function target(
  incidentId: string,
  type: MatchableTarget["type"],
  value: string,
  groupId: string | null = null,
): MatchableTarget {
  const valueNormalized = type === "gtin"
    ? normaliseGtin(value)
    : ["batch", "lot", "establishment", "approval", "eggProducerCode"].includes(type)
      ? normaliseCode(value)
      : normaliseText(value);
  return {
    id: `${incidentId}-${type}-${value}`,
    incidentId,
    type,
    value,
    valueNormalized,
    matchType: "exact",
    groupId,
    dateFrom: null,
    dateTo: null,
    notes: null,
    weight: type === "gtin" ? 70 : type === "brand" ? 25 : 35,
    confidence: 1,
  };
}

function incident(
  id: string,
  region: "UK" | "US",
  targets: MatchableTarget[],
  title = "Milk warning",
): MatchableIncident {
  const now = new Date(checkedAt);
  return {
    id,
    title,
    slug: id,
    region,
    hazard: null,
    pathogen: null,
    summary: "Review the package and official notice.",
    consumerAdvice: "Follow the official notice.",
    authority: "Food Authority",
    authorityUrl: "https://example.gov/warning",
    sourceId: "source-id",
    publishedAt: now,
    updatedAt: now,
    severity: "high",
    confidence: 1,
    targets,
  };
}

function shoppingItem(overrides: Partial<ReviewShoppingItem> = {}): ReviewShoppingItem {
  return { id: "row-1", name: "Milk", bought: false, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.dataset.mockResolvedValue({ incidents: [], status: healthyStatus("UK") });
});

describe("shopping review contract", () => {
  it("requires strict, unique, non-empty rows and caps a batch at twenty", () => {
    expect(ReviewShoppingInputSchema.safeParse({ region: "UK", items: [shoppingItem(), { ...shoppingItem(), id: "row-2" }] }).success).toBe(true);
    expect(ReviewShoppingInputSchema.safeParse({ region: "UK", items: [shoppingItem(), shoppingItem({ id: "row-1" })] }).success).toBe(false);
    expect(ReviewShoppingInputSchema.safeParse({ region: "UK", items: [shoppingItem({ name: "   " })] }).success).toBe(false);
    expect(ReviewShoppingInputSchema.safeParse({ region: "UK", items: Array.from({ length: 20 }, (_, i) => shoppingItem({ id: `row-${i}` })) }).success).toBe(true);
    expect(ReviewShoppingInputSchema.safeParse({ region: "UK", items: Array.from({ length: 21 }, (_, i) => shoppingItem({ id: `row-${i}` })) }).success).toBe(false);
    expect(ReviewShoppingInputSchema.safeParse({ region: "UK", items: [shoppingItem({ extra: true } as never)] }).success).toBe(false);
    expect(ReviewShoppingInputSchema.safeParse({
      region: "UK",
      items: [shoppingItem({ barcode: "400638 1333 931" })],
    }).success).toBe(true);
    expect(ReviewShoppingInputSchema.safeParse({
      region: "UK",
      items: [shoppingItem({ barcode: "400638 1333 932" })],
    }).success).toBe(false);
    expect(ReviewShoppingInputSchema.safeParse({
      region: "UK",
      items: [{ id: "row-1", name: "Milk", packet: { batchCode: "LOT-42", dates: { useBy: "2026-10-09" } } }],
    }).success).toBe(true);
    expect(ReviewShoppingInputSchema.safeParse({
      region: "UK",
      items: [{ id: "row-1", name: "Milk", packet: { dates: { useBy: "09/10/2026" } } }],
    }).success).toBe(false);
    expect(ReviewShoppingInputSchema.safeParse({
      region: "UK",
      items: [{ id: "row-1", name: "Milk", packet: { productName: "Milk" } }],
    }).success).toBe(false);
    expect(ReviewShoppingInputSchema.safeParse({
      region: "UK",
      items: [{ id: "row-1", name: "Milk", packet: { batchCode: "LOT-42", allergens: "milk" } }],
    }).success).toBe(false);
  });
});

describe("reviewShoppingItems", () => {
  it("loads current coverage once and keeps UK and US warning sets separate", async () => {
    const ukWarning = incident("uk-milk", "UK", [target("uk-milk", "product", "Milk")]);
    const usWarning = incident("us-milk", "US", [target("us-milk", "product", "Milk")]);
    mocks.dataset.mockImplementation(async (region: "UK" | "US") => ({
      incidents: [ukWarning, usWarning],
      status: healthyStatus(region),
    }));

    const review = await reviewShoppingItems({ region: "UK", items: [shoppingItem()] });

    expect(getCheckDataset).toHaveBeenCalledOnce();
    expect(getCheckDataset).toHaveBeenCalledWith("UK");
    expect(review.items[0]).toMatchObject({ status: "related_warnings", total: 1 });
    expect(review.items[0]?.relatedWarnings.map(({ warning }) => warning.slug)).toEqual(["uk-milk"]);
    expect(review.coverage.region).toBe("UK");
  });

  it("does not confuse a chocolate warning with undeclared milk in its hazard text", async () => {
    const chocolateProduct = incident("chocolate-product", "UK", [
      target("chocolate-product", "product", "Chocolate bar"),
    ], "Chocolate bar recalled for undeclared milk allergen");
    const titleOnly = incident("chocolate-title", "UK", [
      target("chocolate-title", "brand", "Chocolate House"),
    ], "Chocolate recalled due to undeclared milk allergen");
    mocks.dataset.mockResolvedValue({ incidents: [chocolateProduct, titleOnly], status: healthyStatus("UK") });

    const review = await reviewShoppingItems({ region: "UK", items: [shoppingItem()] });

    expect(review.items[0]).toMatchObject({ status: "no_related_warnings", total: 0, relatedWarnings: [] });
  });

  it("classifies the named food, not ingredient-like words in compound foods", async () => {
    const warnings = [
      incident("milk-chocolate", "UK", [target("milk-chocolate", "product", "Milk chocolate")]),
      incident("peanut-butter", "UK", [target("peanut-butter", "product", "Peanut butter")]),
      incident("butter-cookies", "UK", [target("butter-cookies", "product", "Butter cookies")]),
      incident("chocolate-eggs", "UK", [target("chocolate-eggs", "product", "Chocolate eggs")]),
      incident("milk-powder", "UK", [target("milk-powder", "product", "Milk powder")]),
      incident("condensed-milk", "UK", [target("condensed-milk", "product", "Condensed milk")]),
      incident("real-butter", "UK", [target("real-butter", "product", "Butter")]),
      incident("real-eggs", "UK", [target("real-eggs", "product", "Eggs")]),
      incident("chocolate-milk-drink", "UK", [target("chocolate-milk-drink", "product", "Chocolate milk drink")]),
    ];
    mocks.dataset.mockResolvedValue({ incidents: warnings, status: healthyStatus("UK") });

    const review = await reviewShoppingItems({
      region: "UK",
      items: [
        shoppingItem({ id: "milk", name: "Milk" }),
        shoppingItem({ id: "butter", name: "Butter" }),
        shoppingItem({ id: "eggs", name: "Eggs" }),
      ],
    });

    const slugsByRow = Object.fromEntries(review.items.map(({ id, relatedWarnings: related }) =>
      [id, related.map(({ warning }) => warning.slug).sort()],
    ));
    expect(slugsByRow).toEqual({
      milk: ["chocolate-milk-drink", "condensed-milk", "milk-powder"],
      butter: ["real-butter"],
      eggs: ["real-eggs"],
    });
  });

  it("keeps deduplicated reviews separate when normalized names share different food classes", async () => {
    const eggWarning = incident("egg-warning", "UK", [target("egg-warning", "product", "Eggs")]);
    const breadWarning = incident("bread-warning", "UK", [target("bread-warning", "product", "Bread")]);
    mocks.dataset.mockResolvedValue({ incidents: [eggWarning, breadWarning], status: healthyStatus("UK") });

    for (const names of [["Eggwhite bread", "Egg white bread"], ["Egg white bread", "Eggwhite bread"]]) {
      const review = await reviewShoppingItems({
        region: "UK",
        items: names.map((name, index) => shoppingItem({ id: `row-${index}`, name })),
      });
      const slugsByRow = Object.fromEntries(review.items.map(({ id, relatedWarnings }) =>
        [id, relatedWarnings.map(({ warning }) => warning.slug).sort()],
      ));

      expect(slugsByRow).toEqual({
        "row-0": names[0] === "Egg white bread" ? ["bread-warning", "egg-warning"] : ["bread-warning"],
        "row-1": names[1] === "Egg white bread" ? ["bread-warning", "egg-warning"] : ["bread-warning"],
      });
    }
  });

  it("recognizes milk in chocolate milk without treating milk chocolate as milk", async () => {
    const warnings = [
      incident("chocolate-milk", "UK", [target("chocolate-milk", "product", "Chocolate milk")]),
      incident("milk-chocolate", "UK", [target("milk-chocolate", "product", "Milk chocolate")]),
    ];
    mocks.dataset.mockResolvedValue({ incidents: warnings, status: healthyStatus("UK") });

    const review = await reviewShoppingItems({
      region: "UK",
      items: [
        shoppingItem({ id: "milk", name: "Milk" }),
        shoppingItem({ id: "choc-milk", name: "Chocolate milk" }),
      ],
    });

    expect(review.items.map(({ id, relatedWarnings }) => [id, relatedWarnings.map(({ warning }) => warning.slug)])).toEqual([
      ["milk", ["chocolate-milk"]],
      ["choc-milk", ["chocolate-milk"]],
    ]);
  });

  it.each([
    ["eggs", "egg"],
    ["peanut butter", "peanuts"],
    ["tree nuts", "almond"],
    ["butter", "butter"],
    ["cheese", "cheese"],
    ["yoghurt", "yogurt"],
    ["bread", "bread"],
    ["chocolate", "chocolate"],
    ["biscuits", "cookie"],
  ])("recognizes the deterministic product alias %s", async (itemName, targetName) => {
    const warning = incident("alias-warning", "UK", [target("alias-warning", "product", targetName)]);
    mocks.dataset.mockResolvedValue({ incidents: [warning], status: healthyStatus("UK") });

    const review = await reviewShoppingItems({ region: "UK", items: [shoppingItem({ name: itemName })] });

    expect(review.items[0]).toMatchObject({ status: "related_warnings", total: 1 });
  });

  it("keeps brand and barcode evidence within the same source group", async () => {
    const mismatchedGroups = incident("grouped-milk", "UK", [
      target("grouped-milk", "product", "Milk", "product-a"),
      target("grouped-milk", "brand", "Farm House", "brand-b"),
      target("grouped-milk", "gtin", "4006381333931", "barcode-c"),
    ]);
    mocks.dataset.mockResolvedValue({ incidents: [mismatchedGroups], status: healthyStatus("UK") });

    const review = await reviewShoppingItems({
      region: "UK",
      items: [shoppingItem({ brand: "Farm House", barcode: "4006381333931" })],
    });

    expect(review.items[0]).toMatchObject({ status: "no_related_warnings", total: 0 });
  });

  it("marks unsupported terms and unhealthy coverage incomplete, never as a safety verdict", async () => {
    const status = { ...healthyStatus("UK"), healthy: false };
    mocks.dataset.mockResolvedValue({ incidents: [], status });

    const review = await reviewShoppingItems({
      region: "UK",
      items: [shoppingItem({ name: "Spinach" }), shoppingItem({ id: "row-2", name: "Milk" })],
    });

    expect(review.items.map(({ status }) => status)).toEqual(["unable_to_review", "unable_to_review"]);
    expect(review.items.every(({ qualification }) => /incomplete|no safety conclusion/i.test(qualification))).toBe(true);
  });

  it("skips bought rows and computes duplicate normalized items once while preserving row IDs", async () => {
    const milk = incident("milk-warning", "UK", [target("milk-warning", "product", "Milk")]);
    mocks.dataset.mockResolvedValue({ incidents: [milk], status: healthyStatus("UK") });

    const review = await reviewShoppingItems({
      region: "UK",
      items: [
        shoppingItem({ id: "first" }),
        shoppingItem({ id: "second", name: " milk! " }),
        shoppingItem({ id: "bought", bought: true }),
      ],
    });

    expect(review.items.map(({ id, status }) => [id, status])).toEqual([
      ["first", "related_warnings"],
      ["second", "related_warnings"],
      ["bought", "skipped"],
    ]);
    expect(matcherSpy).toHaveBeenCalledOnce();
  });

  it("accepts packet facts for later explicit checks but ignores them during discovery", async () => {
    const milk = incident("milk-warning", "UK", [target("milk-warning", "product", "Milk")]);
    mocks.dataset.mockResolvedValue({ incidents: [milk], status: healthyStatus("UK") });

    const review = await reviewShoppingItems(ReviewShoppingInputSchema.parse({
      region: "UK",
      items: [
        { id: "with-packet", name: "Milk", packet: { batchCode: "LOT-42", retailer: "Market", dates: { useBy: "2026-10-09" } } },
        { id: "without-packet", name: "Milk" },
      ],
    }));
    const { id: firstId, ...withPacket } = review.items[0]!;
    const { id: secondId, ...withoutPacket } = review.items[1]!;

    expect(firstId).toBe("with-packet");
    expect(secondId).toBe("without-packet");
    expect(withPacket).toEqual(withoutPacket);
    expect(matcherSpy).toHaveBeenCalledOnce();
    expect(JSON.stringify(review)).not.toContain("LOT-42");
  });

  it("reads fresh health once for each batch instead of retaining a prior healthy result", async () => {
    const milk = incident("milk-warning", "UK", [target("milk-warning", "product", "Milk")]);
    mocks.dataset
      .mockResolvedValueOnce({ incidents: [milk], status: healthyStatus("UK") })
      .mockResolvedValueOnce({ incidents: [milk], status: { ...healthyStatus("UK"), healthy: false } });

    const first = await reviewShoppingItems({ region: "UK", items: [shoppingItem()] });
    const second = await reviewShoppingItems({ region: "UK", items: [shoppingItem()] });

    expect(first.items[0]?.status).toBe("related_warnings");
    expect(second.items[0]?.status).toBe("unable_to_review");
    expect(getCheckDataset).toHaveBeenCalledTimes(2);
  });

  it("returns at most five warning summaries and gives a search action for omitted warnings", async () => {
    const warnings = Array.from({ length: 7 }, (_, index) => {
      const id = `milk-warning-${index}`;
      return incident(id, "UK", [target(id, "product", "Milk")]);
    });
    mocks.dataset.mockResolvedValue({ incidents: warnings, status: healthyStatus("UK") });

    const review = await reviewShoppingItems({ region: "UK", items: [shoppingItem()] });

    expect(review.items[0]?.relatedWarnings).toHaveLength(5);
    expect(review.items[0]?.total).toBe(7);
    expect(review.items[0]?.nextAction).toEqual({ tool: "search_warnings", region: "UK", query: "Milk" });
  });

  it("bounds relationships per warning and reports when the list is incomplete", async () => {
    const groupedMilk = incident("many-milk-targets", "UK", Array.from({ length: 22 }, (_, index) =>
      target("many-milk-targets", "product", "Milk", `group-${index}`),
    ));
    mocks.dataset.mockResolvedValue({ incidents: [groupedMilk], status: healthyStatus("UK") });

    const review = await reviewShoppingItems({ region: "UK", items: [shoppingItem()] });
    const warning = review.items[0]?.relatedWarnings[0];

    expect(warning?.relationships).toHaveLength(20);
    expect(warning).toMatchObject({ relationshipCount: 22, relationshipsComplete: false });
  });
});
