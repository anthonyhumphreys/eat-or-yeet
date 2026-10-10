import { afterEach, describe, expect, it, vi } from "vitest";

import { fdaAnnouncementsSource, parseFdaAnnouncementDetail, parseFdaAnnouncementRows } from "@/lib/incidents/fda-announcements";
import { fdaSource, parseFdaRecord } from "@/lib/incidents/fda";
import { fsaSource, parseFsaDetail } from "@/lib/incidents/fsa";
import { fsisIncidentsForSync, parseFsisRecords } from "@/lib/incidents/fsis";
import gripeWaterRow from "./fixtures/fda-gripe-water.json";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function fsaDetail(notation: string, status = "Published") {
  return {
    notation,
    title: `Recall ${notation}`,
    created: "2026-10-01",
    modified: "2026-10-02T10:00:00Z",
    status: { label: status, notation: status.toLowerCase() },
    reportingBusiness: { commonName: "Example Foods" },
    description: "Affected food product.",
    consumerAdvice: "Do not eat the affected products.",
    problem: [{ riskStatement: "Potential contamination." }],
    productDetails: [],
  };
}

function fdaRecord(overrides: Record<string, unknown> = {}) {
  return {
    status: "Ongoing",
    classification: "Class I",
    country: "United States",
    recalling_firm: "Example Foods",
    recall_number: "F-1000-2026",
    event_id: "1000",
    product_description: "Example frozen meal",
    reason_for_recall: "Potential Listeria monocytogenes contamination",
    recall_initiation_date: "20260930",
    report_date: "20261001",
    code_info: "Lot code A12345; best before 12/2026",
    distribution_pattern: "Nationwide",
    ...overrides,
  };
}

