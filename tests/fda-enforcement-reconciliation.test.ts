import { afterEach, describe, expect, it, vi } from "vitest";

import { internal } from "@backend/api";
import { fdaSource, parseFdaRecord } from "@/lib/incidents/fda";
import { serialiseSourceIncident } from "@/lib/incidents/serialise";
import { createBackend } from "./backend-harness";

function report(overrides: Record<string, unknown> = {}) {
  return {
    status: "Ongoing", classification: "Not Yet Classified", recall_number: "", event_id: "99757",
    recalling_firm: "Unilever North America Supply Chain Company, LLC",
    product_description: "Almond Joy Ice Cream Bar, 2.0 fl. oz. ice cream bars, 6 bars per carton. Keep frozen",
    reason_for_recall: "Inaccurate Nutrition Facts information listed on product",
    recall_initiation_date: "20260811", report_date: "20260930", code_info: "APR0927XS3",
    ...overrides,
  };
}

const prior = () => parseFdaRecord(report());
const currentMeal = () => report({ recall_number: "F-1000-2026", event_id: "1000", product_description: "Frozen meal" });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function mockFeed(current: unknown[], event: unknown[] | Response) {
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const search = url.searchParams.get("search") ?? "";
    if (search.startsWith("status:")) {
      return json({ meta: { results: { skip: 0, limit: 1_000, total: current.length } }, results: current });
    }
    if (search.startsWith("event_id:")) {
      expect(search).toBe('event_id:"99757"');
      expect(url.searchParams.get("skip")).toBe("0");
    } else expect(search).toBe('recall_number:"F-2000-2026"');
    return event instanceof Response ? event.clone()
      : json({ meta: { results: { skip: 0, limit: 1_000, total: event.length } }, results: event });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("unnumbered FDA food reports", () => {
  it("keeps a removed unclassified report active while importing the current feed, including repeated refreshes", async () => {
    const old = prior();
    mockFeed([currentMeal()], json({ error: { code: "NOT_FOUND", message: "No matches found!" } }, 404));
    const incidents = await fdaSource.fetchIncidents([old.sourceId], [old]);
    expect(incidents).toHaveLength(2);
    const retained = incidents.find(item => item.sourceId === old.sourceId)!;
    expect(retained).toMatchObject({ status: "active", slug: old.slug, originalSourceData: old.originalSourceData, targets: old.targets });
    expect(retained.consumerAdvice).toContain("current status is unverified");
    const repeated = await fdaSource.fetchIncidents([old.sourceId, "F-1000-2026"], [retained]);
    expect(repeated).toHaveLength(2);
    expect(repeated.find(item => item.sourceId === old.sourceId)).toEqual(retained);
  });

  it("preserves warning identity when the current report gains a number and a new report date", async () => {
    const old = prior();
    const fetch = mockFeed([report({ recall_number: "F-2000-2026", report_date: "20261028" })], []);
    const [updated] = await fdaSource.fetchIncidents([old.sourceId], [old]);
    expect(updated).toMatchObject({ sourceId: old.sourceId, slug: old.slug, status: "active" });
    expect(updated.authorityUrl).toContain("F-2000-2026");
    expect(updated.consumerAdvice).not.toContain("unverified");
    expect(await fdaSource.fetchIncidents([old.sourceId], [updated])).toEqual([updated]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each(["Completed", "Terminated"])("accepts an explicit %s status only for the same event product", async status => {
    const old = prior();
    mockFeed([currentMeal()], [report({ status, recall_number: "F-2000-2026", report_date: "20261028" })]);
    const incidents = await fdaSource.fetchIncidents([old.sourceId], [old]);
    expect(incidents.find(item => item.sourceId === old.sourceId)).toMatchObject({ slug: old.slug, status: "resolved" });
  });

  it("does not treat closure of another product in the event as closure of the stored warning", async () => {
    const old = prior();
    mockFeed([currentMeal()], [report({ status: "Terminated", recall_number: "F-2000-2026", product_description: "A different ice cream" })]);
    const incidents = await fdaSource.fetchIncidents([old.sourceId], [old]);
    expect(incidents.find(item => item.sourceId === old.sourceId)).toMatchObject({ status: "active" });
    expect(incidents.find(item => item.sourceId === old.sourceId)?.consumerAdvice).toContain("unverified");
  });

  it("rejects ambiguous event products", async () => {
    const old = prior();
    mockFeed([], [report({ recall_number: "F-2000-2026" }), report({ recall_number: "F-2001-2026" })]);
    await expect(fdaSource.fetchIncidents([old.sourceId], [old])).rejects.toThrow("ambiguously matches");
  });

  it.each(["Ongoing", "Completed"])("updates existing legacy aliases and a numbered copy together when FDA says %s", async status => {
    const old = prior();
    const alias = { ...old, sourceId: "unclassified-20260930-unilever-almond-joy", slug: "older-almond-joy-link" };
    const record = report({ recall_number: "F-2000-2026", status });
    mockFeed(status === "Ongoing" ? [record] : [], [record]);
    const incidents = await fdaSource.fetchIncidents([old.sourceId, alias.sourceId, "F-2000-2026"], [old, alias]);
    expect(incidents).toHaveLength(3);
    expect(incidents.map(item => item.sourceId)).toEqual(expect.arrayContaining([old.sourceId, alias.sourceId, "F-2000-2026"]));
    expect(incidents.find(item => item.sourceId === alias.sourceId)?.slug).toBe(alias.slug);
    expect(incidents.every(item => item.status === (status === "Ongoing" ? "active" : "resolved"))).toBe(true);
  });

  it.each([
    json({ error: { code: "INVALID_QUERY", message: "Invalid query" } }, 404),
    json({ meta: { results: { skip: 0, limit: 1_000, total: 2 } }, results: [report()] }),
    json({ meta: { results: { skip: 0, limit: 1_000, total: 1_001 } }, results: [report()] }),
    json({ meta: { results: { skip: 0, limit: 1_000, total: 1 } }, results: [report({ event_id: "other" })] }),
  ])("rejects malformed, incomplete and unrelated event responses %#", async response => {
    const old = prior();
    mockFeed([currentMeal()], response);
    await expect(fdaSource.fetchIncidents([old.sourceId], [old])).rejects.toThrow();
  });

  it("loads only unnumbered FDA source payloads and updates the existing archive and matching row", async () => {
    const t = createBackend();
    const old = prior();
    await t.mutation(internal.incidents.upsertBatch, { items: [old, parseFdaRecord(currentMeal())].map(item => ({
      ...serialiseSourceIncident(item), sourceKey: "fda",
    })) });
    const before = await t.run(ctx => ctx.db.query("incidents").withIndex("by_authority_sourceId", q => q.eq("authority", old.authority).eq("sourceId", old.sourceId)).unique());
    const page = await t.query(internal.incidents.getActiveSourceIdsPage, { sourceKey: "fda", cursor: null });
    expect(page.ids).toHaveLength(2);
    expect(page.trackedNotices).toEqual([{ sourceId: old.sourceId, slug: old.slug, originalSourceData: old.originalSourceData }]);
    mockFeed([currentMeal()], json({ error: { code: "NOT_FOUND", message: "No matches found!" } }, 404));
    const items = await fdaSource.fetchIncidents(page.ids, page.trackedNotices);
    expect(await t.mutation(internal.incidents.upsertBatch, { items: items.map(item => ({ ...serialiseSourceIncident(item), sourceKey: "fda" })) }))
      .toEqual({ created: 0, updated: 1, unchanged: 1 });
    await t.run(async ctx => {
      expect(await ctx.db.query("incidents").collect()).toHaveLength(2);
      const after = await ctx.db.get("incidents", before!._id);
      expect(after).toMatchObject({ status: "active", slug: old.slug });
      const match = await ctx.db.query("incidentMatchData").withIndex("by_incidentId", q => q.eq("incidentId", before!._id)).unique();
      expect(match).toMatchObject({ status: "active", consumerAdvice: after!.consumerAdvice });
      expect(match!.consumerAdvice).toContain("unverified");
    });
  });
});
