import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../backend/api";
import { createBackend } from "./backend-harness";
import { fetchFdaAnnouncementDetail, parseFdaAnnouncementDetail } from "../src/lib/incidents/fda-announcements";
import { monitorRequest, FDA_LISTING_URL } from "../src/lib/incidents/firecrawl-monitor";
import { serialiseSourceIncident } from "../src/lib/incidents/serialise";

vi.mock("../src/lib/incidents/fda-announcements", async original => ({ ...await original<typeof import("../src/lib/incidents/fda-announcements")>(), fetchFdaAnnouncementDetail: vi.fn() }));
vi.mock("../src/lib/incidents/firecrawl-monitor", async original => ({ ...await original<typeof import("../src/lib/incidents/firecrawl-monitor")>(), monitorRequest: vi.fn() }));
const monitorId = "00000000-0000-4000-8000-000000000001";
const listing = { path: "/safety/recalls-market-withdrawals-safety-alerts/monitor-fixture", publishedAt: new Date("2026-10-01").getTime(),
  brand: "Fixture", product: "Fixture food", productType: "Food & Beverages", company: "Fixture Foods", reason: "Undeclared milk", terminated: false, terminationStatus: "" };
const html = '<h2 id="recall-announcement">Company Announcement</h2><p>Consumers should return the product.</p><h2>Contact</h2>';
const url = `https://www.fda.gov${listing.path}`;
const parsed = () => parseFdaAnnouncementDetail({ ...listing, publishedAt: new Date(listing.publishedAt) }, html);
function event(status: "changed" | "new" | "same" | "removed" = "changed", target = url, id = crypto.randomUUID()) {
  return { type: "monitor.page" as const, id, data: [{ monitorId, checkId: id, url: target, status }] };
}
function backend() {
  const objects = new Map<string, string>();
  const t = createBackend({ get: async key => objects.has(key) ? new Blob([objects.get(key)!]) : null,
    put: async (key, body) => { objects.set(key, body); }, delete: async key => { objects.delete(key); } });
  return { ...t, async listing(version: number, full = false, rows = [listing], fetchedAt = Date.now()) {
    const storageId = crypto.randomUUID(); objects.set(storageId, JSON.stringify(rows));
    return t.action(internal.fdaMonitor.acceptListing, { storageId, fetchedAt, version, full });
  } };
}
beforeEach(() => {
  vi.stubEnv("FDA_MONITOR_ENABLED", "true"); vi.stubEnv("FDA_MONITOR_ID", monitorId);
  vi.stubEnv("FDA_ANNOUNCEMENTS_FETCH_MODE", "firecrawl"); vi.stubEnv("FIRECRAWL_API_KEY", "private-fixture-key");
  vi.mocked(fetchFdaAnnouncementDetail).mockImplementation(async () => parsed());
  vi.mocked(monitorRequest).mockResolvedValue({ success: true, data: { id: monitorId, name: "Eat or Yeet FDA announcements", targets: [{ id: monitorId, type: "scrape", urls: [FDA_LISTING_URL, url] }] } });
});
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("FDA Monitor incremental imports", () => {
  it("commits and deduplicates receipt, waits for fresh listing metadata, and imports without renewing full source health", async () => {
    const t = backend(); const input = event();
    await t.mutation(internal.fdaMonitor.receive, { event: input });
    await t.mutation(internal.fdaMonitor.receive, { event: input });
    expect(await t.query(internal.fdaMonitor.getStatus, {})).toMatchObject({ requestedVersion: 1, fulfilledVersion: 0, pending: 1 });
    await t.action(internal.fdaMonitor.processNotice, { path: listing.path });
    expect(fetchFdaAnnouncementDetail).not.toHaveBeenCalled();
    await t.listing(1); await t.finishAllScheduledFunctions();
    expect(fetchFdaAnnouncementDetail).toHaveBeenCalledTimes(1);
    expect(await t.run(ctx => ctx.db.query("incidents").collect())).toMatchObject([{ sourceId: `announcement:${listing.path}`, summary: "Consumers should return the product." }]);
    expect(await t.run(ctx => ctx.db.query("ingestionRuns").collect())).toEqual([]);
    expect(await t.query(internal.fdaMonitor.getStatus, {})).toMatchObject({ pending: 0, fulfilledVersion: 1 });
    expect((await t.query(api.incidents.getDatasetStatus, { region: "US" })).healthy).toBe(false);
  });

  it("ignores unchanged checks and initial observations of already imported notices", async () => {
    const t = backend();
    await t.mutation(internal.incidents.upsertBatch, { items: [{ ...serialiseSourceIncident(parsed()), sourceKey: "fda-announcements" }] });
    await t.mutation(internal.fdaMonitor.receive, { event: event("same") });
    await t.mutation(internal.fdaMonitor.receive, { event: event("new") });
    expect(await t.query(internal.fdaMonitor.getStatus, {})).toMatchObject({ requestedVersion: 0, pending: 0 });
    expect(fetchFdaAnnouncementDetail).not.toHaveBeenCalled();
  });

  it("discovers new food notices from a listing change and preserves warnings when a URL leaves the food listing", async () => {
    const t = backend();
    await t.listing(0, true); // Bootstrap metadata without importing or buying details.
    await t.mutation(internal.fdaMonitor.receive, { event: event("changed", FDA_LISTING_URL) });
    const second = { ...listing, path: listing.path + "-new", product: "New food" };
    vi.mocked(fetchFdaAnnouncementDetail).mockImplementation(async item => parseFdaAnnouncementDetail(item, html));
    await t.listing(1, false, [listing, second]); await t.finishAllScheduledFunctions();
    expect(fetchFdaAnnouncementDetail).toHaveBeenCalledTimes(1);
    expect((await t.run(ctx => ctx.db.query("incidents").collect()))[0].sourceId).toBe(`announcement:${second.path}`);
    await t.mutation(internal.fdaMonitor.receive, { event: event("removed", `https://www.fda.gov${second.path}`) });
    await t.listing(2, false, [listing]); await t.finishAllScheduledFunctions();
    expect((await t.run(ctx => ctx.db.query("incidents").collect()))[0].status).toBe("active");
    expect(await t.query(internal.fdaMonitor.getStatus, {})).toMatchObject({ pending: 0 });
  });

  it("does not repeat an uncertain paid request and leaves failed work pending for reconciliation", async () => {
    const t = backend();
    await t.mutation(internal.fdaMonitor.receive, { event: event() });
    vi.mocked(fetchFdaAnnouncementDetail).mockRejectedValue(new Error("private vendor response"));
    await t.listing(1); await t.finishAllScheduledFunctions();
    await t.action(internal.fdaMonitor.processNotice, { path: listing.path });
    expect(fetchFdaAnnouncementDetail).toHaveBeenCalledTimes(1);
    expect(await t.query(internal.fdaMonitor.getStatus, {})).toMatchObject({ pending: 1 });
    expect(await t.run(ctx => ctx.db.query("fdaMonitorNotices").first())).toMatchObject({ lastError: "FDA Monitor retrieval failed; awaiting reconciliation" });
  });

  it("reserves the daily retrieval cap atomically before a paid request", async () => {
    const t = backend();
    const second = { ...listing, path: listing.path + "-second" };
    await t.mutation(internal.fdaMonitor.receive, { event: event() });
    await t.mutation(internal.fdaMonitor.receive, { event: event("changed", `https://www.fda.gov${second.path}`) });
    await t.listing(2, false, [listing, second]);
    const day = Math.floor(Date.now() / 86_400_000) * 86_400_000;
    await t.run(ctx => ctx.db.insert("rateLimits", { key: `firecrawl:monitor:fda:${day}`, subjectHash: "fda-monitor", action: "firecrawl_monitor", count: 99, windowStartedAt: day, expiresAt: day + 86_400_000 }));
    const claims = await Promise.all([t.mutation(internal.fdaMonitor.claimNotice, { path: listing.path }), t.mutation(internal.fdaMonitor.claimNotice, { path: second.path })]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await t.run(ctx => ctx.db.query("rateLimits").first())).toMatchObject({ count: 100 });
    expect(fetchFdaAnnouncementDetail).not.toHaveBeenCalled();
  });

  it("keeps a later event pending when an older requested listing arrives", async () => {
    vi.useFakeTimers();
    const t = backend();
    await t.mutation(internal.fdaMonitor.receive, { event: event() });
    await t.mutation(internal.fdaMonitor.receive, { event: event() });
    await t.listing(1); await t.finishAllScheduledFunctions();
    expect(fetchFdaAnnouncementDetail).not.toHaveBeenCalled();
    expect(await t.query(internal.fdaMonitor.getStatus, {})).toMatchObject({ pending: 1, requestedVersion: 2, fulfilledVersion: 1 });
    vi.setSystemTime(Date.now() + 1);
    await t.listing(2); await t.finishAllScheduledFunctions();
    expect(fetchFdaAnnouncementDetail).toHaveBeenCalledTimes(1);
  });

  it("discards an in-flight result superseded by a later event", async () => {
    const t = backend();
    await t.mutation(internal.fdaMonitor.receive, { event: event() }); await t.listing(1);
    const work = await t.mutation(internal.fdaMonitor.claimNotice, { path: listing.path });
    expect(work).not.toBeNull();
    await t.mutation(internal.fdaMonitor.receive, { event: event() });
    expect(await t.mutation(internal.fdaMonitor.applyNotice, { path: listing.path, revision: work!.revision, fetchedAt: work!.fetchedAt, startedAt: work!.startedAt,
      item: { ...serialiseSourceIncident(parsed()), sourceKey: "fda-announcements" } })).toEqual({ applied: false });
    expect(await t.run(ctx => ctx.db.query("incidents").collect())).toEqual([]);
  });

  it("prevents an older full snapshot from overwriting a newer incremental record", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-10T12:00:00Z"));
    const t = backend();
    const runId = await t.mutation(internal.incidents.beginRun, { source: "fda-announcements", sourceName: "FDA", region: "US", scope: "Full listing", monitorVersion: 0 });
    const oldItem = { ...serialiseSourceIncident(parsed()), sourceKey: "fda-announcements", sourceRunId: runId };
    vi.setSystemTime(new Date("2026-11-10T12:01:00Z"));
    await t.mutation(internal.fdaMonitor.receive, { event: event() }); await t.listing(1);
    const work = (await t.mutation(internal.fdaMonitor.claimNotice, { path: listing.path }))!;
    const item = { ...serialiseSourceIncident(parsed()), summary: "Updated consumer instructions", sourceKey: "fda-announcements" };
    await t.mutation(internal.fdaMonitor.applyNotice, { path: listing.path, revision: work.revision, fetchedAt: work.fetchedAt, startedAt: work.startedAt, item });
    await t.mutation(internal.incidents.prepareImport, { runId, prefix: "test", batches: 1, found: 1 });
    await t.mutation(internal.incidents.applyImportBatch, { runId, index: 0, items: [oldItem] });
    expect((await t.run(ctx => ctx.db.query("incidents").first()))?.summary).toBe("Updated consumer instructions");
  });

  it("rejects stale or invented listing versions", async () => {
    const t = backend();
    await expect(t.listing(1)).rejects.toThrow("Unknown FDA listing request version");
    await expect(t.listing(0, false, [listing], Date.now() - 16 * 60_000)).rejects.toThrow();
  });

  it("rejects a different monitor or external URL even through internal invocation", async () => {
    const t = backend(); const input = event();
    await expect(t.mutation(internal.fdaMonitor.receive, { event: { ...input, data: [{ ...input.data[0], monitorId: crypto.randomUUID() }] } })).rejects.toThrow("Unexpected monitor");
    await expect(t.mutation(internal.fdaMonitor.receive, { event: event("changed", "https://example.com/recall") })).rejects.toThrow("Unexpected FDA");
  });

  it("blocks a previously healthy no-match while work is pending and does not extend the full-import freshness deadline", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-10T12:00:00Z"));
    const t = backend();
    for (const source of ["fda", "fda-announcements", "fsis"]) {
      const runId = await t.mutation(internal.incidents.beginRun, { source, sourceName: source, region: "US", scope: "Full source" });
      await t.mutation(internal.incidents.finishRun, { runId, status: "success", incidentsFound: 1, created: 0, updated: 0, errors: [] });
    }
    await t.listing(0, true);
    expect((await t.query(api.incidents.getDatasetStatus, { region: "US" })).healthy).toBe(true);
    const before = await t.run(ctx => ctx.db.query("ingestionRuns").collect());
    await t.mutation(internal.fdaMonitor.receive, { event: event() });
    expect((await t.query(api.incidents.getDatasetStatus, { region: "US" })).healthy).toBe(false);
    vi.setSystemTime(Date.now() + 1);
    await t.listing(1); await t.finishAllScheduledFunctions();
    expect((await t.query(api.incidents.getDatasetStatus, { region: "US" })).healthy).toBe(true);
    expect(await t.run(ctx => ctx.db.query("ingestionRuns").collect())).toEqual(before);
    vi.setSystemTime(Date.now() + 49 * 60 * 60_000);
    expect((await t.query(api.incidents.getDatasetStatus, { region: "US" })).healthy).toBe(false);
  });

  it("allows the next full reconciliation to recover a failed incremental request", async () => {
    const t = backend();
    await t.mutation(internal.fdaMonitor.receive, { event: event() });
    vi.mocked(fetchFdaAnnouncementDetail).mockRejectedValue(new Error("Lost response"));
    await t.listing(1); await t.finishAllScheduledFunctions();
    const runId = await t.mutation(internal.incidents.beginRun, { source: "fda-announcements", sourceName: "FDA", region: "US", scope: "Full source", monitorVersion: 1 });
    await t.mutation(internal.incidents.prepareImport, { runId, prefix: "fixture", batches: 1, found: 1 });
    await t.mutation(internal.incidents.applyImportBatch, { runId, index: 0, items: [{ ...serialiseSourceIncident(parsed()), sourceKey: "fda-announcements", sourceRunId: runId }] });
    expect(await t.query(internal.fdaMonitor.getStatus, {})).toMatchObject({ pending: 0 });
    expect(await t.query(internal.incidents.getImportResult, { runId })).toMatchObject({ status: "success" });
    expect(fetchFdaAnnouncementDetail).toHaveBeenCalledTimes(1);
  });

  it("ignores a superseded listing version even if it arrives with a later timestamp", async () => {
    vi.useFakeTimers();
    const t = backend();
    await t.mutation(internal.fdaMonitor.receive, { event: event() });
    await t.mutation(internal.fdaMonitor.receive, { event: event() });
    await t.listing(2, false, [{ ...listing, product: "Current product" }]);
    vi.setSystemTime(Date.now() + 1);
    await t.listing(1, false, [{ ...listing, product: "Old product" }]);
    expect((await t.run(ctx => ctx.db.query("fdaMonitorNotices").first()))?.listing?.product).toBe("Current product");
    expect(await t.query(internal.fdaMonitor.getStatus, {})).toMatchObject({ fulfilledVersion: 2 });
  });
});