function fsisRecord(overrides: Record<string, unknown> = {}) {
  return {
    field_title: "Example Foods Recalls Beef Stew Due to Possible Contamination",
    field_recall_number: "001-2026",
    field_recall_number_export: "001-2026",
    field_recall_url: "https://www.fsis.usda.gov/recalls-alerts/example-foods-recalls-beef-stew",
    field_recall_date: "2026-10-01",
    field_active_notice: "True",
    field_last_modified_date: "2026-10-02",
    field_product_items: ['12-oz. cans containing “Dinty Moore Beef Stew” with lot code T02045 and BEST BY FEB 2028'],
    field_establishment: ["Example Foods, Inc."],
    field_recall_reason: ["Possible wood contamination"],
    field_summary: "<p>Consumers should not consume the affected product.</p><p>The product should be thrown away or returned.</p>",
    field_risk_level: "High",
    field_recall_classification: "Class I",
    field_states: ["Nationwide"],
    langcode: "English",
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FSA official alert imports", () => {
  it("keeps each product's barcode, lot, and dates in its own group", () => {
    const incident = parseFsaDetail({
      ...fsaDetail("FSA-PRIN-01-2026"),
      productDetails: [
        {
          productName: "Widget A",
          productCode: "Barcode 5060253701906",
          batchDescription: [{ batchCode: "LOT-A-123", bestBeforeDescription: "30 Aug 2027" }],
        },
        {
          productName: "Widget B",
          productCode: "Barcode 5060253701913",
          batchDescription: [{ bestBeforeDescription: "31 Aug 2027" }],
        },
      ],
    });
    if (!incident) throw new Error("Expected the FSA detail fixture to produce an incident");
    const widgetA = incident.targets.filter((target) => target.groupId === "product-0-batch-0");
    const widgetB = incident.targets.filter((target) => target.groupId === "product-1-batch-0");

    expect(widgetA.map((target) => target.type)).toEqual(expect.arrayContaining(["product", "producer", "gtin", "batch"]));
    expect(widgetA.find((target) => target.type === "product")?.dateFrom?.toISOString()).toBe("2027-08-30T00:00:00.000Z");
    expect(widgetA.find((target) => target.type === "batch")?.value).toBe("LOT-A-123");
    expect(widgetB.map((target) => target.type)).toEqual(expect.arrayContaining(["product", "producer", "gtin"]));
    expect(widgetB.some((target) => target.type === "batch")).toBe(false);
    expect(widgetA[0].groupId).not.toBe(widgetB[0].groupId);
    expect(incident.endsAt).toBeNull();
    expect(incident.status).toBe("active");
  });

  it("uses dates on a product target when the source has no batch code", () => {
    const incident = parseFsaDetail({
      ...fsaDetail("FSA-PRIN-02-2026", "Withdrawn"),
      productDetails: [{
        productName: "Date-only product",
        batchDescription: [{ bestBeforeDescription: "Best before 12/2026" }],
      }],
    });
    if (!incident) throw new Error("Expected the FSA detail fixture to produce an incident");
    const product = incident.targets.find((target) => target.type === "product");

    expect(product?.dateFrom?.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(product?.dateTo?.toISOString()).toBe("2026-12-31T00:00:00.000Z");
    expect(incident.status).toBe("resolved");
    expect(incident.endsAt).toBeNull();
  });

  it("follows every official list page and fails if a listed detail is malformed", async () => {
    const originalFetch = globalThis.fetch;
    const listItems = Array.from({ length: 101 }, (_, index) => ({ notation: `FSA-AA-${index}` }));
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      calls.push(url.toString());
      if (url.pathname === "/food-alerts/id") {
        const offset = Number(url.searchParams.get("_offset"));
        const items = listItems.slice(offset, offset + 100);
        return jsonResponse({ meta: { limit: 100, offset }, items });
      }
      const notation = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
      return jsonResponse({ items: [fsaDetail(notation)] });
    }));

    const incidents = await fsaSource.fetchIncidents();
    expect(incidents).toHaveLength(101);
    expect(calls.filter((url) => new URL(url).pathname === "/food-alerts/id")).toHaveLength(4);
    expect(calls.filter((url) => new URL(url).pathname !== "/food-alerts/id")).toHaveLength(101);

    let scanCount = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname !== "/food-alerts/id") throw new Error("Details should not be fetched from an unstable FSA listing");
      const offset = Number(url.searchParams.get("_offset"));
      if (offset === 0) scanCount += 1;
      const currentItems = scanCount % 2 === 1 ? listItems : listItems.slice(0, 100);
      return jsonResponse({ meta: { limit: 100, offset }, items: currentItems.slice(offset, offset + 100) });
    }));
    await expect(fsaSource.fetchIncidents()).rejects.toThrow(/listing remained inconsistent/);

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/food-alerts/id") return jsonResponse({ meta: { limit: 100, offset: 0 }, items: [{ notation: "FSA-AA-BAD" }] });
      return jsonResponse({ items: [] });
    }));
    await expect(fsaSource.fetchIncidents()).rejects.toThrow(/detail import failed/);
    globalThis.fetch = originalFetch;
  });
});

