import { classifyHazard } from "../src/lib/incidents/hazard";
import { sourceHazardText, warningSearchText } from "../src/lib/incidents/warning-search";
import schema from "./schema";
import { browseContent } from "./lib/browse_projection";
import { readResponseJson } from "../src/lib/http/bounded-response";
import { BackendError, v } from "./values";

import { fdaAnnouncementsSource } from "../src/lib/incidents/fda-announcements";
import { fdaDrugSource, fdaSource, parseFdaRecord } from "../src/lib/incidents/fda";
import { fsisIncidentsForSync, fsisSource } from "../src/lib/incidents/fsis";
import { readFsisSnapshot } from "../src/lib/incidents/fsis-snapshot";
import { fsaSource } from "../src/lib/incidents/fsa";
import type { IncidentSource, NormalisedIncident } from "../src/lib/incidents/types";
import { browseCategories, incidentSuperCategories, medicineBrowseCategories, namedRetailers, rowSuperCategories, type ProductCategory } from "../src/lib/incidents/browse";
import { buildDatasetStatus, type IngestionRunSummary } from "../src/lib/incidents/dataset-status";
import { cleanupNeedsContinuation, EPHEMERAL_CLEANUP_BATCH_SIZE } from "../src/lib/incidents/cleanup-batches";
import { serialiseSourceIncident } from "../src/lib/incidents/serialise";
import { readFdaSnapshot } from "./fda-snapshot";
import { pendingLookupDue, productCategoryTagsFor } from "../src/lib/products/open-food-facts";
import { internal } from "./api";
import type { Doc, Id } from "./model";
import { action, internalAction, internalMutation, internalQuery, query, type ActionCtx } from "./operations";
import { requireServerSecret } from "./security";
import { bumpDatasetVersions, datasetVersion } from "./lib/dataset_version";
import { sameIncidentContent } from "../src/lib/incidents/unchanged";
import { incidentFingerprint } from "../src/lib/incidents/fingerprint";
import { IMPORT_ARCHIVE_AUDIT_MS, invalidateImportState } from "./lib/import_state";

const sources: IncidentSource[] = [fsaSource, fdaSource, fdaAnnouncementsSource, fsisSource, fdaDrugSource];
// Pack checks only cover food, so only food sources gate a "no match" result.
const checkSources = sources.filter((source) => source.superCategory === "Food");
const UPSERT_BATCH_SIZE = 25;
// Keep each response below the server client's and Next's 2 MiB limits while
// avoiding one cross-provider HTTP round trip per hundred warning records.
const READ_PAGE_SIZE = 400;
const READ_PAGE_BYTES = 1536 * 1024;
const LEGACY_FDA_REPAIR_PAGE_SIZE = 25;
const REPORTED_CURSOR_PREFIX = "reported:";

function serialiseIncident(item: NormalisedIncident, source: IncidentSource, runId: Id<"ingestionRuns">) {
  return { ...serialiseSourceIncident(item), sourceKey: source.id, sourceRunId: runId };
}

type ImportItem = Omit<Doc<"incidents">, "_id" | "_creationTime">;
type ImportResult = { source: string; runId?: Id<"ingestionRuns">; found: number; created: number; updated: number; status: "queued" | "success" | "partial" | "failed"; errors: string[] };
const CATEGORY_CACHE_CHUNK = 200;

// Attaches cached Open Food Facts categories and queues unseen barcodes for
// the hourly lookup. Browse labels are display-only, so a cache failure must
// never stop official warnings from importing.
async function attachProductCategoryTags(ctx: ActionCtx, items: ImportItem[]) {
  try {
    const newest = new Map<string, number>();
    for (const item of items) {
      for (const target of item.targets) {
        if (target.type === "gtin" && target.valueNormalized) newest.set(target.valueNormalized, Math.max(newest.get(target.valueNormalized) ?? 0, item.publishedAt));
      }
    }
    const gtins = [...newest.keys()].slice(0, 250);
    const known = new Set<string>();
    const cached = new Map<string, string[]>();
    for (let offset = 0; offset < gtins.length; offset += CATEGORY_CACHE_CHUNK) {
      const rows = await ctx.runQuery(internal.products.getCategoryTags, { gtins: gtins.slice(offset, offset + CATEGORY_CACHE_CHUNK) });
      for (const row of rows) {
        known.add(row.gtin);
        if (row.tags.length) cached.set(row.gtin, row.tags);
      }
    }
    const unseen = gtins.filter((gtin) => !known.has(gtin)).map((gtin) => ({ gtin, due: pendingLookupDue(newest.get(gtin) ?? 0) }));
    for (let offset = 0; offset < unseen.length; offset += CATEGORY_CACHE_CHUNK) {
      await ctx.runMutation(internal.products.queueCategoryLookups, { items: unseen.slice(offset, offset + CATEGORY_CACHE_CHUNK) });
    }
    for (const item of items) {
      const tags = productCategoryTagsFor(item.targets, cached);
      if (tags) item.productCategoryTags = tags;
    }
  } catch (error) {
    console.warn(`Product categories were not attached: ${error instanceof Error ? error.message : String(error)}`);
  }
}

