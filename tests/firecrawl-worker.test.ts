import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { internal } from "@backend/api";
import { fetchFdaAnnouncementDetail, fetchFdaAnnouncementListings, parseFdaAnnouncementDetail } from "@/lib/incidents/fda-announcements";
import { createBackend } from "./backend-harness";

vi.mock("../src/lib/incidents/fda-announcements", async importOriginal => ({
  ...await importOriginal<typeof import("../src/lib/incidents/fda-announcements")>(),
  fetchFdaAnnouncementListings: vi.fn(), fetchFdaAnnouncementDetail: vi.fn(),
}));

const listings = Array.from({ length: 26 }, (_, index) => ({
  path: `/safety/recalls-market-withdrawals-safety-alerts/cloud-fixture-${index}`,
  publishedAt: new Date("2026-10-01"), brand: "Fixture", product: `Fixture product ${index}`,
  productType: "Food & Beverages", reason: "Undeclared milk", company: "Fixture company", terminationStatus: "", terminated: false,
}));
const html = '<h2 id="recall-announcement">Company Announcement</h2><p>Consumers should return the product.</p><h2>Contact</h2>';

function backend() {
  const objects = new Map<string, string>([["listing-upload", JSON.stringify(listings.map(item => ({ ...item, publishedAt: item.publishedAt.getTime() })))]]);
  return createBackend({
    get: async key => objects.has(key) ? new Blob([objects.get(key)!]) : null,
    put: async (key, value) => { objects.set(key, value); },
    delete: async key => { objects.delete(key); },
  });
}

beforeEach(() => {
  vi.stubEnv("FDA_ANNOUNCEMENTS_FETCH_MODE", "firecrawl");
  vi.stubEnv("FIRECRAWL_API_KEY", "fc-private-worker-fixture");
  vi.mocked(fetchFdaAnnouncementListings).mockResolvedValue(listings);
  vi.mocked(fetchFdaAnnouncementDetail).mockImplementation(async item => parseFdaAnnouncementDetail(item, html));
});
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

describe("Cloudflare owns FDA Firecrawl retrieval", () => {
  it("fetches in resumable jobs and publishes only after the full listing is validated", async () => {
    const t = backend();
    const queued = await t.action(internal.incidents.importFdaListingSnapshotInternal, { storageId: "listing-upload", fetchedAt: Date.now() });
    expect(queued).toMatchObject({ status: "queued", found: 26 });
    if (!("runId" in queued) || !queued.runId) throw new Error("Missing run");
    const runId = queued.runId;
    const rows = () => t.run(ctx => ctx.db.query("incidents").collect());
    await t.action(internal.incidents.fetchFdaFirecrawlBatch, { runId, index: 0 });
    expect(fetchFdaAnnouncementDetail).toHaveBeenCalledTimes(25);
    expect(await rows()).toEqual([]);
    await t.action(internal.incidents.fetchFdaFirecrawlBatch, { runId, index: 0 });
    expect(fetchFdaAnnouncementDetail).toHaveBeenCalledTimes(25);
    await t.action(internal.incidents.fetchFdaFirecrawlBatch, { runId, index: 1 });
    expect(fetchFdaAnnouncementDetail).toHaveBeenCalledTimes(26);
    expect(await rows()).toEqual([]);
    await t.finishAllScheduledFunctions();
    expect(await rows()).toHaveLength(26);
    expect(await t.query(internal.incidents.getImportResult, { runId })).toMatchObject({ status: "success", found: 26 });
    expect(fetchFdaAnnouncementDetail).toHaveBeenCalledWith(expect.anything(), { mode: "firecrawl", apiKey: "fc-private-worker-fixture" });
  });

  it("does not publish a partial archive when a later fetch batch fails", async () => {
    const t = backend();
    const queued = await t.action(internal.incidents.importFdaListingSnapshotInternal, { storageId: "listing-upload", fetchedAt: Date.now() });
    if (!("runId" in queued) || !queued.runId) throw new Error("Missing run");
    await t.action(internal.incidents.fetchFdaFirecrawlBatch, { runId: queued.runId, index: 0 });
    vi.mocked(fetchFdaAnnouncementDetail).mockRejectedValue(new Error("Credential must stay private"));
    await t.action(internal.incidents.fetchFdaFirecrawlBatch, { runId: queued.runId, index: 1 });
    await t.finishAllScheduledFunctions();
    expect(await t.run(ctx => ctx.db.query("incidents").collect())).toEqual([]);
    expect(await t.query(internal.incidents.getImportResult, { runId: queued.runId })).toMatchObject({
      status: "failed", errors: ["FDA Firecrawl detail batch failed; no partial snapshot will be published"],
    });
  });

  it("requires the Worker secret before retrieving the listing", async () => {
    vi.stubEnv("FIRECRAWL_API_KEY", "");
    const t = backend();
    expect(await t.action(internal.incidents.importFdaListingSnapshotInternal, { storageId: "listing-upload", fetchedAt: Date.now() })).toMatchObject({ status: "failed" });
    expect(fetchFdaAnnouncementListings).not.toHaveBeenCalled();
  });

  it("retains external snapshot mode until an explicit cloud cutover", async () => {
    vi.stubEnv("FDA_ANNOUNCEMENTS_FETCH_MODE", "snapshot");
    const t = backend();
    expect(await t.action(internal.incidents.refreshSourceInternal, { sourceId: "fda-announcements" })).toEqual({ source: "fda-announcements", status: "external" });
    expect(fetchFdaAnnouncementListings).not.toHaveBeenCalled();
  });

  it("rejects a stale uploaded listing without fetching any details", async () => {
    const t = backend();
    expect(await t.action(internal.incidents.importFdaListingSnapshotInternal, { storageId: "listing-upload", fetchedAt: Date.now() - 16 * 60 * 1_000 })).toMatchObject({ status: "failed" });
    expect(fetchFdaAnnouncementDetail).not.toHaveBeenCalled();
  });
});