describe("FDA enforcement report imports", () => {
  it("derives a stable key for a legacy empty ID and preserves an official recall number", () => {
    const legacyRecord = fdaRecord({
      recall_number: "",
      event_id: "99453",
      recalling_firm: "MARKON",
      product_description: "MARKON salad",
      report_date: "20260819",
    });

    expect(parseFdaRecord(legacyRecord).sourceId).toBe("unclassified-20260819-markon-markon-salad");
    expect(parseFdaRecord(fdaRecord({ recall_number: "F-1000-2026" })).sourceId).toBe("F-1000-2026");
  });

  it("maps only explicit completed/terminated statuses to resolved", () => {
    expect(parseFdaRecord(fdaRecord({ status: "Ongoing" })).status).toBe("active");
    expect(parseFdaRecord(fdaRecord({ status: "Completed" })).status).toBe("resolved");
    expect(parseFdaRecord(fdaRecord({ status: "Terminated" })).status).toBe("resolved");
    expect(parseFdaRecord(fdaRecord({ status: "Unrecognised" })).status).toBe("active");

    const incident = parseFdaRecord(fdaRecord());
    expect(incident.targets.some((target) => target.type === "country")).toBe(false);
    expect(incident.targets.find((target) => target.type === "lot")?.notes).toContain("Affected date information:");
    expect(incident.endsAt).toBeNull();
  });

  it("fetches every openFDA ongoing page and checks a previously active recall's status", async () => {
    const records = Array.from({ length: 1_066 }, (_, index) => fdaRecord({
      recall_number: `F-${String(index).padStart(4, "0")}-2026`,
      event_id: String(index),
    }));
    const calls: URL[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      calls.push(url);
      const search = url.searchParams.get("search") ?? "";
      if (search.includes("status:")) {
        const skip = Number(url.searchParams.get("skip"));
        const limit = Number(url.searchParams.get("limit"));
        return jsonResponse({
          meta: { results: { skip, limit, total: records.length } },
          results: records.slice(skip, skip + limit),
        });
      }
      return jsonResponse({ results: [fdaRecord({ status: "Completed", recall_number: "F-OLD-2024" })] });
    }));

    const incidents = await fdaSource.fetchIncidents(["F-0000-2026", "F-OLD-2024"]);
    expect(incidents).toHaveLength(1_067);
    expect(incidents.find((incident) => incident.sourceId === "F-OLD-2024")?.status).toBe("resolved");
    expect(calls.filter((url) => (url.searchParams.get("search") ?? "").includes("status:"))).toHaveLength(2);
    expect(calls.some((url) => (url.searchParams.get("search") ?? "").includes("recall_number:"))).toBe(true);
  });

  it("fails on missing FDA status lookups instead of silently dropping active recalls", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if ((url.searchParams.get("search") ?? "").includes("status:")) {
        return jsonResponse({ meta: { results: { skip: 0, limit: 1_000, total: 0 } }, results: [] });
      }
      return jsonResponse({ error: { code: "NOT_FOUND", message: "No matches found!" } }, 404);
    }));

    await expect(fdaSource.fetchIncidents(["F-OLD-2024"])).rejects.toThrow(/status lookup failed/);
  });

  it("preserves a legacy synthetic warning when its current ongoing record gains an official number", async () => {
    const legacyRecord = fdaRecord({
      recall_number: "",
      event_id: "99453",
      recalling_firm: "Taylor Farms",
      product_description: "Iceberg, Romaine Lettuce Mix 80/20 with Separate Baggies",
      report_date: "20260819",
      code_info: "Lot code 12345",
    });
    const legacyId = "unclassified-20260819-taylor-farms-iceberg";
    const currentRecord = { ...legacyRecord, recall_number: "H-1298-2026" };
    const calls: URL[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      calls.push(url);
      const limit = Number(url.searchParams.get("limit"));
      return jsonResponse({
        meta: { results: { skip: 0, limit, total: 1 } },
        results: [currentRecord],
      });
    }));

    const incidents = await fdaSource.fetchIncidents([legacyId]);

    expect(incidents.map((incident) => incident.sourceId)).toEqual(["H-1298-2026"]);
    expect(calls).toHaveLength(1);
    expect(calls[0].searchParams.get("search")).toContain('status:"Ongoing"');
  });

  it("matches a historical split-key alias to a unique ongoing record without an official number", async () => {
    const currentRecord = fdaRecord({
      recall_number: "",
      event_id: "99454",
      recalling_firm: "Unilever",
      product_description: "ALMOND JOY ICE CREAM BAR; 6 COUNT CARTON",
      report_date: "20260819",
    });
    const calls: URL[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      calls.push(url);
      const limit = Number(url.searchParams.get("limit"));
      return jsonResponse({
        meta: { results: { skip: 0, limit, total: 1 } },
        results: [currentRecord],
      });
    }));

    const incidents = await fdaSource.fetchIncidents([
      "unclassified-20260819-unilever-almond-joy-ice-cream-bar",
    ]);

    expect(incidents.map((incident) => incident.sourceId)).toEqual([
      "unclassified-20260819-unilever-almond-joy-ice-cream-bar-6-count-carton",
    ]);
    expect(incidents[0].status).toBe("active");
    expect(calls).toHaveLength(1);
  });

  it("fails closed when a legacy synthetic key matches multiple current recalls", async () => {
    const sharedIdentity = {
      recalling_firm: "Taylor Farms",
      product_description: "MARKON BLEND LETT/ROM 80/20 WITH SEP BAGGIES",
      report_date: "20260819",
    };
    const legacyId = parseFdaRecord(fdaRecord({ ...sharedIdentity, recall_number: "" })).sourceId;
    const records = [
      fdaRecord({ ...sharedIdentity, recall_number: "H-1298-2026" }),
      fdaRecord({ ...sharedIdentity, recall_number: "H-1299-2026" }),
    ];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const limit = Number(url.searchParams.get("limit"));
      return jsonResponse({
        meta: { results: { skip: 0, limit, total: records.length } },
        results: records,
      });
    }));

    await expect(fdaSource.fetchIncidents([legacyId])).rejects.toThrow(/ambiguously matches multiple ongoing recalls/);
  });

  it("fails closed when a legacy synthetic key has no current official match", async () => {
    const legacyId = parseFdaRecord(fdaRecord({ recall_number: "" })).sourceId;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const limit = Number(url.searchParams.get("limit"));
      return jsonResponse({
        meta: { results: { skip: 0, limit, total: 1 } },
        results: [fdaRecord({ recall_number: "H-1298-2026", recalling_firm: "Different Firm" })],
      });
    }));

    await expect(fdaSource.fetchIncidents([legacyId])).rejects.toThrow(/without its official recall number/);
  });
});

