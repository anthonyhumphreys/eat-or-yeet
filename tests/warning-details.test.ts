import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MatchableIncident, MatchableTarget } from "@/lib/domain/types";

const { getIncidentBySlug } = vi.hoisted(() => ({ getIncidentBySlug: vi.fn() }));
vi.mock("@/db/queries", () => ({ getIncidentBySlug }));

const now = Date.parse("2026-10-09T12:00:00Z");
const secret = "warning details test secret";
const makeTarget = (index: number, type: MatchableTarget["type"], value: string, groupId: string | null): MatchableTarget => ({
  id: `private-target-${index}`,
  incidentId: "private-incident-id",
  type,
  value,
  valueNormalized: value.toLowerCase(),
  matchType: "exact",
  groupId,
  dateFrom: index === 0 ? new Date("2026-10-01T00:00:00Z") : null,
  dateTo: index === 0 ? new Date("2026-10-15T00:00:00Z") : null,
  notes: null,
  weight: 90,
  confidence: 1,
});

let incident: MatchableIncident;

function makeIncident(): MatchableIncident {
  const targets = Array.from({ length: 45 }, (_, index) => [
    makeTarget(index * 2, "product", `Product ${index + 1}`, `private-group-${index + 1}`),
    makeTarget(index * 2 + 1, "batch", `BATCH-${String(index + 1).padStart(3, "0")}`, `private-group-${index + 1}`),
  ]).flat();
  return {
    id: "private-incident-id",
    slug: "example-warning",
    title: "Example product warning",
    region: "UK",
    hazard: "Undeclared milk",
    pathogen: null,
    summary: "Check the affected products below.",
    consumerAdvice: "Do not eat affected products. Return them to the shop.",
    authority: "Food Standards Agency",
    authorityUrl: "https://alerts.food.gov.uk/news-alerts/alert/FSA-PRIN-1-2026",
    sourceId: "FSA-PRIN-1-2026",
    publishedAt: new Date(now - 86_400_000),
    updatedAt: new Date(now - 10_000),
    severity: "high",
    confidence: 1,
    targets,
  };
}

