import { internalAction, internalMutation, internalQuery } from "./operations";
import { internal } from "./api";
import { v } from "./values";
import schema from "./schema";
import { upsertBatch } from "./incidents";
import { clearMonitorPending, ensureMonitorControl, monitorControl, monitorNotice } from "./lib/fda-monitor-state";
import { z } from "zod";
import { fdaMonitorPath, monitorWebhookSchema, monitorTargets, monitorScrapeOptions, monitorRequest, monitorResponseSchema, MonitorRateLimit } from "../src/lib/incidents/firecrawl-monitor";
import { readResponseJson } from "../src/lib/http/bounded-response";
import { fdaListingSnapshotSchema, readFdaListingSnapshot } from "../src/lib/incidents/fda-listing-snapshot";
import { fetchFdaAnnouncementDetail } from "../src/lib/incidents/fda-announcements";
import { serialiseSourceIncident } from "../src/lib/incidents/serialise";

export const getStatus = internalQuery({
  args: {}, handler: async ctx => {
    const control = await monitorControl(ctx);
    return { enabled: process.env.FDA_MONITOR_ENABLED === "true", requestedVersion: control?.requestedVersion ?? 0,
      fulfilledVersion: control?.fulfilledVersion ?? 0, pending: control?.pending ?? 0,
      listingFetchedAt: control?.listingFetchedAt ?? 0, lastCheckAt: control?.lastCheckAt, lastCheckStatus: control?.lastCheckStatus };
  },
});

export const getPending = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) }, handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("fdaMonitorNotices").withIndex("by_pending", q => q.eq("pending", true)).paginate({ numItems: 25, cursor });
    return { ...page, page: page.page.map(notice => ({ path: notice.path, requiredVersion: notice.requiredVersion,
      attempted: notice.attemptedRevision === notice.revision, lastError: notice.lastError })) };
  },
});

// The receipt and pending work commit together before the webhook is acknowledged.
export const receive = internalMutation({
  args: { event: monitorWebhookSchema }, handler: async (ctx, { event }) => {
    if (process.env.FDA_MONITOR_ENABLED !== "true") return { accepted: false };
    for (const page of event.data) {
      if (page.monitorId !== process.env.FDA_MONITOR_ID || page.checkId !== event.id) throw new Error("Unexpected monitor identity");
      const path = "url" in page ? fdaMonitorPath(page.url) : undefined;
      const key = `${page.monitorId}:${page.checkId}:${path ?? event.type}`;
      if (await ctx.db.query("fdaMonitorReceipts").withIndex("by_key", q => q.eq("key", key)).unique()) continue;
      if ("url" in page && page.status === "same") continue;
      await ctx.db.insert("fdaMonitorReceipts", { key, expiresAt: Date.now() + 31 * 86_400_000 });
      const control = await ensureMonitorControl(ctx);
      if (event.type === "monitor.check.completed") {
        await ctx.db.patch(control._id, { lastCheckAt: Date.now(), lastCheckStatus: page.status });
        continue;
      }
      // First observations of already imported notices establish the vendor's baseline.
      if (path && page.status === "new" && await ctx.db.query("incidents").withIndex("by_authority_sourceId", q =>
        q.eq("authority", "U.S. Food and Drug Administration").eq("sourceId", `announcement:${path}`)).unique()) continue;
      const requestedVersion = control.requestedVersion + 1;
      await ctx.db.patch(control._id, { requestedVersion });
      if (!path) continue;
      const notice = await monitorNotice(ctx, path);
      if (notice) await ctx.db.patch(notice._id, { revision: notice.revision + 1, pending: true, requiredVersion: requestedVersion, lastError: undefined });
      else await ctx.db.insert("fdaMonitorNotices", { path, listingFetchedAt: 0, listingVersion: 0, revision: 1, requiredVersion: requestedVersion,
        pending: true, attemptedRevision: 0, appliedAt: 0 });
      if (!notice?.pending) await ctx.db.patch(control._id, { pending: control.pending + 1 });
    }
    return { accepted: true };
  },
});