type MatchProjectionInput = Pick<Doc<"incidents">,
  | "title"
  | "slug"
  | "region"
  | "status"
  | "startsAt"
  | "endsAt"
  | "isDemo"
  | "hazard"
  | "pathogen"
  | "summary"
  | "consumerAdvice"
  | "authority"
  | "authorityUrl"
  | "sourceId"
  | "publishedAt"
  | "updatedAt"
  | "severity"
  | "confidence"
  | "targets"
  | "sourceKey"
  | "originalSourceData"
  | "productCategoryTags"
>;

function compactMatchRecord(incidentId: Id<"incidents">, item: MatchProjectionInput) {
  const browseSource = {
    title: item.title,
    targets: item.targets,
    originalSourceData: item.originalSourceData,
    hazard: item.hazard,
    summary: item.summary,
    productCategoryTags: item.productCategoryTags,
  };
  const sourceKey = item.sourceKey ?? inferSourceKey(item.authority, item.sourceId);
  const sourceSuperCategory = sources.find((source) => source.id === sourceKey)?.superCategory;
  const categories: ProductCategory[] = sourceSuperCategory === "Medical"
    ? medicineBrowseCategories(item.originalSourceData)
    : browseCategories(browseSource);

  return {
    incidentId,
    title: item.title,
    slug: item.slug,
    region: item.region,
    status: item.status,
    startsAt: item.startsAt,
    endsAt: item.endsAt,
    isDemo: item.isDemo,
    hazard: item.hazard,
    pathogen: item.pathogen,
    summary: item.summary,
    consumerAdvice: item.consumerAdvice,
    authority: item.authority,
    authorityUrl: item.authorityUrl,
    sourceId: item.sourceId,
    publishedAt: item.publishedAt,
    updatedAt: item.updatedAt,
    severity: item.severity,
    confidence: item.confidence,
    targets: item.targets,
    sourceKey,
    categories,
    superCategories: incidentSuperCategories({ source: sourceSuperCategory, title: item.title, summary: item.summary, categories }),
    stores: namedRetailers(browseSource),
    ...browseContent({ ...item, categories, stores: namedRetailers(browseSource), superCategories: incidentSuperCategories({ source: sourceSuperCategory, title: item.title, summary: item.summary, categories }) }, item.originalSourceData),
  };
}

function inferSourceKey(authority: string, sourceId: string): string | undefined {
  if (authority === "Food Standards Agency") return "fsa";
  if (authority === "U.S. Food and Drug Administration") {
    if (sourceId.startsWith("announcement:")) return "fda-announcements";
    return sourceId.startsWith("D-") ? "fda-drugs" : "fda";
  }
  if (authority.startsWith("U.S. Department of Agriculture") && authority.includes("Food Safety and Inspection Service")) return "fsis";
  return undefined;
}

function activeMatchData(row: { status: string; startsAt: number; endsAt?: number; isDemo: boolean }, now: number, includeDemo: boolean) {
  return row.status === "active" && row.startsAt <= now && (!row.endsAt || row.endsAt > now) && (includeDemo || !row.isDemo);
}

export const getActivePage = query({
  args: {
    region: v.union(v.literal("UK"), v.literal("US")),
    includeDemo: v.optional(v.boolean()),
    snapshot: v.optional(v.boolean()),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const now = args.snapshot ? 0 : Date.now();
    const page = await ctx.db
      .query("incidentMatchData")
      .withIndex("by_region_status", (q) => q.eq("region", args.region).eq("status", "active"))
      .paginate({ numItems: READ_PAGE_SIZE, maximumBytesRead: READ_PAGE_BYTES, cursor: args.cursor });
    return {
      ...page,
      page: page.page
        .filter((row) => args.snapshot ? (args.includeDemo || !row.isDemo) : activeMatchData(row, now, args.includeDemo ?? false))
        // Pack checks only match food recalls; medicines and other products are browse-only for now.
        .filter((row) => rowSuperCategories(row).includes("Food"))
        .map((row) => ({
          incidentId: row.incidentId,
          title: row.title,
          slug: row.slug,
          region: row.region,
          startsAt: row.startsAt,
          endsAt: row.endsAt,
          hazard: row.hazard,
          pathogen: row.pathogen,
          summary: row.summary,
          consumerAdvice: row.consumerAdvice,
          authority: row.authority,
          authorityUrl: row.authorityUrl,
          sourceId: row.sourceId,
          publishedAt: row.publishedAt,
          updatedAt: row.updatedAt,
          severity: row.severity,
          confidence: row.confidence,
          targets: row.targets,
        })),
    };
  },
});

