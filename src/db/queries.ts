import "server-only";

import { fetchQuery } from "convex/nextjs";
import { cache } from "react";

import { api } from "@convex/_generated/api";
import type { MatchableIncident } from "@/lib/domain/types";

async function activeRows(region: "UK" | "US") {
  return fetchQuery(api.incidents.getActive, { region, includeDemo: process.env.ALLOW_DEMO_DATA === "true" });
}

type IncidentRow = Awaited<ReturnType<typeof activeRows>>[number];

function mapIncident(row: IncidentRow): MatchableIncident {
  return {
    id: row._id,
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
      id: `${row._id}:${index}`,
      incidentId: row._id,
      type: target.type,
      value: target.value,
      valueNormalized: target.valueNormalized,
      matchType: target.matchType,
      dateFrom: target.dateFrom ? new Date(target.dateFrom) : null,
      dateTo: target.dateTo ? new Date(target.dateTo) : null,
      notes: target.notes ?? null,
      weight: target.weight,
      confidence: target.confidence,
    })),
  };
}

export async function getActiveIncidents(region: "UK" | "US"): Promise<MatchableIncident[]> {
  return (await activeRows(region)).map(mapIncident);
}

export const getIncidentBySlug = cache(async (slug: string, includeDemo = false) => {
  const row = await fetchQuery(api.incidents.getBySlug, { slug, includeDemo });
  return row ? mapIncident(row) : null;
});

export async function listActivePublicIncidents() {
  return (await fetchQuery(api.incidents.listActive, {})).map((row) => ({ ...row, updatedAt: new Date(row.updatedAt) }));
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
    expiresAt: new Date(row.expiresAt),
  };
}
