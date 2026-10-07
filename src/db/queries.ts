import "server-only";

import { fetchQuery } from "convex/nextjs";
import { cache } from "react";

import { api } from "@convex/_generated/api";
import type { DatasetStatus, MatchableIncident } from "@/lib/domain/types";

const MATCH_DATA_CACHE_TTL_MS = 5 * 60 * 1_000;
const MAX_MATCH_DATA_CACHE_ENTRIES = 4;

type Region = "UK" | "US";

async function activePage(region: Region, cursor: string | null) {
  return fetchQuery(api.incidents.getActivePage, {
    region,
    includeDemo: process.env.ALLOW_DEMO_DATA === "true",
    cursor,
  });
}

type ActivePage = Awaited<ReturnType<typeof activePage>>;

async function activeRows(region: Region) {
  const rows: ActivePage["page"] = [];
  let cursor: string | null = null;
  let isDone = false;
  while (!isDone) {
    const page: ActivePage = await activePage(region, cursor);
    rows.push(...page.page);
    cursor = page.continueCursor;
    isDone = page.isDone;
  }
  return rows;
}

type IncidentRow = Awaited<ReturnType<typeof activeRows>>[number];
async function incidentBySlug(slug: string, includeDemo = false) {
  return fetchQuery(api.incidents.getBySlug, { slug, includeDemo });
}
type IncidentDetailsRow = NonNullable<Awaited<ReturnType<typeof incidentBySlug>>>;
type ActiveDatasetCacheEntry = { expiresAt: number; version: string; promise: Promise<MatchableIncident[]> };
const activeDatasetCache = new Map<string, ActiveDatasetCacheEntry>();

function mapIncident(row: IncidentRow | IncidentDetailsRow): MatchableIncident {
  const incidentId = "incidentId" in row ? row.incidentId : row._id;
  return {
    id: incidentId,
    title: row.title,
    slug: row.slug,
    region: row.region,
    hazard: row.hazard ?? null,
    pathogen: row.pathogen ?? null,
    summary: row.summary,
    consumerAdvice: row.consumerAdvice,
    authority: row.authority,
    authorityUrl: row.authorityUrl,
    sourceId: row.sourceId,
    publishedAt: new Date(row.publishedAt),
    updatedAt: new Date(row.updatedAt),
    severity: row.severity,
    confidence: row.confidence,
    targets: row.targets.map((target, index) => ({
      id: `${incidentId}:${index}`,
      incidentId,
      type: target.type,
      value: target.value,
      valueNormalized: target.valueNormalized,
      matchType: target.matchType,
      groupId: target.groupId ?? null,
      dateFrom: target.dateFrom ? new Date(target.dateFrom) : null,
      dateTo: target.dateTo ? new Date(target.dateTo) : null,
      notes: target.notes ?? null,
      weight: target.weight,
      confidence: target.confidence,
    })),
  };
}

function cachedActiveIncidents(region: Region, version: string): Promise<MatchableIncident[]> {
  const includeDemo = process.env.ALLOW_DEMO_DATA === "true";
  const key = `${region}:${includeDemo ? "demo" : "official"}`;
  const current = activeDatasetCache.get(key);
  if (current && current.version === version && current.expiresAt > Date.now()) return current.promise;

  // This worker-local cache holds only the compact matcher table and is invalidated by each new successful source snapshot.
  const promise = activeRows(region).then((rows) => rows.map(mapIncident));
  activeDatasetCache.delete(key);
  activeDatasetCache.set(key, { expiresAt: Date.now() + MATCH_DATA_CACHE_TTL_MS, version, promise });
  while (activeDatasetCache.size > MAX_MATCH_DATA_CACHE_ENTRIES) {
    const oldestKey = activeDatasetCache.keys().next().value;
    if (oldestKey === undefined) break;
    activeDatasetCache.delete(oldestKey);
  }
  void promise.catch(() => {
    if (activeDatasetCache.get(key)?.promise === promise) activeDatasetCache.delete(key);
  });
  return promise;
}

export async function getCheckDataset(region: Region): Promise<{ incidents: MatchableIncident[]; status: DatasetStatus }> {
  const status = await fetchQuery(api.incidents.getDatasetStatus, { region });
  const version = status.sources.map((source) => `${source.id}:${source.lastSuccessfulAt ?? "never"}`).join("|");
  const incidents = await cachedActiveIncidents(region, version);
  return { incidents, status };
}

export async function getActiveIncidents(region: Region): Promise<MatchableIncident[]> {
  return (await getCheckDataset(region)).incidents;
}

export const getIncidentBySlug = cache(async (slug: string, includeDemo = false) => {
  const row = await incidentBySlug(slug, includeDemo);
  return row ? mapIncident(row) : null;
});

export async function listActivePublicIncidents() {
  async function listRegion(region: Region) {
    const rows: Array<Awaited<ReturnType<typeof publicListPage>>["page"][number]> = [];
    let cursor: string | null = null;
    let isDone = false;
    while (!isDone) {
      const page = await publicListPage(region, cursor);
      rows.push(...page.page);
      cursor = page.continueCursor;
      isDone = page.isDone;
    }
    return rows;
  }

  const rows = (await Promise.all([listRegion("UK"), listRegion("US")])).flat();
  return rows
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((row) => ({ ...row, updatedAt: new Date(row.updatedAt) }));
}

async function publicListPage(region: Region, cursor: string | null) {
  return fetchQuery(api.incidents.listActivePage, { region, cursor });
}

export async function getPublicShare(id: string) {
  const row = await fetchQuery(api.shares.get, { shareId: id });
  if (!row) return null;
  return {
    id: row.shareId,
    verdict: row.verdict,
    matchLevel: row.matchLevel,
    productName: row.productName ?? null,
    reason: row.reason,
    incidentSlug: row.incidentSlug ?? null,
    checkedAt: row.checkedAt === undefined ? null : new Date(row.checkedAt),
    datasetRegions: row.datasetRegions ?? [],
    sourceScope: row.sourceScope ?? null,
    expiresAt: new Date(row.expiresAt),
  };
}
