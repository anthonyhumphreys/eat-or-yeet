import type { FunctionReturnType } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api, internal } from "@convex/_generated/api";
import { fdaDrugSource, parseFdaDrugRecord } from "@/lib/incidents/fda";
import { incidentSuperCategories, medicineBrowseCategories } from "@/lib/incidents/browse";
import { createBackend } from "./convex-harness";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function drugRecord(overrides: Record<string, unknown> = {}) {
  return {
    status: "Ongoing",
    classification: "Class II",
    country: "United States",
    recalling_firm: "Example Pharma",
    recall_number: "D-0100-2026",
    event_id: "2000",
    product_description: "Infants' Acetaminophen Oral Suspension, 160 mg per 5 mL, 2 fl oz bottle",
    reason_for_recall: "Subpotent drug",
    recall_initiation_date: "20260930",
    report_date: "20261001",
    code_info: "Lot #: AB1234, Exp. 06/2027",
    distribution_pattern: "Nationwide",
    openfda: { brand_name: ["Infants' Pain Relief"], product_type: ["HUMAN OTC DRUG"], upc: ["0300450449108"] },
    ...overrides,
  };
}

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("openFDA drug recalls", () => {
  it("keeps the recall number, lot, linked brand and package barcode, with medicine advice", () => {
    const incident = parseFdaDrugRecord(drugRecord());
    expect(incident).toMatchObject({ sourceId: "D-0100-2026", slug: "fda-d-0100-2026", region: "US", status: "reported", severity: "high" });
    expect(incident.authorityUrl).toContain("https://api.fda.gov/drug/enforcement.json");
    expect(incident.consumerAdvice).toMatch(/pharmacist or doctor/);
    expect(incident.targets).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "lot", value: "AB1234" }),
      expect.objectContaining({ type: "brand", value: "Infants' Pain Relief" }),
      expect.objectContaining({ type: "gtin", value: "0300450449108" }),
    ]));
  });

  it("reads the drug endpoint and sends an optional key as a header, never in the URL", async () => {
    vi.stubEnv("OPENFDA_API_KEY", "secret-key");
    const calls: Array<{ url: URL; headers: Headers }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push({ url, headers: new Headers(init?.headers) });
      return jsonResponse({ meta: { results: { skip: 0, limit: 1_000, total: 1 } }, results: [drugRecord()] });
    }));

    const incidents = await fdaDrugSource.fetchIncidents([]);
    expect(incidents.map((incident) => incident.sourceId)).toEqual(["D-0100-2026"]);
    expect(calls).toHaveLength(1);
    expect(calls[0].url.pathname).toBe("/drug/enforcement.json");
    expect(calls[0].url.search).not.toContain("secret-key");
    expect(calls[0].headers.get("authorization")).toBe(`Basic ${btoa("secret-key:")}`);
  });

  it("sends no authorisation header without a key", async () => {
    let headers = new Headers();
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      headers = new Headers(init?.headers);
      return jsonResponse({ meta: { results: { skip: 0, limit: 1_000, total: 0 } }, results: [] });
    }));
    await fdaDrugSource.fetchIncidents([]);
    expect(headers.has("authorization")).toBe(false);
  });
});

describe("super-categories", () => {
  it("sorts medicines by openFDA product type", () => {
    expect(medicineBrowseCategories(drugRecord())).toEqual(["Over-the-counter medicines"]);
    expect(medicineBrowseCategories(drugRecord({ openfda: { product_type: ["HUMAN PRESCRIPTION DRUG"] } }))).toEqual(["Prescription medicines"]);
    expect(medicineBrowseCategories(drugRecord({ openfda: {} }))).toEqual(["Other medicines"]);
  });

  it("adds Baby to baby food and infant medicines only", () => {
    expect(incidentSuperCategories({ title: "Bread recall", categories: ["Bakery & grains"] })).toEqual(["Food"]);
    expect(incidentSuperCategories({ title: "Formula recall", categories: ["Baby food", "Dairy & eggs"] })).toEqual(["Baby", "Food"]);
    expect(incidentSuperCategories({ source: "Medical", title: "Infants' Acetaminophen", categories: ["Other medicines"] })).toEqual(["Baby", "Medical"]);
    expect(incidentSuperCategories({ source: "Medical", title: "Children's cough syrup", categories: ["Other medicines"] })).toEqual(["Medical"]);
    expect(incidentSuperCategories({ source: "Food", title: "Baby spinach", categories: ["Produce"] })).toEqual(["Food"]);
  });
});

