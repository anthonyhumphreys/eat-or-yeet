import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ dataset: vi.fn(), enrich: vi.fn() }));
vi.mock("@/db/queries", () => ({ getCheckDataset: mocks.dataset }));
vi.mock("@/lib/products/enrich", () => ({ enrichObservation: mocks.enrich }));

import { getCheckDataset } from "@/db/queries";
import { checkProduct } from "@/lib/checks/service";
import { emptyObservation } from "@/lib/domain/schemas";
import type { DatasetStatus, MatchableIncident, MatchableTarget } from "@/lib/domain/types";
import { normaliseCode, normaliseGtin, normaliseText } from "@/lib/matching/normalise";
import * as matcher from "@/lib/matching/matcher";

const runMatcher = vi.spyOn(matcher, "runMatcher");

const checkedAt = "2026-10-08T12:00:00.000Z";
const healthyStatus: DatasetStatus = { healthy: true, checkedAt, regions: ["UK"], sources: [] };

function target(type: MatchableTarget["type"], value: string, options: Partial<MatchableTarget> = {}): MatchableTarget {
  const valueNormalized = type === "gtin"
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
    weight: type === "batch" ? 60 : type === "gtin" ? 70 : 35,
    confidence: 1,
    ...options,
  };
}

function incident(targets: MatchableTarget[]): MatchableIncident {
  const now = new Date(checkedAt);
  return {
    id: "incident", title: "Test recall", slug: "test-recall", region: "UK", hazard: "Test hazard",
    pathogen: null, summary: "Test warning", consumerAdvice: "Follow the official advice.",
    authority: "Test authority", authorityUrl: "https://example.gov", sourceId: "test-warning",
    publishedAt: now, updatedAt: now, severity: "high", confidence: 1, targets,
  };
}

const emptyDataset = { incidents: [], status: healthyStatus };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enrich.mockImplementation(async (observation) => observation);
  mocks.dataset.mockResolvedValue(emptyDataset);
});

describe("checkProduct", () => {
  it("matches a barcode-only Oreo after fixed enrichment while retaining the submitted observation", async () => {
    const submittedObservation = { ...emptyObservation(), barcode: "044000061494" };
    const enrichedObservation = {
      ...submittedObservation,
      barcode: "00044000061494",
      productName: "Oreo",
      brand: "Mondelez International",
    };
    mocks.enrich.mockResolvedValue(enrichedObservation);
    mocks.dataset.mockResolvedValue({
      incidents: [incident([target("product", "Unrelated beans")])],
      status: healthyStatus,
    });

    const checked = await checkProduct(submittedObservation, "UK");

    expect(checked.submittedObservation).toBe(submittedObservation);
    expect(checked.enrichedObservation).toEqual(enrichedObservation);
    expect(checked.result).toMatchObject({
      verdict: "EAT",
      observation: enrichedObservation,
      matches: [],
    });
    expect(getCheckDataset).toHaveBeenCalledWith("UK");
  });

  it("preserves grouped batch matching and requires its date range to fit", async () => {
    const observation = {
      ...emptyObservation(), barcode: "5000000000005", batchCode: "24 182",
      dates: { useBy: "2026-10-08", bestBefore: null, productionDate: null },
    };
    mocks.dataset.mockResolvedValue({
      incidents: [incident([
        target("gtin", "5000000000005", { groupId: "tin-a", weight: 70 }),
        target("batch", "24182", { groupId: "tin-a", weight: 60, dateFrom: new Date("2026-10-01"), dateTo: new Date("2026-10-10") }),
      ])],
      status: healthyStatus,
    });

    const checked = await checkProduct(observation, "UK");

    expect(checked.result).toMatchObject({ verdict: "YEET", matchLevel: "confirmed" });
    expect(checked.result.matches[0]?.reasons.map(({ type }) => type)).toEqual(expect.arrayContaining(["gtin", "batch"]));

    const outsideDateRange = await checkProduct({
      ...observation,
      dates: { useBy: "2026-10-11", bestBefore: null, productionDate: null },
    }, "UK");
    expect(outsideDateRange.result.verdict).toBe("MAYBE_YEET");
  });

  it("keeps results inconclusive when a source is stale", async () => {
    mocks.dataset.mockResolvedValue({
      incidents: [incident([target("product", "Oreo")])],
      status: {
        ...healthyStatus,
        healthy: false,
        sources: [{ id: "source", name: "Authority", region: "UK", lastSuccessfulAt: checkedAt, status: "stale", scope: "recalls" }],
      },
    });

    const checked = await checkProduct({ ...emptyObservation(), productName: "Oreo" }, "UK");

    expect(checked.result).toMatchObject({ verdict: "NO_CLUE", inconclusiveReason: "incomplete_data" });
    expect(checked.result.datasetStatus?.sources[0]?.status).toBe("stale");
  });

  it("does not compute a verdict when cancellation arrives during enrichment", async () => {
    const controller = new AbortController();
    let finishEnrichment!: (observation: ReturnType<typeof emptyObservation>) => void;
    mocks.enrich.mockImplementationOnce(() => new Promise((resolve) => {
      finishEnrichment = resolve;
    }));
    const pending = checkProduct(emptyObservation(), "UK", { signal: controller.signal });

    controller.abort();
    finishEnrichment(emptyObservation());

    await expect(pending).rejects.toHaveProperty("name", "AbortError");
    expect(runMatcher).not.toHaveBeenCalled();
  });

  it.each(["enrichment", "dataset"] as const)("propagates %s failures for the route to handle", async (failure) => {
    const error = new Error(`${failure} unavailable`);
    if (failure === "enrichment") mocks.enrich.mockRejectedValue(error);
    else mocks.dataset.mockRejectedValue(error);

    await expect(checkProduct(emptyObservation(), "UK")).rejects.toBe(error);
  });
});