export const getBySlug = query({
  args: { slug: v.string(), includeDemo: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("incidentMatchData").withIndex("by_slug", (q) => q.eq("slug", args.slug)).unique();
    if (!row || (!args.includeDemo && row.isDemo)) return null;
    return {
      _id: row.incidentId,
      title: row.title,
      slug: row.slug,
      region: row.region,
      status: row.status,
      hazard: row.hazard,
      pathogen: row.pathogen,
      summary: row.summary,
      consumerAdvice: row.consumerAdvice,
      authority: row.authority,
      authorityUrl: row.authorityUrl,
      sourceId: row.sourceId,
      publishedAt: row.publishedAt,
      updatedAt: row.updatedAt,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      severity: row.severity,
      confidence: row.confidence,
      targets: row.targets,
      superCategories: rowSuperCategories(row),
    };
  },
});

export const listActivePage = query({
  args: {
    region: v.union(v.literal("UK"), v.literal("US")),
    cursor: v.union(v.string(), v.null()),
    snapshot: v.optional(v.boolean()),
    expectedVersion: v.optional(v.string()),
    foodOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    if (args.expectedVersion !== undefined && args.expectedVersion !== await datasetVersion(ctx, args.region)) {
      throw new BackendError({ code: "DATASET_REVISION_CHANGED" });
    }
    const now = args.snapshot ? 0 : Date.now();
    // Page each indexed status separately so reports do not become active
    // recalls and browsing does not scan every resolved incident.
    const reports = !args.foodOnly && args.cursor?.startsWith(REPORTED_CURSOR_PREFIX);
    const cursor = reports ? args.cursor!.slice(REPORTED_CURSOR_PREFIX.length) || null : args.cursor;
    const page = await ctx.db
      .query("incidentMatchData")
      .withIndex("by_region_status", (q) => q.eq("region", args.region).eq("status", reports ? "reported" : "active"))
      .paginate({ numItems: READ_PAGE_SIZE, maximumBytesRead: READ_PAGE_BYTES, cursor });
    const nextReports = !args.foodOnly && !reports && page.isDone && Boolean(await ctx.db
      .query("incidentMatchData")
      .withIndex("by_region_status", (q) => q.eq("region", args.region).eq("status", "reported"))
      .first());
    // Existing matching rows can contain parser-shortened hazards. Read the
    // source records in one batch, then return only the compact public projection.
    for (let offset = 0; offset < page.page.length; offset += 100) {
      await ctx.db.preloadIds(page.page.slice(offset, offset + 100).filter(row => !row.browseHazard || row.browseSearchText === undefined).map(row => row.incidentId));
    }
    const sourceHazards = new Map<string, string>();
    for (const row of page.page) {
      if (row.browseHazard && row.browseSearchText !== undefined) continue;
      const source = await ctx.db.get("incidents", row.incidentId);
      sourceHazards.set(row.incidentId, sourceHazardText(source?.originalSourceData, row.hazard));
    }
    return {
      ...page,
      isDone: page.isDone && !nextReports,
      continueCursor: nextReports ? REPORTED_CURSOR_PREFIX : reports ? REPORTED_CURSOR_PREFIX + page.continueCursor : page.continueCursor,
      page: page.page.filter((row) => (args.snapshot ? !row.isDemo : !row.isDemo && row.startsAt <= now && (!row.endsAt || row.endsAt > now))
        && (!args.foodOnly || rowSuperCategories(row).includes("Food"))).map((row) => ({
        id: row.incidentId,
        title: row.title,
        slug: row.slug,
        region: row.region,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        summary: row.summary,
        hazard: row.hazard?.slice(0, 400) ?? null,
        searchText: row.browseSearchText ?? warningSearchText({ ...row, hazard: classifyHazard({ ...row, hazard: sourceHazards.get(row.incidentId) }), hazardText: sourceHazards.get(row.incidentId) }),
        browseHazard: row.browseHazard ?? classifyHazard({ ...row, hazard: sourceHazards.get(row.incidentId) }),
        pathogen: row.pathogen ?? null,
        authority: row.authority,
        authorityUrl: row.authorityUrl,
        sourceId: row.sourceId,
        publishedAt: row.publishedAt,
        updatedAt: row.updatedAt,
        categories: row.categories,
        superCategories: rowSuperCategories(row),
        stores: row.stores,
      })),
    };
  },
});

