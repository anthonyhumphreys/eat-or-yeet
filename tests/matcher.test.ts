import { describe, expect, it } from "vitest";

import { ProductObservationSchema, emptyObservation } from "@/lib/domain/schemas";
import type { DatasetStatus, MatchableIncident, MatchableTarget } from "@/lib/domain/types";
import { isValidGtin } from "@/lib/domain/gtin";
import { normaliseCode, normaliseGtin, normaliseText } from "@/lib/matching/normalise";
import { matchIncident, runMatcher } from "@/lib/matching/matcher";

function target(
  type: MatchableTarget["type"],
  value: string,
  weight: number,
  options: Partial<Pick<MatchableTarget, "groupId" | "dateFrom" | "dateTo" | "notes">> = {},
): MatchableTarget {
  const valueNormalized =
    type === "gtin"
      ? normaliseGtin(value)
      : ["batch", "lot", "establishment", "approval", "eggProducerCode"].includes(type)
        ? normaliseCode(value)
        : normaliseText(value);

  return {
    id: `${type}-${value}`,
    incidentId: "incident",
    type,
    value,
    valueNormalized,
    matchType: "exact",
    groupId: null,
    dateFrom: null,
    dateTo: null,
    notes: null,
    weight,
    confidence: 1,
    ...options,
  };
}

function incident(targets: MatchableTarget[]): MatchableIncident {
  const now = new Date();
  return {
    id: "incident",
    title: "Test recall",
    slug: "test-recall",
    region: "UK",
    hazard: "Test hazard",
    pathogen: null,
    summary: "Test summary",
    consumerAdvice: "Do not eat it.",
    authority: "Test authority",
    authorityUrl: "https://example.gov",
    sourceId: "TEST-1",
    publishedAt: now,
    updatedAt: now,
    severity: "high",
    confidence: 1,
    targets,
  };
}

const healthyStatus: DatasetStatus = {
  healthy: true,
  checkedAt: "2026-10-07T12:00:00.000Z",
  regions: ["UK"],
  sources: [],
};

describe("barcode validation", () => {
  it("accepts empty barcodes and valid GTIN lengths with a matching checksum", () => {
    expect(ProductObservationSchema.safeParse({ ...emptyObservation(), barcode: "" }).success).toBe(true);
    expect(ProductObservationSchema.safeParse({ ...emptyObservation(), barcode: null }).success).toBe(true);
    expect(isValidGtin("96385074")).toBe(true);
    expect(isValidGtin("5000000000005")).toBe(true);
    expect(isValidGtin("05000000000005")).toBe(true);
    expect(isValidGtin("00000000000000")).toBe(true);
  });

  it("rejects unsupported lengths, bad checksums, and non-digit identifiers", () => {
    expect(ProductObservationSchema.safeParse({ ...emptyObservation(), barcode: "123" }).success).toBe(false);
    expect(ProductObservationSchema.safeParse({ ...emptyObservation(), barcode: "5000000000006" }).success).toBe(false);
    expect(ProductObservationSchema.safeParse({ ...emptyObservation(), barcode: "abc 5000000000005" }).success).toBe(false);
  });
});