describe("browse-only medicine recalls", () => {
  const drug = () => ({
    ...parseFdaDrugRecord(drugRecord()),
    sourceKey: "fda-drugs",
    publishedAt: 1, updatedAt: 1, startsAt: 1, endsAt: undefined, retrievedAt: 1, isDemo: false,
    hazard: "Subpotent drug", pathogen: undefined,
    targets: [{ type: "lot" as const, value: "AB1234", valueNormalized: "AB1234", matchType: "exact" as const, weight: 60, confidence: 0.9 }],
  });
  const food = () => ({
    ...drug(), status: "active" as const, title: "Biscuit recall", slug: "biscuit-recall", sourceId: "F-0001-2026", sourceKey: "fda",
    summary: "Biscuits", originalSourceData: { product_description: "Biscuits" },
  });

  it("lists medicines with their super-categories but keeps them out of pack checks", async () => {
    const t = createBackend();
    await t.mutation(internal.incidents.upsertBatch, { items: [drug(), food()] });

    const listed = await t.query(api.incidents.listActivePage, { region: "US", cursor: null, snapshot: true });
    expect(listed.isDone).toBe(false);
    const reports = await t.query(api.incidents.listActivePage, { region: "US", cursor: listed.continueCursor, snapshot: true });
    expect(reports.isDone).toBe(true);
    const medicine = reports.page.find((row) => row.slug === "fda-d-0100-2026");
    expect(medicine).toMatchObject({ categories: ["Over-the-counter medicines"], superCategories: ["Baby", "Medical"] });
    expect((await t.query(api.incidents.getBySlug, { slug: "fda-d-0100-2026" }))?.status).toBe("reported");
    expect(listed.page.find((row) => row.slug === "biscuit-recall")?.superCategories).toEqual(["Food"]);

    const foodWarnings = await t.query(api.incidents.listActivePage, { region: "US", cursor: null, snapshot: true, foodOnly: true });
    expect(foodWarnings.page.map((row) => row.slug)).toEqual(["biscuit-recall"]);

    const checked = await t.query(api.incidents.getActivePage, { region: "US", cursor: null, snapshot: true });
    expect(checked.page.map((row) => row.slug)).toEqual(["biscuit-recall"]);
  });

  it("keeps legacy food projections available to food-only consumers", async () => {
    const t = createBackend();
    await t.mutation(internal.incidents.upsertBatch, { items: [food()] });
    await t.run(async (ctx) => {
      const row = await ctx.db.query("incidentMatchData").first();
      await ctx.db.patch(row!._id, { superCategories: undefined });
    });
    const listed = await t.query(api.incidents.listActivePage, { region: "US", cursor: null, snapshot: true, foodOnly: true });
    expect(listed.page).toHaveLength(1);
    expect(listed.page[0].superCategories).toEqual(["Food"]);
  });

  it("paginates across active food and multiple pages of historical reports without dropping or repeating records", async () => {
    const t = createBackend();
    const medicines = Array.from({ length: 101 }, (_, index) => ({ ...drug(), sourceId: `D-${index}-2026`, slug: `medicine-${index}` }));
    await t.mutation(internal.incidents.upsertBatch, { items: [food(), ...medicines] });
    const slugs: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
      const result: FunctionReturnType<typeof api.incidents.listActivePage> = await t.query(api.incidents.listActivePage, { region: "US", cursor, snapshot: true });
      slugs.push(...result.page.map((row) => row.slug));
      if (result.isDone) break;
      cursor = result.continueCursor;
    }
    expect(slugs).toHaveLength(102);
    expect(new Set(slugs).size).toBe(102);
    expect(slugs).toContain("biscuit-recall");
  });

  it("does not let the drug source gate food checks", async () => {
    const t = createBackend();
    await t.mutation(internal.incidents.beginRun, { source: "fda-drugs", sourceName: "FDA drug recalls", region: "US", scope: "test" });
    const status = await t.query(api.incidents.getDatasetStatus, { region: "US" });
    expect(status.sources.map((source) => source.id)).toEqual(["fda", "fda-announcements", "fsis"]);
  });
});