export const getDatasetVersion = query({
  args: { region: v.optional(v.union(v.literal("UK"), v.literal("US"))) },
  handler: (ctx, args) => datasetVersion(ctx, args.region),
});

export const getDatasetStatus = query({
  args: { region: v.union(v.literal("UK"), v.literal("US")) },
  handler: async (ctx, args) => {
    const requiredSources = checkSources.filter((source) => source.region === args.region);
    const pairs = await Promise.all(requiredSources.map(async (source) => {
      const [latest, latestSuccessful] = await Promise.all([
        ctx.db
          .query("ingestionRuns")
          .withIndex("by_source_startedAt", (q) => q.eq("source", source.id))
          .order("desc")
          .first(),
        ctx.db
          .query("ingestionRuns")
          .withIndex("by_source_status_completedAt", (q) => q.eq("source", source.id).eq("status", "success"))
          .order("desc")
          .first(),
      ]);
      const summary = (run: typeof latest): IngestionRunSummary | null => run
        ? { source: run.source, status: run.status, startedAt: run.startedAt, completedAt: run.completedAt }
        : null;
      return [source.id, { latest: summary(latest), latestSuccessful: summary(latestSuccessful) }] as const;
    }));

    return { ...buildDatasetStatus(args.region, requiredSources, Object.fromEntries(pairs)), version: await datasetVersion(ctx, args.region) };
  },
});

