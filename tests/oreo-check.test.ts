import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/check/route";
import { emptyObservation } from "@/lib/domain/schemas";
import type { DatasetStatus, MatchableIncident } from "@/lib/domain/types";
import oreoMetadata from "./fixtures/open-food-facts-oreo.json";

const mocks = vi.hoisted(() => ({ dataset: vi.fn(), query: vi.fn(), mutation: vi.fn() }));
vi.mock("@/db/queries", () => ({ getCheckDataset: mocks.dataset }));
vi.mock("convex/nextjs", () => ({ fetchQuery: mocks.query, fetchMutation: mocks.mutation }));
vi.mock("@/lib/security/anonymous", () => ({
  anonymousSubject: () => ({ id: "test-user" }),
  attachAnonymousCookie: vi.fn(),
  trustedNetworkSubject: () => null,
}));
vi.mock("@/lib/security/rate-limit", () => ({ takeRateLimits: async () => [{ scope: "anonymous", allowed: true, limit: 120, remaining: 119, resetAt: new Date() }] }));

const checkedAt = "2026-10-08T12:00:00.000Z";
const status: DatasetStatus = { healthy: true, checkedAt, regions: ["US"], sources: [] };
const unrelatedIncident: MatchableIncident = {
  id: "unrelated-warning", title: "Unrelated beans recall", slug: "unrelated-beans", region: "US",
  hazard: "Test hazard", pathogen: null, summary: "Test warning", consumerAdvice: "Follow the official advice.",
  authority: "Test authority", authorityUrl: "https://example.gov/recall", sourceId: "test-warning",
  publishedAt: new Date(checkedAt), updatedAt: new Date(checkedAt), severity: "high", confidence: 1,
  targets: [{ id: "unrelated-product", incidentId: "unrelated-warning", type: "product", value: "Unrelated beans", valueNormalized: "unrelatedbeans", matchType: "exact", dateFrom: null, dateTo: null, notes: null, weight: 35, confidence: 1 }],
};

async function checkOreo(barcode = "044000061494") {
  return POST(new Request("http://localhost/api/check", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ region: "US", observation: { ...emptyObservation(), barcode } }),
  }) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  mocks.query.mockResolvedValue({ product: null, metadata: null });
  mocks.mutation.mockResolvedValue(null);
  mocks.dataset.mockResolvedValue({ incidents: [unrelatedIncident], status });
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(JSON.stringify(oreoMetadata))));
});

describe("Oreo barcode through lookup and matching", () => {
  it.each(["044000061494", "0044000061494", "00044000061494"])("checks %s with the real one-word lookup name without manual details", async (barcode) => {
    const response = await checkOreo(barcode);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      verdict: "EAT", matchLevel: "none",
      observation: { barcode: "00044000061494", productName: "Oreo", brand: "Mondelez International" },
    });
  });

  it("keeps a USDA outage inconclusive even after identifying the Oreo barcode", async () => {
    mocks.dataset.mockResolvedValue({ incidents: [unrelatedIncident], status: { ...status, healthy: false, regions: [] } });
    const response = await checkOreo();
    await expect(response.json()).resolves.toMatchObject({
      verdict: "NO_CLUE", inconclusiveReason: "incomplete_data",
      observation: { barcode: "00044000061494", productName: "Oreo" },
    });
  });
});