export const registerListings = internalMutation({
  args: { listings: fdaListingSnapshotSchema.max(25), fetchedAt: v.number(), version: v.number(), full: v.boolean() },
  handler: async (ctx, { listings, fetchedAt, version, full }) => {
    for (const listing of listings) {
      let notice = await monitorNotice(ctx, listing.path);
      if (notice && (notice.listingVersion > version || (notice.listingVersion === version && notice.listingFetchedAt >= fetchedAt))) continue;
      const changed = !notice?.listing || JSON.stringify(notice.listing) !== JSON.stringify(listing);
      if (!notice) {
        const id = await ctx.db.insert("fdaMonitorNotices", { path: listing.path, listing, listingFetchedAt: fetchedAt, listingVersion: version,
          revision: 0, requiredVersion: version, pending: false, attemptedRevision: -1, appliedAt: 0 });
        notice = (await ctx.db.get("fdaMonitorNotices", id))!;
      } else await ctx.db.patch(notice._id, { listing, listingFetchedAt: fetchedAt, listingVersion: version });
      if (changed && notice.pending) await ctx.db.patch(notice._id, { revision: notice.revision + 1 });
      if (changed && !full && !notice.pending) {
        const control = await ensureMonitorControl(ctx);
        await ctx.db.patch(control._id, { pending: control.pending + 1 });
        await ctx.db.patch(notice._id, { pending: true, revision: notice.revision + 1, requiredVersion: version });
      }
    }
  },
});