export const getActiveSourceIdsPage = internalQuery({
  args: { sourceKey: v.string(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { sourceKey, cursor }) => {
    const page = await ctx.db
      .query("incidentMatchData")
      .withIndex("by_sourceKey_status", (q) => q.eq("sourceKey", sourceKey).eq("status", "active"))
      .paginate({ numItems: READ_PAGE_SIZE, maximumBytesRead: READ_PAGE_BYTES, cursor });
    return {
      ids: page.page.map((row) => row.sourceId),
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

export const repairLegacyFdaSourceIdsBatch = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db
      .query("incidents")
      .withIndex("by_authority_sourceId", (q) => q.eq("authority", fdaSource.name).eq("sourceId", ""))
      .paginate({ numItems: LEGACY_FDA_REPAIR_PAGE_SIZE, cursor });
    let repaired = 0;

    for (const row of page.page) {
      const sourceId = parseFdaRecord(row.originalSourceData).sourceId;
      if (!sourceId.trim()) throw new Error(`Cannot derive an FDA source ID for incident ${row._id}`);

      const collision = await ctx.db
        .query("incidents")
        .withIndex("by_authority_sourceId", (q) => q.eq("authority", row.authority).eq("sourceId", sourceId))
        .unique();
      if (collision && collision._id !== row._id) {
        throw new Error(`FDA source ID repair for incident ${row._id} would collide with ${collision._id}`);
      }

      await invalidateImportState(ctx, row.authority, row.sourceId);
      await invalidateImportState(ctx, row.authority, sourceId);
      await ctx.db.patch(row._id, { sourceId });
      const compact = await ctx.db
        .query("incidentMatchData")
        .withIndex("by_incidentId", (q) => q.eq("incidentId", row._id))
        .unique();
      if (compact) await ctx.db.patch(compact._id, { sourceId });
      repaired += 1;
    }

    if (repaired) await bumpDatasetVersions(ctx, ["US"]);

    return { repaired, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

export const repairLegacyFdaSourceIdsInternal = internalAction({
  args: {},
  handler: async (ctx) => {
    let cursor: string | null = null;
    let isDone = false;
    let repaired = 0;
    while (!isDone) {
      const page: { repaired: number; isDone: boolean; continueCursor: string | null } = await ctx.runMutation(
        internal.incidents.repairLegacyFdaSourceIdsBatch,
        { cursor },
      );
      cursor = page.continueCursor;
      isDone = page.isDone;
      repaired += page.repaired;
    }
    return { repaired };
  },
});

export const beginRun = internalMutation({
  args: {
    source: v.string(),
    sourceName: v.string(),
    region: v.union(v.literal("UK"), v.literal("US")),
    scope: v.string(),
  },
  handler: (ctx, args) => ctx.db.insert("ingestionRuns", {
    ...args,
    status: "running",
    startedAt: Date.now(),
    incidentsFound: 0,
    created: 0,
    updated: 0,
    errors: [],
  }),
});

function verifiedUnchanged(state: Doc<"incidentImportState"> | null, match: Doc<"incidentMatchData"> | null, item: ImportItem, fingerprint: string, now: number): boolean {
  return !!state && state.fingerprint === fingerprint && now >= state.archiveVerifiedAt
    && now - state.archiveVerifiedAt < IMPORT_ARCHIVE_AUDIT_MS && match?.incidentId === state.incidentId
    && sameIncidentContent(match, compactMatchRecord(state.incidentId, item));
}

export const upsertBatch = internalMutation({
  args: { items: v.array(schema.incidents.validator).max(UPSERT_BATCH_SIZE) },
  handler: async (ctx, { items }) => {
    // Fetch related records together instead of paying a binding round trip
    // for every record in the archive. The mutation's revision still fences
    // the complete read/write operation, and staged changes overlay the cache.
    await ctx.db.preloadIndex("incidentImportState", "by_authority_sourceId", items.map(({ authority, sourceId }) => ({ authority, sourceId })));
    const states = await Promise.all(items.map(item => ctx.db.query("incidentImportState").withIndex("by_authority_sourceId", q => q.eq("authority", item.authority).eq("sourceId", item.sourceId)).unique()));
    await ctx.db.preloadIds(states.flatMap(state => state ? [state.matchDataId] : []));
    const fingerprints = await Promise.all(items.map(incidentFingerprint));
    const needsArchive: ImportItem[] = [];
    for (const [index, item] of items.entries()) {
      const state = states[index];
      const match = state ? await ctx.db.get("incidentMatchData", state.matchDataId) : null;
      if (!verifiedUnchanged(state, match, item, fingerprints[index], Date.now())) needsArchive.push(item);
    }
    await ctx.db.preloadIndex("incidents", "by_authority_sourceId", needsArchive.map(({ authority, sourceId }) => ({ authority, sourceId })));
    const existing = await Promise.all(needsArchive.map(item => ctx.db.query("incidents").withIndex("by_authority_sourceId", q => q.eq("authority", item.authority).eq("sourceId", item.sourceId)).unique()));
    await ctx.db.preloadIndex("incidentMatchData", "by_incidentId", existing.flatMap(row => row ? [{ incidentId: row._id }] : []));
    let created = 0;
    let updated = 0;
    let unchanged = 0;
    const regions = new Set<"UK" | "US">();
    for (const [index, item] of items.entries()) {
      const fingerprint = fingerprints[index];
      const state = await ctx.db.query("incidentImportState")
        .withIndex("by_authority_sourceId", (q) => q.eq("authority", item.authority).eq("sourceId", item.sourceId)).unique();
      const savedMatch = state ? await ctx.db.get("incidentMatchData", state.matchDataId) : null;
      const now = Date.now();
      if (verifiedUnchanged(state, savedMatch, item, fingerprint, now)) {
        unchanged += 1;
        continue;
      }

      const existing = await ctx.db
        .query("incidents")
        .withIndex("by_authority_sourceId", (q) => q.eq("authority", item.authority).eq("sourceId", item.sourceId))
        .unique();
      let incidentId;
      if (existing) {
        incidentId = existing._id;
        if (sameIncidentContent(existing, item)) unchanged += 1;
        else {
          await ctx.db.patch(existing._id, item);
          updated += 1;
        }
      } else {
        incidentId = await ctx.db.insert("incidents", item);
        created += 1;
      }

      const matchRecord = compactMatchRecord(incidentId, item);
      let existingMatch = savedMatch?.incidentId === incidentId ? savedMatch : null;
      // If an archive record was deleted outside the importer, relink its
      // verified projection rather than publishing a second copy of the notice.
      if (!existingMatch && !existing && state && savedMatch?.incidentId === state.incidentId
        && savedMatch.authority === item.authority && savedMatch.sourceId === item.sourceId
        && !await ctx.db.get("incidents", state.incidentId)) existingMatch = savedMatch;
      existingMatch ??= await ctx.db.query("incidentMatchData")
        .withIndex("by_incidentId", (q) => q.eq("incidentId", incidentId)).unique();
      let matchDataId = existingMatch?._id;
      if (!existingMatch || !sameIncidentContent(existingMatch, matchRecord)) {
        if (existingMatch) {
          regions.add(existingMatch.region);
          await ctx.db.patch(existingMatch._id, matchRecord);
        } else matchDataId = await ctx.db.insert("incidentMatchData", matchRecord);
        regions.add(item.region);
      }
      if (!matchDataId) throw new Error("Warning projection was not saved");
      const importState = {
        authority: item.authority,
        sourceId: item.sourceId,
        incidentId,
        matchDataId,
        fingerprint,
        archiveVerifiedAt: now,
      };
      if (state) await ctx.db.patch(state._id, importState);
      else await ctx.db.insert("incidentImportState", importState);
    }
    await bumpDatasetVersions(ctx, regions);
    return { created, updated, unchanged };
  },
});

export const finishRun = internalMutation({
  args: {
    runId: v.id("ingestionRuns"),
    status: v.union(v.literal("success"), v.literal("partial"), v.literal("failed")),
    incidentsFound: v.number(),
    created: v.number(),
    updated: v.number(),
    errors: v.array(v.string()),
  },
  handler: (ctx, args) => {
    const { runId, ...run } = args;
    return ctx.db.patch(runId, { ...run, completedAt: Date.now(), errors: args.errors.slice(0, 50) });
  },
});

export const cleanupExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const [shares, limits, metadata] = await Promise.all([
      ctx.db.query("publicShares").withIndex("by_expiresAt", (q) => q.lt("expiresAt", now)).take(EPHEMERAL_CLEANUP_BATCH_SIZE),
      ctx.db.query("rateLimits").withIndex("by_expiresAt", (q) => q.lt("expiresAt", now)).take(EPHEMERAL_CLEANUP_BATCH_SIZE),
      ctx.db.query("productMetadataCache").withIndex("by_expiresAt", (q) => q.lt("expiresAt", now)).take(EPHEMERAL_CLEANUP_BATCH_SIZE),
    ]);
    await Promise.all([...shares, ...limits, ...metadata].map((row) => ctx.db.delete(row._id)));

    if (cleanupNeedsContinuation(shares.length, limits.length, metadata.length)) {
      await ctx.scheduler.runAfter(0, internal.incidents.cleanupExpired, {});
    }
    return { sharesDeleted: shares.length, rateLimitsDeleted: limits.length, metadataDeleted: metadata.length };
  },
});

export const backfillMatchDataBatch = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("incidents").order("asc").paginate({
      numItems: 100,
      cursor,
    });
    let inserted = 0;
    const regions = new Set<"UK" | "US">();
    for (const row of page.page) {
      const existing = await ctx.db
        .query("incidentMatchData")
        .withIndex("by_incidentId", (q) => q.eq("incidentId", row._id))
        .unique();
      if (existing) continue;
      await ctx.db.insert("incidentMatchData", compactMatchRecord(row._id, row));
      regions.add(row.region);
      inserted += 1;
    }

    await bumpDatasetVersions(ctx, regions);

    return { inserted, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

export const backfillMatchDataInternal = internalAction({
  args: {},
  handler: async (ctx) => {
    let cursor: string | null = null;
    let isDone = false;
    let inserted = 0;
    while (!isDone) {
      const page: { inserted: number; isDone: boolean; continueCursor: string | null } = await ctx.runMutation(
        internal.incidents.backfillMatchDataBatch,
        { cursor },
      );
      cursor = page.continueCursor;
      isDone = page.isDone;
      inserted += page.inserted;
    }
    return { inserted };
  },
});

async function ingestSource(ctx: ActionCtx, source: IncidentSource): Promise<ImportResult> {
  const runId = await ctx.runMutation(internal.incidents.beginRun, {
    source: source.id,
    sourceName: source.name,
    region: source.region,
    scope: source.scope,
  });
  const created = 0;
  const updated = 0;
  const errors: string[] = [];
  let found = 0;
  let fetchFailed = false;

  try {
    const existingSourceIds: string[] = [];
    if (source.id === "fda" || source.id === "fda-drugs" || source.id === "fsis") {
      if (source.id === "fda") await ctx.runAction(internal.incidents.repairLegacyFdaSourceIdsInternal, {});
      let cursor: string | null = null;
      let isDone = false;
      while (!isDone) {
        const page: { ids: string[]; isDone: boolean; continueCursor: string | null } = await ctx.runQuery(
          internal.incidents.getActiveSourceIdsPage,
          { sourceKey: source.id, cursor },
        );
        existingSourceIds.push(...page.ids);
        cursor = page.continueCursor;
        isDone = page.isDone;
      }
    }
    const incoming = await source.fetchIncidents(existingSourceIds);
    found = incoming.length;
    const items: ImportItem[] = incoming.map((item) => serialiseIncident(item, source, runId));
    if (items.length) {
      const prefix = `source-imports/${runId}/${crypto.randomUUID()}`;
      const batches = Math.ceil(items.length / UPSERT_BATCH_SIZE);
      for (let index = 0; index < batches; index++) {
        await ctx.storage.put(`${prefix}/${index}.json`, JSON.stringify(items.slice(index * UPSERT_BATCH_SIZE, (index + 1) * UPSERT_BATCH_SIZE)));
      }
      await ctx.runMutation(internal.incidents.prepareImport, { runId, prefix, batches, found });
      return { source: source.id, runId, found, created: 0, updated: 0, status: "queued", errors: [] };
    }
  } catch (error) {
    fetchFailed = true;
    errors.push(error instanceof Error ? error.message : "Unknown source failure");
  }

  const status = fetchFailed ? "failed" : errors.length ? "partial" : "success";
  await ctx.runMutation(internal.incidents.finishRun, {
    runId,
    status,
    incidentsFound: found,
    created,
    updated,
    errors,
  });
  return { source: source.id, found, created, updated, status, errors: errors.slice(0, 50) };
}

export const getImportWork = internalQuery({
  args: { runId: v.id("ingestionRuns") },
  handler: (ctx, { runId }) => ctx.db.get("ingestionRuns", runId),
});

export const getImportResult = internalQuery({
  args: { runId: v.id("ingestionRuns") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get("ingestionRuns", runId);
    return run ? { source: run.source, runId, status: run.status ?? "running", found: run.incidentsFound,
      created: run.created, updated: run.updated, errors: run.errors } : null;
  },
});

export const prepareImport = internalMutation({
  args: { runId: v.id("ingestionRuns"), prefix: v.string(), batches: v.number().int().positive(), found: v.number().int().positive() },
  handler: async (ctx, { runId, prefix, batches, found }) => {
    const run = await ctx.db.get("ingestionRuns", runId);
    if (!run || run.status !== "running" || run.pipeline) throw new Error("Import is not awaiting preparation");
    if (batches !== Math.ceil(found / UPSERT_BATCH_SIZE)) throw new Error("Import batch count does not match the source archive");
    await ctx.db.patch(runId, { incidentsFound: found, pipeline: { prefix, batches, nextBatch: 0 } });
    await ctx.scheduler.runAfter(0, internal.incidents.processImportBatch, { runId, index: 0 });
  },
});

export const applyImportBatch = internalMutation({
  args: { runId: v.id("ingestionRuns"), index: v.number().int().nonnegative(), items: v.array(schema.incidents.validator).max(UPSERT_BATCH_SIZE) },
  handler: async (ctx, { runId, index, items }) => {
    const run = await ctx.db.get("ingestionRuns", runId);
    if (!run?.pipeline || run.status !== "running" || run.pipeline.nextBatch !== index) return { applied: false };
    if (items.length !== Math.min(UPSERT_BATCH_SIZE, run.incidentsFound - index * UPSERT_BATCH_SIZE)) throw new Error("Import batch is incomplete");
    const latest = await ctx.db.query("ingestionRuns").withIndex("by_source_startedAt", q => q.eq("source", run.source)).order("desc").first();
    if (latest?._id !== runId) {
      await ctx.db.patch(runId, { status: "failed", completedAt: Date.now(), errors: ["Superseded by a newer source refresh"] });
      return { applied: false };
    }
    if (items.some(item => item.sourceKey !== run.source || item.sourceRunId !== runId)) throw new Error("Import batch belongs to another refresh");
    const result = await upsertBatch.handler(ctx, { items });
    const nextBatch = index + 1;
    const done = nextBatch === run.pipeline.batches;
    await ctx.db.patch(runId, { created: run.created + result.created, updated: run.updated + result.updated,
      pipeline: { ...run.pipeline, nextBatch }, ...(done ? { status: "success" as const, completedAt: Date.now() } : {}) });
    if (!done) await ctx.scheduler.runAfter(0, internal.incidents.processImportBatch, { runId, index: nextBatch });
    return { applied: true };
  },
});

export const processImportBatch = internalAction({
  args: { runId: v.id("ingestionRuns"), index: v.number().int().nonnegative() },
  handler: async (ctx, { runId, index }) => {
    const run: Doc<"ingestionRuns"> | null = await ctx.runQuery(internal.incidents.getImportWork, { runId });
    if (!run?.pipeline) return;
    const key = `${run.pipeline.prefix}/${index}.json`;
    if (run.status !== "running" || run.pipeline.nextBatch !== index) { await ctx.storage.delete(key); return; }
    const blob = await ctx.storage.get(key);
    if (!blob) throw new Error("Prepared import batch is missing");
    const items = v.array(schema.incidents.validator).max(UPSERT_BATCH_SIZE).parse(await readResponseJson(new Response(blob), 20 * 1024 * 1024));
    if (sources.find(source => source.id === run.source)?.superCategory === "Food") await attachProductCategoryTags(ctx, items);
    await ctx.runMutation(internal.incidents.applyImportBatch, { runId, index, items });
    await ctx.storage.delete(key);
  },
});

export const refreshSourceInternal = internalAction({
  args: { sourceId: v.string() },
  handler: async (ctx, { sourceId }): Promise<ImportResult | { source: string; status: "external" }> => {
    // An external fetch keeps USDA's hosted-IP block out of the daily cron.
    // Missing external updates still expire through the normal health gate.
    if ((sourceId === "fsis" && process.env.FSIS_FETCH_MODE === "snapshot") || (sourceId === "fda-announcements" && process.env.FDA_ANNOUNCEMENTS_FETCH_MODE === "snapshot")) return { source: sourceId, status: "external" };
    const source = sources.find((candidate) => candidate.id === sourceId);
    if (!source) throw new Error(`Unknown incident source: ${sourceId}`);
    return await ingestSource(ctx, source);
  },
});

// Admin-only upload/import functions. No public caller can supply recall data.
export const importFsisSnapshotInternal = internalAction({
  args: { storageId: v.string(), fetchedAt: v.number() },
  handler: async (ctx, { storageId, fetchedAt }): Promise<ImportResult> => {
    try {
      return await ingestSource(ctx, {
        ...fsisSource,
        fetchIncidents: async (existingSourceIds) => fsisIncidentsForSync(
          await readFsisSnapshot(await ctx.storage.get(storageId), fetchedAt),
          existingSourceIds,
        ),
      });
    } finally {
      await ctx.storage.delete(storageId);
    }
  },
});

export const importFdaSnapshotInternal = internalAction({
  args: { storageId: v.string(), fetchedAt: v.number() },
  handler: async (ctx, { storageId, fetchedAt }): Promise<ImportResult> => {
    try {
      return await ingestSource(ctx, { ...fdaAnnouncementsSource, fetchIncidents: async () => readFdaSnapshot(await ctx.storage.get(storageId), fetchedAt) });
    } finally { await ctx.storage.delete(storageId); }
  },
});

export const refreshAllInternal = internalAction({
  args: {},
  handler: async (ctx) => {
    const scheduled = scheduledSources();
    await Promise.all(scheduled.map((source, index) => ctx.scheduler.runAfter(
      index * 30_000,
      internal.incidents.refreshSourceInternal,
      { sourceId: source.id },
    )));
    return { queued: scheduled.map((source) => source.id) };
  },
});

export const queueSourceRefresh = internalMutation({
  args: { sourceId: v.string() },
  handler: async (ctx, { sourceId }) => {
    if (!sources.some(source => source.id === sourceId)) throw new Error("Unknown incident source");
    await ctx.scheduler.runAfter(0, internal.incidents.refreshSourceInternal, { sourceId });
    return { queued: sourceId };
  },
});

function scheduledSources() {
  return sources.filter(source => !(source.id === "fsis" && process.env.FSIS_FETCH_MODE === "snapshot") && !(source.id === "fda-announcements" && process.env.FDA_ANNOUNCEMENTS_FETCH_MODE === "snapshot"));
}

export const refreshScheduledInternal = internalAction({
  args: {},
  handler: async (ctx): Promise<{ queued: string[] }> => {
    if (process.env.SCHEDULED_SOURCE_REFRESH === "false") return { queued: [] };
    return ctx.runAction(internal.incidents.refreshAllInternal, {});
  },
});

export const refreshAll = action({
  args: { secret: v.string() },
  handler: async (ctx, args): Promise<{ queued: string[] }> => {
    requireServerSecret(args.secret);
    await ctx.scheduler.runAfter(0, internal.incidents.refreshAllInternal, {});
    return { queued: scheduledSources().map((source) => source.id) };
  },
});
