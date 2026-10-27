import "server-only";

import { fetchQuery } from "@backend/client";
import { unstable_cache } from "next/cache";
import { cache } from "react";

import { api } from "@backend/api";
import type { DatasetStatus, MatchableIncident } from "@/lib/domain/types";
import { rowSuperCategories } from "@/lib/incidents/super-categories";

const MATCH_DATA_CACHE_TTL_MS = 5 * 60 * 1_000;
const MAX_MATCH_DATA_CACHE_ENTRIES = 4;
const MAX_PUBLIC_SNAPSHOT_ROWS_PER_REVISION = 5_000;
const MAX_PUBLIC_SNAPSHOT_PAGES_PER_REVISION = 50;
const MAX_PUBLIC_SNAPSHOT_ROWS_PER_REQUEST = MAX_PUBLIC_SNAPSHOT_ROWS_PER_REVISION * 2;
const MAX_PUBLIC_SNAPSHOT_PAGES_PER_REQUEST = MAX_PUBLIC_SNAPSHOT_PAGES_PER_REVISION * 2;

type Region = "UK" | "US";

function deploymentUrl() {
  const url = process.env.BACKEND_URL;
  if (!url) throw new Error("BACKEND_URL is required to load warnings.");
  return url;
}

async function activePage(region: Region, cursor: string | null, url: string, includeDemo: boolean) {
  return fetchQuery(api.incidents.getActivePage, {
    region,
    includeDemo,
    snapshot: true,
    cursor,
  }, { url });
}

type ActivePage = Awaited<ReturnType<typeof activePage>>;

// Cache each page separately so a full regional dataset cannot exceed the
// persistent data cache's 2 MiB entry limit. Revisions change with every write.
const cachedActivePage = unstable_cache(
  async (region: Region, cursor: string | null, url: string, includeDemo: boolean, version: string) => {
    void version; // Part of the cache key.
    return activePage(region, cursor, url, includeDemo);
  },
  ["matcher-page-v1"],
  { revalidate: false },
);

async function activeRows(region: Region, url: string, includeDemo: boolean, version: string) {
  const rows: ActivePage["page"] = [];
  let cursor: string | null = null;
  let isDone = false;
  while (!isDone) {
    const page: ActivePage = await cachedActivePage(region, cursor, url, includeDemo, version);
    rows.push(...page.page);
    cursor = page.continueCursor;
    isDone = page.isDone;
  }
  return rows;
}

type IncidentRow = Awaited<ReturnType<typeof activeRows>>[number];
async function incidentBySlug(slug: string, includeDemo: boolean, url: string) {
  return fetchQuery(api.incidents.getBySlug, { slug, includeDemo }, { url });
}
type IncidentDetailsRow = NonNullable<Awaited<ReturnType<typeof incidentBySlug>>>;
type PreparedIncident = { startsAt: number; endsAt?: number; incident: MatchableIncident };
type ActiveDatasetCacheEntry = { expiresAt: number; version: string; promise: Promise<PreparedIncident[]> };
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

function cachedActiveIncidents(region: Region, version: string, url: string): Promise<PreparedIncident[]> {
  const includeDemo = process.env.ALLOW_DEMO_DATA === "true";
  const key = `${url}:${region}:${includeDemo ? "demo" : "official"}`;
  const current = activeDatasetCache.get(key);
  if (current && current.version === version && current.expiresAt > Date.now()) return current.promise;

  const promise = activeRows(region, url, includeDemo, version).then((rows) => rows.map((row) => ({
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    incident: mapIncident(row),
  })));
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
  const url = deploymentUrl();
  // Health stays uncached, including failed/partial imports and the 48-hour gate.
  const { version, ...status } = await fetchQuery(api.incidents.getDatasetStatus, { region }, { url });
  const rows = await cachedActiveIncidents(region, version, url);
  const now = Date.now();
  const incidents = rows.filter((row) => activeAt(row, now)).map((row) => row.incident);
  return { incidents, status };
}

export async function getActiveIncidents(region: Region): Promise<MatchableIncident[]> {
  return (await getCheckDataset(region)).incidents;
}

function activeAt(row: { startsAt: number; endsAt?: number }, now: number) {
  return row.startsAt <= now && (row.endsAt === undefined || row.endsAt > now);
}

const cachedIncidentBySlug = unstable_cache(
  async (slug: string, includeDemo: boolean, url: string, version: string) => {
    void version;
    return incidentBySlug(slug, includeDemo, url);
  },
  ["warning-details-v3"],
  { revalidate: false },
);

export const getIncidentBySlug = cache(async (slug: string, includeDemo = false) => {
  const url = deploymentUrl();
  const version = await fetchQuery(api.incidents.getDatasetVersion, {}, { url });
  const row = await cachedIncidentBySlug(slug, includeDemo, url, version);
  return row ? { ...mapIncident(row), status: row.status, superCategories: rowSuperCategories(row) } : null;
});