export const finishListingPage = internalMutation({
  args: { paths: v.array(v.string()).max(10_000), fetchedAt: v.number(), version: v.number(), full: v.boolean(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { paths, fetchedAt, version, full, cursor }) => {
    const control = await ensureMonitorControl(ctx);
    if (version < control.fulfilledVersion) return { cursor: "", done: true };
    const expected = new Set(paths);
    const page = await ctx.db.query("fdaMonitorNotices").withIndex("by_path").paginate({ numItems: 25, cursor });
    for (const notice of page.page) {
      // Absence from a complete food listing never resolves or deletes a warning.
      if (notice.pending && notice.requiredVersion <= version && notice.listingFetchedAt < fetchedAt && !expected.has(notice.path)) {
        await clearMonitorPending(ctx, notice);
      } else if (!full && notice.pending && notice.requiredVersion <= version && expected.has(notice.path)) {
        await ctx.scheduler.runAfter(0, internal.fdaMonitor.processNotice, { path: notice.path });
      }
    }
    return { cursor: page.continueCursor, done: page.isDone };
  },
});

export const finishListing = internalMutation({
  args: { fetchedAt: v.number(), version: v.number() }, handler: async (ctx, { fetchedAt, version }) => {
    const control = await ensureMonitorControl(ctx);
    if (version < control.fulfilledVersion) return;
    await ctx.db.patch(control._id, { fulfilledVersion: Math.max(control.fulfilledVersion, version), listingFetchedAt: Math.max(control.listingFetchedAt, fetchedAt) });
  },
});

export const acceptListing = internalAction({
  args: { storageId: v.string(), fetchedAt: v.number(), version: v.number().int().nonnegative(), full: v.boolean() },
  handler: async (ctx, { storageId, fetchedAt, version, full }) => {
    if (process.env.FDA_MONITOR_ENABLED !== "true" || process.env.FDA_ANNOUNCEMENTS_FETCH_MODE !== "firecrawl") throw new Error("FDA monitoring is disabled");
    const status = await ctx.runQuery(internal.fdaMonitor.getStatus, {});
    if (version > status.requestedVersion) throw new Error("Unknown FDA listing request version");
    if (version < status.fulfilledVersion) return { accepted: true, found: 0 };
    const listings = await readFdaListingSnapshot(await ctx.storage.get(storageId), fetchedAt);
    for (let offset = 0; offset < listings.length; offset += 25) {
      await ctx.runMutation(internal.fdaMonitor.registerListings, { listings: listings.slice(offset, offset + 25), fetchedAt, version, full });
    }
    await ctx.runMutation(internal.fdaMonitor.finishListing, { fetchedAt, version });
    let cursor: string | null = null;
    for (;;) {
      const page: { cursor: string; done: boolean } = await ctx.runMutation(internal.fdaMonitor.finishListingPage, { paths: listings.map(item => item.path), fetchedAt, version, full, cursor });
      if (page.done) break;
      cursor = page.cursor;
    }
    if ((await ctx.runQuery(internal.fdaMonitor.getStatus, {})).fulfilledVersion > version) return { accepted: true, found: 0 };
    const targetKey = `fda-monitor/targets/${crypto.randomUUID()}.json`;
    const urls = listings.sort((a, b) => b.publishedAt - a.publishedAt).map(item => `https://www.fda.gov${item.path}`);
    await ctx.storage.put(targetKey, JSON.stringify(urls));
    await ctx.scheduler.runAfter(0, internal.fdaMonitor.syncTargets, { storageId: targetKey, fetchedAt, attempt: 0 });
    return { accepted: true, found: listings.length };
  },
});

export const syncTargets = internalAction({
  args: { storageId: v.string(), fetchedAt: v.number(), attempt: v.number().int().nonnegative() },
  handler: async (ctx, { storageId, fetchedAt, attempt }): Promise<void> => {
    const status = await ctx.runQuery(internal.fdaMonitor.getStatus, {});
    if (!status.enabled || !process.env.FDA_MONITOR_ID || fetchedAt < status.listingFetchedAt) { await ctx.storage.delete(storageId); return; }
    try {
      const blob = await ctx.storage.get(storageId);
      if (!blob) throw new Error("Missing FDA Monitor targets");
      const urls = monitorTargets(z.array(z.string().url()).max(10_000).parse(await readResponseJson(new Response(blob), 20 * 1024 * 1024)), Number(process.env.FDA_MONITOR_DETAIL_LIMIT ?? "5"));
      const path = `/monitor/${z.string().uuid().parse(process.env.FDA_MONITOR_ID)}`;
      const monitor = monitorResponseSchema.parse(await monitorRequest(path, process.env.FIRECRAWL_API_KEY)).data;
      if (JSON.stringify(monitor.targets[0].urls) !== JSON.stringify(urls) || monitor.judgeEnabled !== false) {
        await monitorRequest(path, process.env.FIRECRAWL_API_KEY, "PATCH", { judgeEnabled: false,
          targets: [{ id: monitor.targets[0].id, type: "scrape", urls, scrapeOptions: monitorScrapeOptions }] });
      }
      await ctx.storage.delete(storageId);
    } catch (error) {
      // Management requests only; repeating the same target update is idempotent.
      if (attempt < 5) await ctx.scheduler.runAfter(error instanceof MonitorRateLimit ? error.delay : 60_000, internal.fdaMonitor.syncTargets, { storageId, fetchedAt, attempt: attempt + 1 });
      else console.error(JSON.stringify({ event: "fda_monitor_target_sync_failed" }));
    }
  },
});

export const claimNotice = internalMutation({
  args: { path: v.string() }, handler: async (ctx, { path }) => {
    const notice = await monitorNotice(ctx, path);
    const control = await ensureMonitorControl(ctx);
    if (!notice?.pending || !notice.listing || notice.listingVersion < notice.requiredVersion || notice.attemptedRevision === notice.revision || control.fulfilledVersion < notice.requiredVersion) return null;
    if (Date.now() - notice.listingFetchedAt > 15 * 60_000) {
      const version = control.requestedVersion + 1;
      await ctx.db.patch(control._id, { requestedVersion: version });
      await ctx.db.patch(notice._id, { requiredVersion: version });
      return null;
    }
    const day = Math.floor(Date.now() / 86_400_000) * 86_400_000;
    const key = `firecrawl:monitor:fda:${day}`;
    const budget = await ctx.db.query("rateLimits").withIndex("by_key", q => q.eq("key", key)).unique();
    if ((budget?.count ?? 0) >= 100) {
      await ctx.db.patch(notice._id, { lastError: "FDA Monitor daily retrieval budget exhausted" });
      return null;
    }
    if (budget) await ctx.db.patch(budget._id, { count: budget.count + 1 });
    else await ctx.db.insert("rateLimits", { key, count: 1, subjectHash: "fda-monitor", action: "firecrawl_monitor", windowStartedAt: day, expiresAt: day + 2 * 86_400_000 });
    await ctx.db.patch(notice._id, { attemptedRevision: notice.revision });
    return { revision: notice.revision, listing: notice.listing, startedAt: Date.now(), fetchedAt: notice.listingFetchedAt };
  },
});

export const applyNotice = internalMutation({
  args: { path: v.string(), revision: v.number(), fetchedAt: v.number(), startedAt: v.number(), item: schema.incidents.validator },
  handler: async (ctx, { path, revision, fetchedAt, startedAt, item }) => {
    const notice = await monitorNotice(ctx, path);
    if (!notice?.pending || notice.revision !== revision || notice.listingFetchedAt < fetchedAt || notice.appliedAt > startedAt) return { applied: false };
    if (item.sourceKey !== "fda-announcements" || item.sourceId !== `announcement:${path}` || item.authorityUrl !== `https://www.fda.gov${path}`) throw new Error("Unexpected FDA monitor record");
    const result = await upsertBatch.handler(ctx, { items: [item] });
    await clearMonitorPending(ctx, notice);
    await ctx.db.patch(notice._id, { appliedAt: startedAt });
    return { applied: true, ...result };
  },
});

export const failNotice = internalMutation({
  args: { path: v.string(), revision: v.number(), phase: v.optional(v.union(v.literal("retrieval"), v.literal("commit"))) }, handler: async (ctx, { path, revision, phase }) => {
    const notice = await monitorNotice(ctx, path);
    if (notice?.pending && notice.revision === revision) await ctx.db.patch(notice._id, { lastError: phase === "commit" ? "FDA Monitor commit failed; awaiting reconciliation" : "FDA Monitor retrieval failed; awaiting reconciliation" });
  },
});

export const processNotice = internalAction({
  args: { path: v.string() }, handler: async (ctx, { path }) => {
    if (process.env.FDA_MONITOR_ENABLED !== "true" || process.env.FDA_ANNOUNCEMENTS_FETCH_MODE !== "firecrawl" || !process.env.FIRECRAWL_API_KEY?.trim()) return;
    const work = await ctx.runMutation(internal.fdaMonitor.claimNotice, { path });
    if (!work) return;
    let phase: "retrieval" | "commit" = "retrieval";
    try {
      const item = await fetchFdaAnnouncementDetail({ ...work.listing, publishedAt: new Date(work.listing.publishedAt) }, { mode: "firecrawl", apiKey: process.env.FIRECRAWL_API_KEY });
      phase = "commit";
      await ctx.runMutation(internal.fdaMonitor.applyNotice, { path, revision: work.revision, fetchedAt: work.fetchedAt, startedAt: work.startedAt,
        item: { ...serialiseSourceIncident(item), sourceKey: "fda-announcements" } });
    } catch {
      // A paid request may have succeeded despite a lost response. Never repeat it
      // automatically; the full reconciliation or a newer event recovers the notice.
      await ctx.runMutation(internal.fdaMonitor.failNotice, { path, revision: work.revision, phase });
    }
  },
});

export const cleanup = internalMutation({
  args: {}, handler: async ctx => {
    const receipts = await ctx.db.query("fdaMonitorReceipts").withIndex("by_expiresAt", q => q.lt("expiresAt", Date.now())).take(100);
    for (const receipt of receipts) await ctx.db.delete(receipt._id);
    if (receipts.length === 100) await ctx.scheduler.runAfter(0, internal.fdaMonitor.cleanup, {});
  },
});
