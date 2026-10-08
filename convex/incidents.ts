import { v } from "convex/values";

import { fdaAnnouncementsSource } from "../src/lib/incidents/fda-announcements";
import { fdaSource, parseFdaRecord } from "../src/lib/incidents/fda";
import { fsisSource } from "../src/lib/incidents/fsis";
import { fsaSource } from "../src/lib/incidents/fsa";
import type { IncidentSource, NormalisedIncident, NormalisedTarget } from "../src/lib/incidents/types";
import { browseCategories, namedRetailers } from "../src/lib/incidents/browse";
import { buildDatasetStatus, type IngestionRunSummary } from "../src/lib/incidents/dataset-status";
import { cleanupNeedsContinuation, EPHEMERAL_CLEANUP_BATCH_SIZE } from "../src/lib/incidents/cleanup-batches";
import { normaliseCode, normaliseGtin, normaliseText } from "../src/lib/matching/normalise";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalAction, internalMutation, internalQuery, query, type ActionCtx } from "./_generated/server";
import { requireServerSecret } from "./security";

const sources: IncidentSource[] = [fsaSource, fdaSource, fdaAnnouncementsSource, fsisSource];
const UPSERT_BATCH_SIZE = 25;
const DATASET_PAGE_SIZE = 100;
const LEGACY_FDA_REPAIR_PAGE_SIZE = 25;

function normalisedTargetValue(target: NormalisedTarget): string {
  if (target.type === "gtin") return normaliseGtin(target.value);
  if (["batch", "lot", "establishment", "approval", "eggProducerCode"].includes(target.type)) return normaliseCode(target.value);
  return normaliseText(target.value);
}

function serialiseIncident(item: NormalisedIncident, source: IncidentSource, runId: Id<"ingestionRuns">) {
  return {
    ...item,
    sourceKey: source.id,
    sourceRunId: runId,
    hazard: item.hazard ?? undefined,
    pathogen: item.pathogen ?? undefined,
    publishedAt: item.publishedAt.getTime(),
    updatedAt: item.updatedAt.getTime(),
    startsAt: item.startsAt.getTime(),
    endsAt: item.endsAt?.getTime(),
    retrievedAt: Date.now(),
    isDemo: false,
    targets: item.targets.map((target) => ({
      type: target.type,
      value: target.value,
      valueNormalized: normalisedTargetValue(target),
      matchType: target.matchType ?? "exact",
      dateFrom: target.dateFrom?.getTime(),
      dateTo: target.dateTo?.getTime(),
      notes: target.notes ?? undefined,
      groupId: target.groupId ?? undefined,
      weight: target.weight ?? 25,
      confidence: target.confidence ?? 1,
    })),
  };
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
>;

function compactMatchRecord(incidentId: Id<"incidents">, item: MatchProjectionInput) {
  const browseSource = {
    title: item.title,
    targets: item.targets,
    originalSourceData: item.originalSourceData,
  };

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
    sourceKey: item.sourceKey ?? inferSourceKey(item.authority, item.sourceId),
    categories: browseCategories(browseSource),
    stores: namedRetailers(browseSource),
  };
}