const cachedPublicListPage = unstable_cache(
  async (region: Region, cursor: string | null, url: string, version: string, foodOnly: boolean) => {
    void version;
    return fetchQuery(api.incidents.listActivePage, { region, cursor, snapshot: true, expectedVersion: version, foodOnly }, { url });
  },
  ["public-warning-page-v8"],
  { revalidate: false },
);

type PublicIncidentRow = Awaited<ReturnType<typeof cachedPublicListPage>>["page"][number];

export class WarningSnapshotLimitError extends Error {
  readonly recoverable = true;

  constructor() {
    super("The complete warning dataset exceeds the supported search limit. No partial results were returned.");
    this.name = "WarningSnapshotLimitError";
  }
}

type SnapshotReadBudget = { pages: number; rows: number };

async function listPublicRegion(
  region: Region,
  url: string,
  requestedVersion?: string,
  options: { signal?: AbortSignal; budget?: SnapshotReadBudget; foodOnly?: boolean } = {},
) {
  const version = requestedVersion ?? await fetchQuery(api.incidents.getDatasetVersion, { region }, { url });
  const rows: Array<Awaited<ReturnType<typeof cachedPublicListPage>>["page"][number]> = [];
  const budget = options.budget;
  let revisionPages = 0;
  let revisionRows = 0;
  let cursor: string | null = null;
  let isDone = false;
  while (!isDone) {
    options.signal?.throwIfAborted();
    if (budget && (revisionPages >= MAX_PUBLIC_SNAPSHOT_PAGES_PER_REVISION || budget.pages >= MAX_PUBLIC_SNAPSHOT_PAGES_PER_REQUEST)) {
      throw new WarningSnapshotLimitError();
    }
    revisionPages += 1;
    if (budget) budget.pages += 1;
    const page = await cachedPublicListPage(region, cursor, url, version, options.foodOnly ?? false);
    options.signal?.throwIfAborted();
    if (budget && (
      revisionRows + page.page.length > MAX_PUBLIC_SNAPSHOT_ROWS_PER_REVISION ||
      budget.rows + page.page.length > MAX_PUBLIC_SNAPSHOT_ROWS_PER_REQUEST
    )) {
      throw new WarningSnapshotLimitError();
    }
    revisionRows += page.page.length;
    if (budget) budget.rows += page.page.length;
    rows.push(...page.page);
    cursor = page.continueCursor;
    isDone = page.isDone;
  }
  return rows;
}

function revisionChanged(error: unknown) {
  return error instanceof Error && "data" in error && typeof error.data === "object" && error.data !== null
    && "code" in error.data && error.data.code === "DATASET_REVISION_CHANGED";
}

async function currentPublicRegion(region: Region, url: string) {
  try { return await listPublicRegion(region, url); }
  catch (error) {
    if (!revisionChanged(error)) throw error;
    return listPublicRegion(region, url);
  }
}

/** A complete food-warning snapshot for integrations, with eligibility boundaries retained. */
export async function getPublicWarningSnapshot(region: Region, options: { signal?: AbortSignal } = {}): Promise<{
  rows: PublicIncidentRow[];
  revision: string;
  asOf: number;
  status: DatasetStatus;
}> {
  const url = deploymentUrl();
  const budget: SnapshotReadBudget = { pages: 0, rows: 0 };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    options.signal?.throwIfAborted();
    const { version: revision, ...status } = await fetchQuery(api.incidents.getDatasetStatus, { region }, { url });
    options.signal?.throwIfAborted();
    try {
      const rows = await listPublicRegion(region, url, revision, { signal: options.signal, budget, foodOnly: true });
      return { rows, revision, asOf: Date.now(), status };
    } catch (error) {
      if (options.signal?.aborted) options.signal.throwIfAborted();
      if (attempt === 1 || !revisionChanged(error)) throw error;
    }
  }
  throw new Error("A consistent warning snapshot could not be loaded.");
}

/** Reads source health without loading or traversing the public warning dataset. */
export async function getRegionCoverage(region: Region): Promise<DatasetStatus> {
  const url = deploymentUrl();
  const { version, ...status } = await fetchQuery(api.incidents.getDatasetStatus, { region }, { url });
  void version;
  return status;
}

// Only public browsing is cached here. Check requests still read source health every time.
export async function listActivePublicIncidents(region?: Region) {
  const url = deploymentUrl();
  const rows = region ? await currentPublicRegion(region, url)
    : (await Promise.all([currentPublicRegion("UK", url), currentPublicRegion("US", url)])).flat();
  const now = Date.now();
  return rows
    .filter((row) => activeAt(row, now))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((publicRow) => {
      const { authorityUrl, sourceId, publishedAt, ...row } = publicRow;
      void authorityUrl;
      void sourceId;
      void publishedAt;
      return { ...row, superCategories: rowSuperCategories(row), updatedAt: new Date(row.updatedAt) };
    });
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