describe("FDA announcement imports", () => {
  const listingRow = (index: number) => [
    `<time datetime="2026-08-22T04:00:00Z">08/22/2026</time>`,
    `<a href="/safety/recalls-market-withdrawals-safety-alerts/recall-${index}">Example Brand</a>`,
    "Alfalfa Sprouts",
    "Food &amp; Beverages, Foodborne Illness",
    "Potential contamination with Salmonella",
    "Example Foods LLC",
    "",
    "",
  ];

  it("imports both FDA listings and fetches cross-listed notices only once", async () => {
    const settings = `<script type="application/json" data-drupal-selector="drupal-settings-json">${JSON.stringify({
      datatables: { recalls: { ajax: { data: { view_name: "recall_solr_index" } } } },
    })}</script>`;
    const crossListed = listingRow(1);
    crossListed[3] = "Food &amp; Beverages, Dietary Supplements";
    const calls: URL[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      calls.push(url);
      if (url.pathname === INDEX_PATH_FOR_TEST) return new Response(settings);
      if (url.pathname === "/datatables/views/ajax") {
        const type = url.searchParams.get("field_regulated_product_field");
        if (type !== "2323" && type !== "2305") throw new Error(`Unexpected FDA product type ${type}`);
        const data = type === "2323" ? [listingRow(0), crossListed] : [gripeWaterRow, crossListed];
        return jsonResponse({ draw: Number(url.searchParams.get("draw")), recordsTotal: data.length, recordsFiltered: data.length, data });
      }
      return new Response('<h2 id="recall-announcement">Company Announcement</h2><p>Consumers should stop using the affected lot.</p>');
    }));

    const incidents = await fdaAnnouncementsSource.fetchIncidents();
    expect(incidents).toHaveLength(3);
    expect(incidents).toContainEqual(expect.objectContaining({
      originalSourceData: expect.objectContaining({ company: "Pacific Health Sciences", productType: "Dietary Supplements" }),
    }));
    const listingCalls = calls.filter((url) => url.pathname === "/datatables/views/ajax");
    expect(listingCalls.map((url) => url.searchParams.get("field_regulated_product_field")).sort()).toEqual(["2305", "2323"]);
    const detailCalls = calls.filter((url) => url.pathname !== INDEX_PATH_FOR_TEST && url.pathname !== "/datatables/views/ajax");
    expect(detailCalls).toHaveLength(3);
    expect(new Set(detailCalls.map((url) => url.pathname)).size).toBe(3);
  });

  it("rejects an incomplete supplement listing before fetching any detail pages", async () => {
    const settings = `<script type="application/json" data-drupal-selector="drupal-settings-json">${JSON.stringify({
      datatables: { recalls: { ajax: { data: { view_name: "recall_solr_index" } } } },
    })}</script>`;
    const detailFetch = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === INDEX_PATH_FOR_TEST) return new Response(settings);
      if (url.pathname === "/datatables/views/ajax") {
        const supplement = url.searchParams.get("field_regulated_product_field") === "2305";
        return jsonResponse({ draw: Number(url.searchParams.get("draw")), recordsTotal: supplement ? 2 : 1, recordsFiltered: supplement ? 2 : 1, data: supplement ? [gripeWaterRow] : [listingRow(0)] });
      }
      detailFetch();
      return new Response('<h2 id="recall-announcement">Company Announcement</h2><p>Consumers should stop using the affected lot.</p>');
    }));

    await expect(fdaAnnouncementsSource.fetchIncidents()).rejects.toThrow(/remained incomplete after 3 attempts/);
    expect(detailFetch).not.toHaveBeenCalled();
  });

  it("keeps separate GTIN and lot groups and has no synthetic 180-day expiry", () => {
    const [listing] = parseFdaAnnouncementRows({ data: [listingRow(1)] });
    const incident = parseFdaAnnouncementDetail(listing, `
      <h2 id="recall-announcement">Company Announcement</h2>
      <p>The recalled packages bear UPC: 860014523113 and UPC 860014523120.</p>
      <p>Affected packages have lot numbers: LOT #222, 223, 225.</p>
      <p>Consumers should immediately dispose of affected sprouts.</p>
      <h2>Company Contact Information</h2>
    `);
    const gtins = incident.targets.filter((target) => target.type === "gtin");
    const lots = incident.targets.filter((target) => target.type === "lot");

    expect(gtins).toHaveLength(2);
    expect(lots).toHaveLength(3);
    expect(new Set(gtins.map((target) => target.groupId)).size).toBe(2);
    expect(new Set(lots.map((target) => target.groupId)).size).toBe(3);
    expect(gtins.every((gtin) => lots.every((lot) => gtin.groupId !== lot.groupId))).toBe(true);
    expect(incident.endsAt).toBeNull();
    expect(incident.status).toBe("active");
  });

  it("requests a complete FDA table snapshot, expands its limit, and rejects partial rows", async () => {
    const settings = `<script type="application/json" data-drupal-selector="drupal-settings-json">${JSON.stringify({
      datatables: { recalls: { ajax: { data: { view_name: "recall_solr_index", view_path: INDEX_PATH_FOR_TEST } } } },
    })}</script>`;
    const calls: URL[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      calls.push(url);
      if (url.pathname === INDEX_PATH_FOR_TEST) return new Response(settings, { headers: { "content-type": "text/html" } });
      if (url.pathname === "/datatables/views/ajax") {
        const draw = Number(url.searchParams.get("draw"));
        if (url.searchParams.get("field_regulated_product_field") === "2305") return jsonResponse({ draw, recordsTotal: 0, recordsFiltered: 0, data: [] });
        return jsonResponse({ draw, recordsTotal: 2, recordsFiltered: 2, data: [listingRow(0), listingRow(1)] });
      }
      return new Response(`
        <h2 id="recall-announcement">Company Announcement</h2>
        <p>Consumers should dispose of the affected sprouts.</p>
      `, { headers: { "content-type": "text/html" } });
    }));

    const incidents = await fdaAnnouncementsSource.fetchIncidents();
    expect(incidents).toHaveLength(2);
    const listingCalls = calls.filter((url) => url.pathname === "/datatables/views/ajax");
    expect(listingCalls).toHaveLength(2);
    expect(listingCalls.every((url) => url.searchParams.get("length") === "1000")).toBe(true);

    let draw = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === INDEX_PATH_FOR_TEST) return new Response(settings);
      if (url.pathname === "/datatables/views/ajax") {
        draw = Number(url.searchParams.get("draw"));
        if (url.searchParams.get("field_regulated_product_field") === "2305") return jsonResponse({ draw, recordsTotal: 0, recordsFiltered: 0, data: [] });
        const length = Number(url.searchParams.get("length"));
        if (length === 1000) {
          return jsonResponse({
            draw,
            recordsTotal: 1_001,
            recordsFiltered: 1_001,
            data: Array.from({ length: 1_000 }, (_, index) => listingRow(index)),
          });
        }
        return jsonResponse({
          draw,
          recordsTotal: 1_001,
          recordsFiltered: 1_001,
          data: Array.from({ length: 1_001 }, (_, index) => listingRow(index)),
        });
      }
      return new Response("unavailable", { status: 503 });
    }));
    const expandedError = await fdaAnnouncementsSource.fetchIncidents().catch((error: unknown) => error);
    expect(expandedError).toMatchObject({ message: expect.stringMatching(/detail import failed/) });
    const expandedCalls = vi.mocked(globalThis.fetch).mock.calls
      .map(([input]) => new URL(String(input)))
      .filter((url) => url.pathname === "/datatables/views/ajax" && url.searchParams.get("field_regulated_product_field") === "2323");
    expect(expandedCalls.map((url) => url.searchParams.get("length"))).toEqual(["1000", "1001"]);

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === INDEX_PATH_FOR_TEST) return new Response(settings);
      if (url.pathname === "/datatables/views/ajax") return jsonResponse({ draw: Number(url.searchParams.get("draw")), recordsTotal: 2, recordsFiltered: 2, data: [listingRow(1)] });
      throw new Error("Details should not be requested from an incomplete listing response");
    }));
    await expect(fdaAnnouncementsSource.fetchIncidents()).rejects.toThrow(/remained incomplete after 3 attempts/);

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === INDEX_PATH_FOR_TEST) return new Response(settings);
      if (url.pathname === "/datatables/views/ajax") return jsonResponse({ draw: 1, recordsTotal: 1, recordsFiltered: 1, data: [listingRow(1)] });
      return new Response("unavailable", { status: 503 });
    }));
    await expect(fdaAnnouncementsSource.fetchIncidents()).rejects.toThrow(/detail import failed/);
  });
});

