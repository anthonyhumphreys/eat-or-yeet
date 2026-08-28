import { v } from "convex/values";

import { fdaAnnouncementsSource } from "../src/lib/incidents/fda-announcements";
import { fdaSource } from "../src/lib/incidents/fda";
import { fsaSource } from "../src/lib/incidents/fsa";
import type { IncidentSource, NormalisedIncident, NormalisedTarget } from "../src/lib/incidents/types";
import { browseCategories, namedRetailers } from "../src/lib/incidents/browse";
import { normaliseCode, normaliseGtin, normaliseText } from "../src/lib/matching/normalise";
import { internal } from "./_generated/api";
import { action, internalAction, internalMutation, query, type ActionCtx } from "./_generated/server";
import { requireServerSecret } from "./security";

const sources: IncidentSource[] = [fsaSource, fdaSource, fdaAnnouncementsSource];

function normalisedTargetValue(target: NormalisedTarget): string {
  if (target.type === "gtin") return normaliseGtin(target.value);
  if (["batch", "lot", "establishment", "approval", "eggProducerCode"].includes(target.type)) return normaliseCode(target.value);
  return normaliseText(target.value);
}

function serialiseIncident(item: NormalisedIncident) {
  return {
    ...item,
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
      weight: target.weight ?? 25,
      confidence: target.confidence ?? 1,
    })),
  };
}

export const getActive = query({
  args: { region: v.union(v.literal("UK"), v.literal("US")), includeDemo: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const rows = await ctx.db.query("incidents").withIndex("by_region_status", (q) => q.eq("region", args.region).eq("status", "active")).collect();
    return rows.filter((row) => (args.includeDemo || !row.isDemo) && row.startsAt <= now && (!row.endsAt || row.endsAt > now));
  },
});

export const getBySlug = query({
  args: { slug: v.string(), includeDemo: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("incidents").withIndex("by_slug", (q) => q.eq("slug", args.slug)).unique();
    return row && (args.includeDemo || !row.isDemo) ? row : null;
  },
});

export const listActive = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const rows = await ctx.db.query("incidents").withIndex("by_status", (q) => q.eq("status", "active")).collect();
    return rows
      .filter((row) => !row.isDemo && row.startsAt <= now && (!row.endsAt || row.endsAt > now))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((row) => ({
        id: row._id,
        title: row.title,
        slug: row.slug,
        region: row.region,
        summary: row.summary,
        authority: row.authority,
        updatedAt: row.updatedAt,
        categories: browseCategories(row),
        stores: namedRetailers(row),
      }));
  },
});

export const beginRun = internalMutation({
  args: { source: v.string() },
  handler: (ctx, args) => ctx.db.insert("ingestionRuns", { source: args.source, startedAt: Date.now(), incidentsFound: 0, created: 0, updated: 0, errors: [] }),
});

export const upsert = internalMutation({
  args: { item: v.any() },
  handler: async (ctx, { item }) => {
    const existing = await ctx.db.query("incidents").withIndex("by_authority_sourceId", (q) => q.eq("authority", item.authority).eq("sourceId", item.sourceId)).unique();
    if (existing) {
      await ctx.db.patch(existing._id, item);
      return false;
    }
    await ctx.db.insert("incidents", item);
    return true;
  },
});

export const finishRun = internalMutation({
  args: { runId: v.id("ingestionRuns"), incidentsFound: v.number(), created: v.number(), updated: v.number(), errors: v.array(v.string()) },
  handler: (ctx, args) => ctx.db.patch(args.runId, { completedAt: Date.now(), incidentsFound: args.incidentsFound, created: args.created, updated: args.updated, errors: args.errors }),
});

export const cleanup = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const shares = await ctx.db.query("publicShares").withIndex("by_expiresAt", (q) => q.lt("expiresAt", now)).collect();
    const limits = await ctx.db.query("rateLimits").withIndex("by_expiresAt", (q) => q.lt("expiresAt", now)).collect();
    await Promise.all([...shares, ...limits].map((row) => ctx.db.delete(row._id)));
  },
});

async function ingestSource(ctx: ActionCtx, source: IncidentSource) {
  const runId = await ctx.runMutation(internal.incidents.beginRun, { source: source.name });
  let created = 0;
  let updated = 0;
  const errors: string[] = [];
  let found = 0;
  try {
    const incoming = await source.fetchIncidents();
    found = incoming.length;
    for (const item of incoming) {
      try {
        const wasCreated = await ctx.runMutation(internal.incidents.upsert, { item: serialiseIncident(item) });
        if (wasCreated) created += 1;
        else updated += 1;
      } catch (error) {
        errors.push(`${item.sourceId}: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Unknown source failure");
  }
  await ctx.runMutation(internal.incidents.finishRun, { runId, incidentsFound: found, created, updated, errors });
  return { source: source.id, found, created, updated, errors };
}

export const refreshAllInternal = internalAction({
  args: {},
  handler: async (ctx) => {
    await ctx.runMutation(internal.incidents.cleanup, {});
    const results = [];
    for (const source of sources) results.push(await ingestSource(ctx, source));
    return results;
  },
});

export const refreshAll = action({
  args: { secret: v.string() },
  handler: async (ctx, args): Promise<Array<{ source: string; found: number; created: number; updated: number; errors: string[] }>> => {
    requireServerSecret(args.secret);
    return await ctx.runAction(internal.incidents.refreshAllInternal, {});
  },
});
