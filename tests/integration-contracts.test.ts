import { afterEach, describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";

import { emptyObservation } from "@/lib/domain/schemas";
import type { DatasetStatus, MatchableIncident, MatchableTarget } from "@/lib/domain/types";
import { runMatcher } from "@/lib/matching/matcher";
import { normaliseText } from "@/lib/matching/normalise";
import { CheckProductInputSchema, GetWarningInputSchema, PublicCheckResultSchema, SearchWarningsInputSchema } from "@/lib/integrations/contracts";
import { groupAffectedTargets, PublicResponseTooLargeError, serializeCheckResult, serializeSearchResult, serializeWarningDetails } from "@/lib/integrations/serialize";

const time = "2026-10-09T12:00:00.000Z";
const coverage: DatasetStatus = {
  healthy: true, checkedAt: time, regions: ["US"],
  sources: [{ id: "fda", name: "FDA", region: "US", status: "healthy", lastSuccessfulAt: time, scope: "Food enforcement reports" }],
};
const target = (type: MatchableTarget["type"], value: string, groupId: string | null): MatchableTarget => ({
  id: `private-${type}-${value}`, incidentId: "private-id", type, value, valueNormalized: normaliseText(value),
  matchType: "exact", groupId, dateFrom: null, dateTo: null, notes: null, weight: 90, confidence: 1,
});
const notice: MatchableIncident = {
  id: "private-id", slug: "fda-public-notice", title: "Example milk recall", region: "US",
  hazard: "Possible Listeria", pathogen: "Listeria", summary: "Check the specified packets.",
  consumerAdvice: "Do not consume affected packets.", authority: "U.S. Food and Drug Administration",
  authorityUrl: "https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts/example-milk-recall",
  sourceId: "public-reference", publishedAt: new Date(time), updatedAt: new Date(time), severity: "high", confidence: 1,
  targets: [target("product", "Example milk", "private-group-a"), target("batch", "A123", "private-group-a"),
    target("product", "Example cream", "private-group-b"), target("batch", "B456", "private-group-b")],
};

afterEach(() => vi.unstubAllEnvs());

describe("agent input contracts", () => {
  it("requires an explicit region and accepts Oreo with no optional evidence", () => {
    const input = CheckProductInputSchema.parse({ region: "US", observation: { barcode: "044000061494" } });
    expect(input.observation).toEqual({ ...emptyObservation(), barcode: "044000061494" });
    expect(CheckProductInputSchema.safeParse({ observation: { barcode: "044000061494" } }).success).toBe(false);
    expect(CheckProductInputSchema.safeParse({ region: "CA", observation: {} }).success).toBe(false);
  });

  it.each([
    { region: "US", observation: { uploadedPhoto: "data:image" } },
    { region: "US", observation: { dates: { useBy: "2026-10-09", inferred: true } } },
    { region: "US", observation: { eggMark: { producerCode: "123", probability: 1 } } },
    { region: "US", observation: {}, confirmed: true },
  ])("rejects unknown properties at every nested boundary", (input) => {
    expect(CheckProductInputSchema.safeParse(input).success).toBe(false);
  });

  it.each(["09/10/2026", "2026-02-30", "October 9", "2026-10-09T12:00:00Z"])("rejects ambiguous or invalid packet date %s", (useBy) => {
    expect(CheckProductInputSchema.safeParse({ region: "UK", observation: { dates: { useBy } } }).success).toBe(false);
  });

  it("bounds browse input and preserves valid ISO packet dates", () => {
    expect(CheckProductInputSchema.parse({ region: "UK", observation: { dates: { useBy: "2026-10-09" } } }).observation.dates?.useBy).toBe("2026-10-09");
    expect(SearchWarningsInputSchema.safeParse({ region: "UK", pageSize: 21 }).success).toBe(false);
    expect(SearchWarningsInputSchema.safeParse({ region: "UK", query: "x".repeat(201) }).success).toBe(false);
    expect(GetWarningInputSchema.safeParse({ slug: "../../private" }).success).toBe(false);
  });
});

describe("public response mapping", () => {
  it("keeps submitted and lookup evidence separate and qualifies an unmatched Oreo", () => {
    const submittedObservation = { ...emptyObservation(), barcode: "044000061494" };
    const enrichedObservation = { ...submittedObservation, barcode: "00044000061494", productName: "Oreo", brand: "Mondelez International" };
    const result = runMatcher(enrichedObservation, [notice], ["US"], coverage);
    const publicResult = serializeCheckResult({ result, submittedObservation, enrichedObservation });
    expect(publicResult.status).toBe("no_matching_warning");
    expect(publicResult.label).toBe("No matching warning found");
    expect(publicResult.qualification).toContain("does not establish");
    expect(publicResult.submittedEvidence.productName).toBeNull();
    expect(publicResult.checkedEvidence.productName).toBe("Oreo");
    expect(publicResult.enrichedFields).toEqual(["productName", "brand", "barcode"]);
    expect(JSON.stringify(publicResult)).not.toContain('"EAT"');
    expect(PublicCheckResultSchema.safeParse(publicResult).success).toBe(true);
  });

  it("preserves grouped packet restrictions and omits internal fields", () => {
    const observation = { ...emptyObservation(), productName: "Example milk" };
    const result = runMatcher(observation, [notice], ["US"], coverage);
    const output = serializeCheckResult({ result, submittedObservation: observation, enrichedObservation: observation });
    expect(output.warnings).toHaveLength(1);
    expect(output.warnings[0].packetReviewRequired).toBe(true);
    expect(output.warnings[0].affectedGroups.map((group) => group.targets.map((item) => item.value)))
      .toEqual([["Example milk", "A123"], ["Example cream", "B456"]]);
    const json = JSON.stringify(output);
    for (const field of ["private-id", "private-group", '"score"', '"weight"', '"confidence"', '"valueNormalized"', '"shareToken"']) expect(json).not.toContain(field);
    expect(output.warnings[0].warning.officialSource.url).toBe(notice.authorityUrl);
  });

  it("keeps missing coverage inconclusive after lookup enrichment", () => {
    const observation = { ...emptyObservation(), productName: "Oreo", brand: "Mondelez International" };
    const result = runMatcher(observation, [notice], ["US"], { ...coverage, healthy: false, regions: [] });
    const output = serializeCheckResult({ result, submittedObservation: observation, enrichedObservation: observation });
    expect(output).toMatchObject({ status: "inconclusive", label: "Warning data unavailable", inconclusiveReason: "incomplete_data", coverage: { healthy: false } });
  });

  it("reports truncated match/group summaries and keeps unassociated codes separate", () => {
    const observation = { ...emptyObservation(), productName: "Example milk" };
    const incident = { ...notice, targets: [...notice.targets, target("product", "Third milk", "c"), target("batch", "C123", "c"), target("lot", "Loose lot", null)] };
    const result = runMatcher(observation, [incident], ["US"], coverage);
    result.matchCount = 12;
    const output = serializeCheckResult({ result, submittedObservation: observation, enrichedObservation: observation });
    expect(output).toMatchObject({ matchCount: 12, matchesComplete: false });
    expect(output.warnings[0]).toMatchObject({ affectedGroupCount: 4, affectedGroupsComplete: false, packetReviewRequired: true });
    expect(groupAffectedTargets(incident.targets)[3]).toMatchObject({ association: "ungrouped", targets: [{ value: "Loose lot" }] });
  });

  it("preserves whole groups, dates and advice in warning details", () => {
    const incident = { ...notice, targets: notice.targets.map((item) => ({ ...item, dateFrom: new Date(time), dateTo: new Date("2026-10-15T00:00:00Z") })) };
    const groups = groupAffectedTargets(incident.targets);
    const page = serializeWarningDetails(incident, groups.slice(0, 1), groups.length, "signed-next-page");
    expect(page.affectedGroups[0].targets[1]).toMatchObject({ value: "A123", dateFrom: time, dateTo: "2026-10-15T00:00:00.000Z" });
    expect(page).toMatchObject({ consumerAdvice: notice.consumerAdvice, affectedGroupsComplete: false, nextCursor: "signed-next-page" });
  });

  it("does not expose browse IDs or raw URLs, and keeps search distinct from checking", () => {
    const result = serializeSearchResult({
      items: [{ ...notice, id: "private-id" as Id<"incidents">, startsAt: 0, endsAt: undefined, publishedAt: +notice.publishedAt, updatedAt: +notice.updatedAt, categories: [], superCategories: ["Food"], stores: [],
        authorityUrl: "https://attacker.example/recall" }],
      total: 1, nextCursor: null, asOf: time, status: coverage, complete: true,
    }, "US");
    expect(JSON.stringify(result)).not.toContain("private-id");
    expect(JSON.stringify(result)).not.toContain("attacker.example");
    expect(result.qualification).toContain("not a product check");
    expect(result.warnings[0].websiteUrl).toBe("https://eatoryeet.app/incidents/fda-public-notice");
  });

  it("fails on oversized source groups instead of clipping identifying codes", () => {
    const incident = { ...notice, targets: [target("batch", "X".repeat(70_000), "one-group")] };
    const groups = groupAffectedTargets(incident.targets);
    expect(() => serializeWarningDetails(incident, groups, 1, null)).toThrow(PublicResponseTooLargeError);
    expect(groups[0].targets[0].value).toHaveLength(70_000);
  });
});
