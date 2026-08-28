import { describe, expect, it } from "vitest";

import { emptyObservation } from "@/lib/domain/schemas";
import type { MatchableIncident, MatchableTarget } from "@/lib/domain/types";
import { normaliseCode, normaliseGtin, normaliseText } from "@/lib/matching/normalise";
import { runMatcher } from "@/lib/matching/matcher";

function target(type: MatchableTarget["type"], value: string, weight: number): MatchableTarget {
  const valueNormalized = type === "gtin" ? normaliseGtin(value) : ["batch", "lot", "establishment", "approval", "eggProducerCode"].includes(type) ? normaliseCode(value) : normaliseText(value);
  return { id: `${type}-${value}`, incidentId: "incident", type, value, valueNormalized, matchType: "exact", dateFrom: null, dateTo: null, notes: null, weight, confidence: 1 };
}

function incident(targets: MatchableTarget[]): MatchableIncident {
  const now = new Date();
  return { id: "incident", title: "Test recall", slug: "test-recall", region: "UK", hazard: "Test hazard", pathogen: null, summary: "Test summary", consumerAdvice: "Do not eat it.", authority: "Test authority", authorityUrl: "https://example.gov", sourceId: "TEST-1", publishedAt: now, updatedAt: now, severity: "high", confidence: 1, targets };
}

describe("deterministic matcher", () => {
  it("returns confirmed YEET for exact barcode and batch", () => {
    const result = runMatcher({ ...emptyObservation(), barcode: "5000000000006", batchCode: "24 182" }, [incident([target("gtin", "5000000000006", 70), target("batch", "24182", 60)])], ["UK"]);
    expect(result.verdict).toBe("YEET");
    expect(result.matchLevel).toBe("confirmed");
    expect(result.matches[0].reasons).toHaveLength(2);
  });

  it("returns probable YEET for an affected producer", () => {
    const result = runMatcher({ ...emptyObservation(), producer: "Demo Valley Foods" }, [incident([target("producer", "Demo Valley Foods", 45)])], ["UK"]);
    expect(result.verdict).toBe("YEET");
    expect(result.matchLevel).toBe("probable");
  });

  it("returns MAYBE YEET for contextual country and category signals", () => {
    const result = runMatcher({ ...emptyObservation(), countryOfOrigin: "United States", category: "Leafy greens" }, [incident([target("country", "United States", 10), target("category", "Leafy greens", 12)])], ["US"]);
    expect(result.verdict).toBe("MAYBE_YEET");
    expect(result.matchLevel).toBe("contextual");
  });

  it("returns EAT for an unrelated identified product", () => {
    const result = runMatcher({ ...emptyObservation(), barcode: "12345670", productName: "Unrelated beans" }, [incident([target("gtin", "5000000000006", 70)])], ["UK"]);
    expect(result.verdict).toBe("EAT");
    expect(result.matchLevel).toBe("none");
  });

  it("does not convert insufficient evidence into EAT", () => {
    const result = runMatcher(emptyObservation(), [], ["UK"]);
    expect(result.verdict).toBe("NO_CLUE");
  });
});
