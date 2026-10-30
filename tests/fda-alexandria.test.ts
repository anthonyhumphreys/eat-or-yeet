import { afterEach, describe, expect, it, vi } from "vitest";

import { internal } from "@backend/api";
import { createFdaSource, parseFdaRecord } from "@/lib/incidents/fda";
import { fetchAlexandriaFdaRecall } from "@/lib/incidents/fda-alexandria";
import { serialiseSourceIncident } from "@/lib/incidents/serialise";
import { createBackend } from "./backend-harness";

const key = "fc-private-fixture";
const number = "F-1000-2026";
const record = { status: "Terminated", recalling_firm: "Fixture firm", recall_number: number,
  product_description: "Fixture food", reason_for_recall: "Undeclared milk", recall_initiation_date: "20260101", report_date: "20260107", code_info: "Lot 123" };
const sourceUrl = (limit: number) => `https://api.fda.gov/food/enforcement.json?search=${encodeURIComponent(`recall_number:"${number}"`)}&skip=0&limit=${limit}`;
function result() {
  return { success: true, data: { creditsCost: 5, alexandria: [{ provider: "fda-gov", capability: "records/food_recalls", creditsCost: 5,
    records: 1, upstreamStatus: 200, data: { dataset: "food_recalls", total_matching: 1, skip: 0, next_skip: null,
      pagination_truncated: false, source_url: sourceUrl(2), records: [{ record_id: number, source_url: sourceUrl(1), data: record }] } }] } };
}
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("FDA Alexandria lookup boundary", () => {
  it("retrieves exactly one numbered food recall and preserves its original payload", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(result()));
    vi.stubGlobal("fetch", fetcher);
    expect(await fetchAlexandriaFdaRecall(number, key)).toEqual(record);
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://api.firecrawl.dev/v2/scrape");
    expect(init.redirect).toBe("manual");
    expect(init.headers.Authorization).toBe(`Bearer ${key}`);
    expect(init.headers["x-request-id"]).toMatch(/^[a-f0-9-]{36}$/);
    expect(JSON.parse(init.body)).toEqual({ alexandria: { provider: "fda-gov", capability: "records/food_recalls", options: { record_id: number, limit: 2 } } });
  });

  it.each(["", 'bad" OR status:Ongoing', "x".repeat(101)])("rejects an invalid identifier before calling Firecrawl", async id => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(fetchAlexandriaFdaRecall(id, key)).rejects.toThrow("recall number");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    (r: ReturnType<typeof result>) => { r.data.alexandria[0].data.total_matching = 2; },
    (r: ReturnType<typeof result>) => { r.data.alexandria[0].data.pagination_truncated = true; },
    (r: ReturnType<typeof result>) => { r.data.alexandria[0].upstreamStatus = 206; },
    (r: ReturnType<typeof result>) => { r.data.alexandria[0].data.records[0].record_id = "F-OTHER"; },
    (r: ReturnType<typeof result>) => { r.data.alexandria[0].data.records[0].data = { ...record, recall_number: "F-OTHER" }; },
    (r: ReturnType<typeof result>) => { r.data.alexandria[0].data.source_url = "https://example.com"; },
    (r: ReturnType<typeof result>) => { r.data.alexandria[0].data.records[0].source_url = sourceUrl(1) + "&api_key=private"; },
    (r: ReturnType<typeof result>) => { r.data.creditsCost = 10; },
  ])("rejects incomplete, ambiguous, mismatched or unexpectedly priced results", async mutate => {
    const payload = result(); mutate(payload);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(payload)));
    await expect(fetchAlexandriaFdaRecall(number, key)).rejects.toThrow("invalid, incomplete or mismatched");
  });

  it("does not expose vendor errors or retry a paid call", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error(key)); vi.stubGlobal("fetch", fetcher);
    await expect(fetchAlexandriaFdaRecall(number, key)).rejects.toThrow(/^FDA Alexandria fallback request failed; check connectivity and credentials$/);
    expect(fetcher).toHaveBeenCalledOnce();
    fetcher.mockResolvedValue(Response.json({ success: true, data: { alexandria: [{ error: { message: key } }] } }));
    await expect(fetchAlexandriaFdaRecall(number, key)).rejects.toThrow(/^FDA Alexandria fallback returned an invalid, incomplete or mismatched response$/);
  });
});