describe("deterministic matcher", () => {
  it("returns confirmed YEET for an associated exact barcode and batch", () => {
    const batchObservation = {
      ...emptyObservation(),
      barcode: "5000000000005",
      batchCode: "24 182",
      productName: "Lentils",
    };
    const result = runMatcher(
      batchObservation,
      [
        incident([
          target("gtin", "5000000000005", 70, { groupId: "tin-a" }),
          target("batch", "24182", 60, { groupId: "tin-a" }),
        ]),
      ],
      ["UK"],
    );
    expect(result.verdict).toBe("YEET");
    expect(result.matchLevel).toBe("confirmed");
    expect(result.matches[0].reasons).toHaveLength(2);
  });

  it("does not combine a product identity with a lot from another target group", () => {
    const result = runMatcher(
      { ...emptyObservation(), productName: "Chicken curry", lotCode: "LOT123" },
      [
        incident([
          target("product", "Chicken curry", 35, { groupId: "meal-a" }),
          target("lot", "LOT123", 60, { groupId: "meal-b" }),
        ]),
      ],
      ["UK"],
    );

    expect(result.verdict).toBe("MAYBE_YEET");
    expect(result.matchLevel).toBe("possible");
  });

  it("does not keep a barcode match probable when its grouped batch does not match", () => {
    const result = runMatcher(
      { ...emptyObservation(), productName: "Lentils", barcode: "5000000000005", batchCode: "OTHER7" },
      [
        incident([
          target("gtin", "5000000000005", 70, { groupId: "tin-a" }),
          target("product", "Lentils", 35, { groupId: "tin-a" }),
          target("batch", "AFFECTED7", 60, { groupId: "tin-a" }),
        ]),
      ],
      ["UK"],
    );

    expect(result.verdict).toBe("MAYBE_YEET");
    expect(result.matchLevel).toBe("possible");
  });

  it("does not confirm a grouped batch match when its required date is missing", () => {
    const result = runMatcher(
      { ...emptyObservation(), productName: "Chicken curry", batchCode: "BATCH7" },
      [
        incident([
          target("product", "Chicken curry", 35, { groupId: "meal-a" }),
          target("batch", "BATCH7", 60, {
            groupId: "meal-a",
            dateFrom: new Date("2026-01-01T00:00:00.000Z"),
            dateTo: new Date("2026-01-31T23:59:59.999Z"),
          }),
        ]),
      ],
      ["UK"],
    );

    expect(result.verdict).toBe("MAYBE_YEET");
    expect(result.matchLevel).toBe("possible");
    expect(result.matches[0].reasons.at(-1)?.type).toBe("date");
  });

  it("treats contradictory visible dates as ambiguous", () => {
    const match = matchIncident(
      {
        ...emptyObservation(),
        productName: "Chicken curry",
        dates: {
          useBy: "2026-01-15",
          bestBefore: "2026-03-15",
          productionDate: null,
        },
      },
      incident([
        target("product", "Chicken curry", 35, {
          dateFrom: new Date("2026-01-01T00:00:00.000Z"),
          dateTo: new Date("2026-01-31T23:59:59.999Z"),
        }),
      ]),
    );

    expect(match?.level).toBe("possible");
    expect(match?.reasons.at(-1)?.evidence).toBe("Date not supplied or ambiguous");
  });

  it("treats invalid calendar dates as ambiguous instead of rolling them forward", () => {
    const match = matchIncident(
      {
        ...emptyObservation(),
        productName: "Chicken curry",
        dates: { useBy: "2026-02-30", bestBefore: null, productionDate: null },
      },
      incident([
        target("product", "Chicken curry", 35, {
          dateFrom: new Date("2026-02-01T00:00:00.000Z"),
          dateTo: new Date("2026-02-28T23:59:59.999Z"),
        }),
      ]),
    );

    expect(match?.level).toBe("possible");
    expect(match?.reasons.at(-1)?.type).toBe("date");
  });

  it("keeps source date restrictions in prose unresolved until they can be compared", () => {
    const match = matchIncident(
      { ...emptyObservation(), productName: "Chicken curry" },
      incident([
        target("product", "Chicken curry", 35, {
          notes: "Affected date information: best before 31/10/2026",
        }),
      ]),
    );

    expect(match?.level).toBe("possible");
    expect(match?.reasons.at(-1)?.evidence).toBe("Date restriction needs review");
  });

  it("matches a shortened product name after a known retailer prefix", () => {
    const result = runMatcher(
      { ...emptyObservation(), productName: "Free Range Chicken Breast" },
      [incident([target("product", "Tesco Finest Free Range Chicken Breast", 35)])],
      ["UK"],
    );

    expect(result.verdict).toBe("MAYBE_YEET");
    expect(result.matches[0].reasons[0].evidence).toBe("Free Range Chicken Breast");
  });

  it("matches a specific contiguous product phrase inside a longer name", () => {
    const result = runMatcher(
      { ...emptyObservation(), productName: "Turkey Bacon" },
      [incident([target("product", "Oscar Mayer Turkey Bacon 12 oz", 35)])],
      ["US"],
    );

    expect(result.verdict).toBe("MAYBE_YEET");
    expect(result.matchLevel).toBe("possible");
    expect(result.matches).toHaveLength(1);
  });

  it("does not let a partial product phrase and exact lot combine into confirmation", () => {
    const result = runMatcher(
      { ...emptyObservation(), productName: "Turkey Bacon", lotCode: "TB-204" },
      [
        incident([
          target("product", "Oscar Mayer Turkey Bacon 12 oz", 35, { groupId: "pack-a" }),
          target("lot", "TB-204", 60, { groupId: "pack-a" }),
        ]),
      ],
      ["US"],
    );

    expect(result.verdict).toBe("MAYBE_YEET");
    expect(result.matchLevel).toBe("possible");
  });

  it("does not make a broad one-word retailer suffix match", () => {
    const result = runMatcher(
      { ...emptyObservation(), productName: "Milk" },
      [incident([target("product", "Tesco Milk", 35)])],
      ["UK"],
    );

    expect(result.verdict).toBe("NO_CLUE");
    expect(result.matches).toHaveLength(0);
  });

  it("leaves a single common product word unresolved", () => {
    const result = runMatcher(
      { ...emptyObservation(), productName: "Cereal" },
      [incident([target("product", "Oscar Mayer Cereal", 35)])],
      ["US"],
    );

    expect(result.verdict).toBe("NO_CLUE");
    expect(result.matches).toHaveLength(0);
  });

  it("does not confirm a batch-specific recall from product or brand alone", () => {
    const result = runMatcher(
      { ...emptyObservation(), productName: "Chicken curry", brand: "Farm Kitchen" },
      [
        incident([
          target("product", "Chicken curry", 35),
          target("brand", "Farm Kitchen", 25),
          target("batch", "BATCH7", 60),
        ]),
      ],
      ["UK"],
    );

    expect(result.verdict).toBe("MAYBE_YEET");
    expect(result.matchLevel).toBe("possible");
  });

  it("does not treat brand plus a batch as a confirmed product-specific match", () => {
    const result = runMatcher(
      { ...emptyObservation(), brand: "Farm Kitchen", batchCode: "BATCH7" },
      [
        incident([
          target("brand", "Farm Kitchen", 25, { groupId: "meal-a" }),
          target("batch", "BATCH7", 60, { groupId: "meal-a" }),
        ]),
      ],
      ["UK"],
    );

    expect(result.verdict).toBe("MAYBE_YEET");
    expect(result.matchLevel).toBe("possible");
  });

  it("keeps a low-confidence producer target from producing a probable verdict", () => {
    const lowConfidenceProducer = { ...target("producer", "Demo Valley Foods", 45), confidence: 0.6 };
    const result = runMatcher(
      { ...emptyObservation(), producer: "Demo Valley Foods" },
      [incident([lowConfidenceProducer])],
      ["UK"],
    );

    expect(result.verdict).toBe("MAYBE_YEET");
    expect(result.matchLevel).toBe("contextual");
  });

  it("does not combine a common producer with a lot from a different product group", () => {
    const result = runMatcher(
      { ...emptyObservation(), producer: "Demo Valley Foods", lotCode: "PASTA-B" },
      [
        incident([
          target("producer", "Demo Valley Foods", 45, { groupId: "meal-a" }),
          target("product", "Chicken curry", 35, { groupId: "meal-a" }),
          target("producer", "Demo Valley Foods", 45, { groupId: "meal-b" }),
          target("product", "Pasta bake", 35, { groupId: "meal-b" }),
          target("lot", "PASTA-B", 60, { groupId: "meal-b" }),
        ]),
      ],
      ["UK"],
    );

    expect(result.verdict).toBe("MAYBE_YEET");
    expect(result.matchLevel).toBe("possible");
  });

  it("downgrades a producer match when the warning names a different specific product", () => {
    const result = runMatcher(
      { ...emptyObservation(), producer: "Demo Valley Foods" },
      [
        incident([
          target("producer", "Demo Valley Foods", 45),
          target("product", "Chicken curry", 35),
          target("gtin", "96385074", 70),
        ]),
      ],
      ["UK"],
    );

    expect(result.verdict).toBe("MAYBE_YEET");
    expect(result.matchLevel).toBe("possible");
  });

  it("keeps a whole-facility producer warning strong when it names no specific products", () => {
    const result = runMatcher(
      { ...emptyObservation(), producer: "Demo Valley Foods" },
      [incident([target("producer", "Demo Valley Foods", 45)])],
      ["UK"],
    );

    expect(result.verdict).toBe("YEET");
    expect(result.matchLevel).toBe("probable");
  });

  it.each([
    ["an invalid barcode", { ...emptyObservation(), barcode: "12345670" }],
    ["an unresolved valid barcode", { ...emptyObservation(), barcode: "5000000000005" }],
    ["a batch alone", { ...emptyObservation(), batchCode: "BATCH7" }],
  ])("does not return EAT for %s", (_label, observation) => {
    const result = runMatcher(observation, [incident([target("gtin", "96385074", 70)])], ["UK"]);
    expect(result.verdict).toBe("NO_CLUE");
  });

  it("returns NO_CLUE for empty incident data or an unhealthy source", () => {
    const observation = { ...emptyObservation(), productName: "Unrelated beans" };
    expect(runMatcher(observation, [], ["UK"]).verdict).toBe("NO_CLUE");

    expect(
      runMatcher(observation, [incident([target("gtin", "5000000000005", 70)])], ["UK"], {
        ...healthyStatus,
        healthy: false,
      }).verdict,
    ).toBe("NO_CLUE");
  });

  it("returns MAYBE YEET for contextual country and category signals", () => {
    const result = runMatcher(
      { ...emptyObservation(), countryOfOrigin: "United States", category: "Leafy greens" },
      [incident([target("country", "United States", 10), target("category", "Leafy greens", 12)])],
      ["UK"],
    );
    expect(result.verdict).toBe("MAYBE_YEET");
    expect(result.matchLevel).toBe("contextual");
  });

  it("returns EAT for an identified clean product when the checked dataset has unrelated recalls", () => {
    const result = runMatcher(
      { ...emptyObservation(), productName: "Unrelated beans", barcode: "5000000000005" },
      [incident([target("gtin", "96385074", 70)])],
      ["UK"],
      healthyStatus,
    );

    expect(result.verdict).toBe("EAT");
    expect(result.matchLevel).toBe("none");
    expect(result.datasetStatus).toEqual(healthyStatus);
  });

  it("returns EAT for an unrelated product name instead of a token-overlap false positive", () => {
    const result = runMatcher(
      { ...emptyObservation(), productName: "Unrelated beans" },
      [incident([target("product", "Oscar Mayer Turkey Bacon 12 oz", 35)])],
      ["US"],
      { ...healthyStatus, regions: ["US"] },
    );

    expect(result.verdict).toBe("EAT");
    expect(result.matches).toHaveLength(0);
  });

  it("limits returned matches while preserving the total and non-EAT verdict", () => {
    const incidents = Array.from({ length: 20 }, (_, index) => ({
      ...incident([target("country", "United States", 10)]),
      id: `incident-${index}`,
    }));
    const result = runMatcher(
      { ...emptyObservation(), countryOfOrigin: "United States" },
      incidents,
      ["US"],
      { ...healthyStatus, regions: ["US"] },
    );

    expect(result.matches).toHaveLength(10);
    expect(result.matchCount).toBe(20);
    expect(result.matchLevel).toBe("contextual");
    expect(result.verdict).toBe("MAYBE_YEET");
  });
});