function inferSourceKey(authority: string, sourceId: string): string | undefined {
  if (authority === "Food Standards Agency") return "fsa";
  if (authority === "U.S. Food and Drug Administration") {
    return sourceId.startsWith("announcement:") ? "fda-announcements" : "fda";
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
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const page = await ctx.db
      .query("incidentMatchData")
      .withIndex("by_region_status", (q) => q.eq("region", args.region).eq("status", "active"))
      .paginate({ numItems: DATASET_PAGE_SIZE, cursor: args.cursor });
    return {
      ...page,
      page: page.page
        .filter((row) => activeMatchData(row, now, args.includeDemo ?? false))
        .map((row) => ({
          incidentId: row.incidentId,
          title: row.title,
          slug: row.slug,
          region: row.region,
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
    };
  },
});

export const listActivePage = query({
  args: {
    region: v.union(v.literal("UK"), v.literal("US")),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const page = await ctx.db
      .query("incidentMatchData")
      .withIndex("by_region_status", (q) => q.eq("region", args.region).eq("status", "active"))
      .paginate({ numItems: DATASET_PAGE_SIZE, cursor: args.cursor });
    return {
      ...page,
      page: page.page.filter((row) => activeMatchData(row, now, false)).map((row) => ({
        id: row.incidentId,
        title: row.title,
        slug: row.slug,
        region: row.region,
        summary: row.summary,
        hazard: row.hazard?.slice(0, 400) ?? null,
        pathogen: row.pathogen ?? null,
        authority: row.authority,
        updatedAt: row.updatedAt,
        categories: row.categories,
        stores: row.stores,
      })),
    };
  },
});

export const getDatasetStatus = query({
  args: { region: v.union(v.literal("UK"), v.literal("US")) },
  handler: async (ctx, args) => {
    const requiredSources = sources.filter((source) => source.region === args.region);
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

    return buildDatasetStatus(args.region, requiredSources, Object.fromEntries(pairs));
  },
});

export const getActiveSourceIdsPage = internalQuery({
  args: { sourceKey: v.string(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { sourceKey, cursor }) => {
    const page = await ctx.db
      .query("incidentMatchData")
      .withIndex("by_sourceKey_status", (q) => q.eq("sourceKey", sourceKey).eq("status", "active"))
      .paginate({ numItems: DATASET_PAGE_SIZE, cursor });
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

      await ctx.db.patch(row._id, { sourceId });
      const compact = await ctx.db
        .query("incidentMatchData")
        .withIndex("by_incidentId", (q) => q.eq("incidentId", row._id))
        .unique();
      if (compact) await ctx.db.patch(compact._id, { sourceId });
      repaired += 1;
    }

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

export const upsertBatch = internalMutation({
  args: { items: v.array(v.any()) },
  handler: async (ctx, { items }) => {
    let created = 0;
    let updated = 0;
    for (const item of items) {
      const existing = await ctx.db
        .query("incidents")
        .withIndex("by_authority_sourceId", (q) => q.eq("authority", item.authority).eq("sourceId", item.sourceId))
        .unique();
      let incidentId;
      if (existing) {
        incidentId = existing._id;
        await ctx.db.patch(existing._id, item);
        updated += 1;
      } else {
        incidentId = await ctx.db.insert("incidents", item);
        created += 1;
      }

      const matchRecord = compactMatchRecord(incidentId, item);
      const existingMatch = await ctx.db
        .query("incidentMatchData")
        .withIndex("by_incidentId", (q) => q.eq("incidentId", incidentId))
        .unique();
      if (existingMatch) await ctx.db.patch(existingMatch._id, matchRecord);
      else await ctx.db.insert("incidentMatchData", matchRecord);
    }
    return { created, updated };
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
    const [shares, limits] = await Promise.all([
      ctx.db.query("publicShares").withIndex("by_expiresAt", (q) => q.lt("expiresAt", now)).take(EPHEMERAL_CLEANUP_BATCH_SIZE),
      ctx.db.query("rateLimits").withIndex("by_expiresAt", (q) => q.lt("expiresAt", now)).take(EPHEMERAL_CLEANUP_BATCH_SIZE),
    ]);
    await Promise.all([...shares, ...limits].map((row) => ctx.db.delete(row._id)));

    if (cleanupNeedsContinuation(shares.length, limits.length)) {
      await ctx.scheduler.runAfter(0, internal.incidents.cleanupExpired, {});
    }
    return { sharesDeleted: shares.length, rateLimitsDeleted: limits.length };
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
    for (const row of page.page) {
      const existing = await ctx.db
        .query("incidentMatchData")
        .withIndex("by_incidentId", (q) => q.eq("incidentId", row._id))
        .unique();
      if (existing) continue;
      await ctx.db.insert("incidentMatchData", compactMatchRecord(row._id, row));
      inserted += 1;
    }

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

async function ingestSource(ctx: ActionCtx, source: IncidentSource) {
  const runId = await ctx.runMutation(internal.incidents.beginRun, {
    source: source.id,
    sourceName: source.name,
    region: source.region,
    scope: source.scope,
  });
  let created = 0;
  let updated = 0;
  const errors: string[] = [];
  let found = 0;
  let fetchFailed = false;

  try {
    const existingSourceIds: string[] = [];
    if (source.id === "fda") {
      await ctx.runAction(internal.incidents.repairLegacyFdaSourceIdsInternal, {});
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
    const items = incoming.map((item) => serialiseIncident(item, source, runId));
    for (let offset = 0; offset < items.length; offset += UPSERT_BATCH_SIZE) {
      try {
        const result = await ctx.runMutation(internal.incidents.upsertBatch, {
          items: items.slice(offset, offset + UPSERT_BATCH_SIZE),
        });
        created += result.created;
        updated += result.updated;
      } catch (error) {
        errors.push(`Batch ${Math.floor(offset / UPSERT_BATCH_SIZE) + 1}: ${error instanceof Error ? error.message : "Unknown write failure"}`);
      }
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

export const refreshSourceInternal = internalAction({
  args: { sourceId: v.string() },
  handler: async (ctx, { sourceId }) => {
    const source = sources.find((candidate) => candidate.id === sourceId);
    if (!source) throw new Error(`Unknown incident source: ${sourceId}`);
    return await ingestSource(ctx, source);
  },
});

export const refreshAllInternal = internalAction({
  args: {},
  handler: async (ctx) => {
    await ctx.runAction(internal.incidents.backfillMatchDataInternal, {});
    await Promise.all(sources.map((source, index) => ctx.scheduler.runAfter(
      index * 30_000,
      internal.incidents.refreshSourceInternal,
      { sourceId: source.id },
    )));
    return { queued: sources.map((source) => source.id) };
  },
});

export const refreshAll = action({
  args: { secret: v.string() },
  handler: async (ctx, args): Promise<{ queued: string[] }> => {
    requireServerSecret(args.secret);
    await ctx.scheduler.runAfter(0, internal.incidents.refreshAllInternal, {});
    return { queued: sources.map((source) => source.id) };
  },
});