describe("FSIS Recall API imports", () => {
  it("stores active notices and tracked closures without importing unused resolved history", () => {
    const active = fsisRecord();
    const closed = fsisRecord({ field_active_notice: "False", field_recall_url: "https://www.fsis.usda.gov/recalls-alerts/closed-recall" });
    const historical = fsisRecord({ field_active_notice: "False", field_recall_url: "https://www.fsis.usda.gov/recalls-alerts/historical-recall" });
    const incidents = fsisIncidentsForSync([active, closed, historical], ["/recalls-alerts/closed-recall"]);

    expect(incidents).toHaveLength(2);
    expect(incidents.map((item) => item.status)).toEqual(["active", "resolved"]);
    expect(incidents.some((item) => item.sourceId.endsWith("historical-recall"))).toBe(false);
  });

  it("rejects a snapshot missing a previously active notice before applying changes", () => {
    expect(() => fsisIncidentsForSync([fsisRecord()], ["/recalls-alerts/missing-recall"])).toThrow("incomplete refresh");
  });

  it("validates resolved history as well as current notices", () => {
    expect(() => fsisIncidentsForSync([fsisRecord(), fsisRecord({ field_active_notice: "False", field_recall_date: "invalid" })])).toThrow("recall date");
  });

  it("keeps only English notices, retains status, and groups exact product-line lots with dates", () => {
    const english = fsisRecord();
    const spanish = fsisRecord({
      field_title: "Ejemplo retira estofado de res",
      field_recall_url: "https://www.fsis.usda.gov/es/retirada/ejemplo",
      langcode: "Spanish",
    });
    const [incident] = parseFsisRecords([english, spanish]);
    const product = incident.targets.find((target) => target.type === "product");
    const lot = incident.targets.find((target) => target.type === "lot");

    expect(incident.sourceId).toContain("example-foods-recalls-beef-stew");
    expect(incident.status).toBe("active");
    expect(incident.endsAt).toBeNull();
    expect(product?.groupId).toBe(lot?.groupId);
    expect(lot?.value).toBe("T02045");
    expect(lot?.dateFrom?.toISOString()).toBe("2028-02-01T00:00:00.000Z");
    expect(incident.consumerAdvice).toContain("should not consume");

    expect(parseFsisRecords([fsisRecord({ field_active_notice: "False" })])[0].status).toBe("resolved");
    expect(parseFsisRecords([fsisRecord({ field_active_notice: "" })])[0].status).toBe("active");
    const olderRecall = parseFsisRecords([fsisRecord({ field_last_modified_date: "" })])[0];
    expect(olderRecall.updatedAt.toISOString()).toBe(olderRecall.publishedAt.toISOString());
  });
});

const INDEX_PATH_FOR_TEST = "/safety/recalls-market-withdrawals-safety-alerts";