function signedSearchCursor() {
  const encoded = Buffer.from(JSON.stringify({ v: 1, region: "UK", filters: {}, revision: "revision", pageSize: 20, offset: 20, asOf: now, expiresAt: now + 10_000, boundaryAt: null })).toString("base64url");
  const signature = createHmac("sha256", secret).update("eat-or-yeet:warning-search-cursor:v1:").update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.stubEnv("RATE_LIMIT_SALT", secret);
  incident = makeIncident();
  getIncidentBySlug.mockImplementation(async (slug: string) => slug === incident.slug ? incident : null);
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("warning details service", () => {
  it("keeps medicines browse-only even when an integration supplies their exact slug", async () => {
    getIncidentBySlug.mockResolvedValue({ ...incident, superCategories: ["Baby", "Medical"] });
    const { getWarningDetails } = await import("@/lib/incidents/details");
    expect(await getWarningDetails({ slug: incident.slug, pageSize: 20 })).toBeNull();
  });

  it("paginates whole affected groups and keeps source codes and dates intact", async () => {
    const { getWarningDetails } = await import("@/lib/incidents/details");
    const first = await getWarningDetails({ slug: incident.slug, pageSize: 20 });
    expect(first).toMatchObject({
      affectedGroupCount: 45,
      affectedGroupsComplete: false,
      nextCursor: expect.any(String),
      consumerAdvice: incident.consumerAdvice,
    });
    expect(first!.affectedGroups).toHaveLength(20);
    expect(first!.affectedGroups[0].targets.map((target) => target.value)).toEqual(["Product 1", "BATCH-001"]);
    expect(first!.affectedGroups[0].targets[0]).toMatchObject({ dateFrom: "2026-10-01T00:00:00.000Z", dateTo: "2026-10-15T00:00:00.000Z" });

    const second = await getWarningDetails({ slug: incident.slug, pageSize: 20, cursor: first!.nextCursor! });
    const third = await getWarningDetails({ slug: incident.slug, pageSize: 20, cursor: second!.nextCursor! });
    expect(second!.affectedGroups).toHaveLength(20);
    expect(second!.affectedGroups[0].targets.map((target) => target.value)).toEqual(["Product 21", "BATCH-021"]);
    expect(third!.affectedGroups).toHaveLength(5);
    expect(third!.affectedGroupsComplete).toBe(false);
    expect(third!.nextCursor).toBeNull();
    const serialized = JSON.stringify([first, second, third]);
    expect(serialized).not.toContain("private-incident-id");
    expect(serialized).not.toContain("private-group");
    expect(serialized).not.toContain("private-target");
  });

  it("returns null for an unknown or demo-only slug", async () => {
    const { getWarningDetails } = await import("@/lib/incidents/details");
    expect(await getWarningDetails({ slug: "missing-warning", pageSize: 20 })).toBeNull();
    expect(getIncidentBySlug).toHaveBeenCalledWith("missing-warning");
  });

  it("rejects cursor tampering, changed page inputs, changed warning revision and expiry", async () => {
    const { getWarningDetails, WarningDetailsCursorError } = await import("@/lib/incidents/details");
    const first = await getWarningDetails({ slug: incident.slug, pageSize: 2 });
    const cursor = first!.nextCursor!;
    await expect(getWarningDetails({ slug: incident.slug, pageSize: 2, cursor: `${cursor}x` }))
      .rejects.toBeInstanceOf(WarningDetailsCursorError);
    await expect(getWarningDetails({ slug: incident.slug, pageSize: 3, cursor }))
      .rejects.toMatchObject({ code: "input_changed", recoverable: true });
    await expect(getWarningDetails({ slug: "different-warning", pageSize: 2, cursor }))
      .rejects.toMatchObject({ code: "input_changed", recoverable: true });

    incident = { ...incident, updatedAt: new Date(now) };
    await expect(getWarningDetails({ slug: incident.slug, pageSize: 2, cursor }))
      .rejects.toMatchObject({ code: "revision_changed", recoverable: true });

    incident = makeIncident();
    const expiring = await getWarningDetails({ slug: incident.slug, pageSize: 2 });
    vi.setSystemTime(now + 10 * 60 * 1_000);
    await expect(getWarningDetails({ slug: incident.slug, pageSize: 2, cursor: expiring!.nextCursor! }))
      .rejects.toMatchObject({ code: "expired", recoverable: true });
  });

  it("invalidates continuations when any serialized warning details change at the same updatedAt", async () => {
    const { getWarningDetails } = await import("@/lib/incidents/details");
    const cursorForOriginal = async () => (await getWarningDetails({ slug: incident.slug, pageSize: 2 }))!.nextCursor!;

    const batchCursor = await cursorForOriginal();
    incident = {
      ...incident,
      targets: incident.targets.map((target, index) => index === 1 ? { ...target, value: "CORRECTED-BATCH-001" } : target),
    };
    await expect(getWarningDetails({ slug: incident.slug, pageSize: 2, cursor: batchCursor }))
      .rejects.toMatchObject({ code: "revision_changed", recoverable: true });

    incident = makeIncident();
    const orderCursor = await cursorForOriginal();
    incident = { ...incident, targets: [incident.targets[1], incident.targets[0], ...incident.targets.slice(2)] };
    await expect(getWarningDetails({ slug: incident.slug, pageSize: 2, cursor: orderCursor }))
      .rejects.toMatchObject({ code: "revision_changed", recoverable: true });

    incident = makeIncident();
    const adviceCursor = await cursorForOriginal();
    incident = { ...incident, consumerAdvice: "Updated advice: do not consume these products." };
    await expect(getWarningDetails({ slug: incident.slug, pageSize: 2, cursor: adviceCursor }))
      .rejects.toMatchObject({ code: "revision_changed", recoverable: true });
  });

  it("continues when the serialized warning content is unchanged", async () => {
    const { getWarningDetails } = await import("@/lib/incidents/details");
    const first = await getWarningDetails({ slug: incident.slug, pageSize: 2 });
    const second = await getWarningDetails({ slug: incident.slug, pageSize: 2, cursor: first!.nextCursor! });
    expect(second!.affectedGroups[0].targets.map((target) => target.value)).toEqual(["Product 3", "BATCH-003"]);
    expect(second!.affectedGroups).toHaveLength(2);
  });

  it("rejects a signed cursor created for warning search", async () => {
    const { getWarningDetails } = await import("@/lib/incidents/details");
    await expect(getWarningDetails({ slug: incident.slug, pageSize: 20, cursor: signedSearchCursor() }))
      .rejects.toMatchObject({ code: "invalid", recoverable: true });
  });

  it("expires from the first page time instead of extending the cursor lifetime", async () => {
    const { getWarningDetails } = await import("@/lib/incidents/details");
    const first = await getWarningDetails({ slug: incident.slug, pageSize: 2 });
    vi.setSystemTime(now + 9 * 60 * 1_000);
    const second = await getWarningDetails({ slug: incident.slug, pageSize: 2, cursor: first!.nextCursor! });
    vi.setSystemTime(now + 10 * 60 * 1_000);
    await expect(getWarningDetails({ slug: incident.slug, pageSize: 2, cursor: second!.nextCursor! }))
      .rejects.toMatchObject({ code: "expired", recoverable: true });
  });
});