describe("API-first FDA enforcement imports", () => {
  function directFeed(lookup: Response) {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => new URL(String(input)).searchParams.get("search")?.startsWith("status:")
      ? Response.json({ meta: { results: { skip: 0, limit: 1000, total: 0 } }, results: [] }) : lookup.clone());
    vi.stubGlobal("fetch", fetcher);
    return fetcher;
  }

  it("does not call the fallback for a successful official lookup", async () => {
    directFeed(Response.json({ results: [record] }));
    const fallback = vi.fn();
    expect(await createFdaSource(fallback).fetchIncidents([number])).toEqual([parseFdaRecord(record)]);
    expect(fallback).not.toHaveBeenCalled();
  });

  it("uses the same parser and source identity after a failed individual API lookup", async () => {
    directFeed(new Response("Blocked", { status: 401 }));
    const fallback = vi.fn().mockResolvedValue(record);
    expect(await createFdaSource(fallback).fetchIncidents([number])).toEqual([parseFdaRecord(record)]);
    expect(fallback).toHaveBeenCalledExactlyOnceWith(number);
  });

  it("never turns bulk API failure into an Alexandria collection", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Blocked", { status: 401 })));
    const fallback = vi.fn();
    await expect(createFdaSource(fallback).fetchIncidents([number])).rejects.toThrow("HTTP 401");
    expect(fallback).not.toHaveBeenCalled();
  });

  it("fails the import when fallback status cannot be verified", async () => {
    directFeed(new Response("Blocked", { status: 401 }));
    await expect(createFdaSource(async () => { throw new Error("Budget exhausted"); }).fetchIncidents([number])).rejects.toThrow("Budget exhausted");
    await expect(createFdaSource(async () => ({ ...record, recall_number: "F-OTHER" })).fetchIncidents([number])).rejects.toThrow("different recall");
    await expect(createFdaSource(async () => ({ ...record, report_date: key })).fetchIncidents([number])).rejects.toThrow("FDA fallback lookup returned an invalid recall record");
  });
});

describe("durable Alexandria spending cap", () => {
  async function seededBackend() {
    const t = createBackend();
    await t.mutation(internal.incidents.upsertBatch, { items: [{ ...serialiseSourceIncident(parseFdaRecord({ ...record, status: "Ongoing" })), sourceKey: "fda" }] });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "https://api.firecrawl.dev/v2/scrape") return Response.json(result());
      return new URL(String(input)).searchParams.get("search")?.startsWith("status:")
        ? Response.json({ meta: { results: { skip: 0, limit: 1000, total: 0 } }, results: [] })
        : new Response("Blocked", { status: 401 });
    }));
    return t;
  }

  it("wires the opt-in Worker fallback through the shared budget", async () => {
    const t = await seededBackend();
    vi.stubEnv("FDA_ALEXANDRIA_FALLBACK", "true"); vi.stubEnv("FIRECRAWL_API_KEY", key);
    expect(await t.action(internal.incidents.refreshSourceInternal, { sourceId: "fda" })).toMatchObject({ status: "queued", found: 1 });
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes("firecrawl"))).toHaveLength(1);
    expect(await t.run(ctx => ctx.db.query("rateLimits").collect())).toMatchObject([{ count: 5, action: "firecrawl_alexandria" }]);
  });

  it("fails coverage without a paid request when the cap is exhausted", async () => {
    const t = await seededBackend();
    vi.stubEnv("FDA_ALEXANDRIA_FALLBACK", "true"); vi.stubEnv("FIRECRAWL_API_KEY", key);
    for (let index = 0; index < 20; index++) await t.mutation(internal.incidents.reserveFdaAlexandriaLookup, {});
    expect(await t.action(internal.incidents.refreshSourceInternal, { sourceId: "fda" })).toMatchObject({ status: "failed", errors: [expect.stringContaining("daily fallback budget exhausted")] });
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes("firecrawl"))).toHaveLength(0);
    expect(await t.run(ctx => ctx.db.query("incidents").collect())).toMatchObject([{ status: "active" }]);
  });

  it("leaves fallback disabled without its explicit Worker flag", async () => {
    const t = await seededBackend();
    vi.stubEnv("FDA_ALEXANDRIA_FALLBACK", "false"); vi.stubEnv("FIRECRAWL_API_KEY", key);
    expect(await t.action(internal.incidents.refreshSourceInternal, { sourceId: "fda" })).toMatchObject({ status: "failed" });
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes("firecrawl"))).toHaveLength(0);
    expect(await t.run(ctx => ctx.db.query("rateLimits").collect())).toEqual([]);
  });

  it("shares the 100-credit UTC daily budget across concurrent reservations and resets the next day", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-30T23:59:00Z"));
    const t = createBackend();
    const outcomes = await Promise.all(Array.from({ length: 24 }, () => t.mutation(internal.incidents.reserveFdaAlexandriaLookup, {})));
    expect(outcomes.filter(x => x.allowed)).toHaveLength(20);
    expect(await t.mutation(internal.incidents.reserveFdaAlexandriaLookup, {})).toMatchObject({ allowed: false, used: 100, limit: 100 });
    vi.setSystemTime(new Date("2026-10-31T00:00:00Z"));
    expect(await t.mutation(internal.incidents.reserveFdaAlexandriaLookup, {})).toMatchObject({ allowed: true, used: 5 });
  });
});
