import "server-only";

import type { z } from "zod";

import type { CheckProductResult } from "@/lib/checks/service";
import type { ProductObservation, Region } from "@/lib/domain/schemas";
import type { DatasetStatus, MatchableIncident, MatchableTarget } from "@/lib/domain/types";
import { classifyHazard } from "@/lib/incidents/hazard";
import { publicOfficialSource } from "@/lib/incidents/public-source";
import type { SearchWarningsResult } from "@/lib/incidents/search";
import {
  AgentObservationSchema, CONTRACT_VERSION, MAX_PUBLIC_RESPONSE_BYTES,
  PublicCheckResultSchema, PublicCoverageSchema, PublicSearchResultSchema,
  PublicWarningDetailsSchema, PublicWarningSummarySchema,
  type PublicAffectedGroup,
} from "./contracts";

const qualification = "This compares the supplied evidence with published warnings in the displayed coverage. No matching warning does not establish that food is safe.";

export class PublicResponseTooLargeError extends Error {
  constructor() {
    super("The warning details exceed the response limit. Open the linked official notice to review all affected products and codes.");
    this.name = "PublicResponseTooLargeError";
  }
}

export function validatePublicResponse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.parse(value);
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > MAX_PUBLIC_RESPONSE_BYTES) throw new PublicResponseTooLargeError();
  return result;
}

function websiteUrl(slug: string) {
  const base = new URL(process.env.NEXT_PUBLIC_APP_URL ?? "https://eatoryeet.app");
  if (base.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && base.protocol === "http:" && ["localhost", "127.0.0.1"].includes(base.hostname))) {
    throw new Error("A trusted HTTPS application URL is required.");
  }
  return new URL(`/incidents/${encodeURIComponent(slug)}`, base).href;
}

export function serializeCoverage(status: DatasetStatus, region: Region) {
  return validatePublicResponse(PublicCoverageSchema, {
    contractVersion: CONTRACT_VERSION,
    region,
    healthy: status.healthy && status.checkedAt !== null && status.regions.includes(region),
    checkedAt: status.checkedAt,
    coveredRegions: [...status.regions],
    sources: status.sources.map((source) => ({
      id: source.id, name: source.name, region: source.region,
      lastSuccessfulAt: source.lastSuccessfulAt, status: source.status, scope: source.scope,
    })),
  });
}

type WarningSource = {
  slug: string; title: string; region: Region; summary: string;
  hazard?: string | null; pathogen?: string | null; authority: string;
  authorityUrl?: string; sourceId?: string; publishedAt?: number | Date;
  updatedAt: number | Date;
};

export function serializeWarningSummary(incident: WarningSource) {
  const hazard = classifyHazard(incident);
  return PublicWarningSummarySchema.parse({
    slug: incident.slug, title: incident.title, region: incident.region,
    summary: incident.summary, hazard: incident.hazard ?? null,
    hazardKind: hazard.kind, hazardLabel: hazard.label, authority: incident.authority,
    publishedAt: incident.publishedAt === undefined ? null : new Date(incident.publishedAt).toISOString(),
    updatedAt: new Date(incident.updatedAt).toISOString(),
    websiteUrl: websiteUrl(incident.slug),
    officialSource: publicOfficialSource({
      authority: incident.authority,
      authorityUrl: incident.authorityUrl ?? "",
      sourceId: incident.sourceId ?? "",
    }),
  });
}

/** Untagged identifiers are separate groups, never an invented association. */
export function groupAffectedTargets(targets: MatchableTarget[]): PublicAffectedGroup[] {
  const groups = new Map<string, { association: PublicAffectedGroup["association"]; targets: MatchableTarget[] }>();
  targets.forEach((target, index) => {
    const groupId = target.groupId?.trim();
    const key = groupId ? `source:${groupId}` : `ungrouped:${index}`;
    const group = groups.get(key) ?? { association: groupId ? "source_group" : "ungrouped", targets: [] };
    group.targets.push(target);
    groups.set(key, group);
  });
  return [...groups.values()].map((group, index) => ({
    key: `group-${index + 1}`,
    association: group.association,
    targets: group.targets.map((target) => ({
      type: target.type, value: target.value, matchType: target.matchType,
      dateFrom: target.dateFrom?.toISOString() ?? null,
      dateTo: target.dateTo?.toISOString() ?? null, notes: target.notes,
    })),
  }));
}

function publicEvidence(observation: ProductObservation) {
  // Explicit mapping also excludes accidental properties added upstream.
  return AgentObservationSchema.parse({
    productName: observation.productName, brand: observation.brand, barcode: observation.barcode,
    batchCode: observation.batchCode, lotCode: observation.lotCode, producer: observation.producer,
    farmCode: observation.farmCode, countryOfOrigin: observation.countryOfOrigin,
    establishmentNumber: observation.establishmentNumber, approvalNumber: observation.approvalNumber,
    retailer: observation.retailer, category: observation.category,
    eggMark: observation.eggMark ? {
      farmingMethod: observation.eggMark.farmingMethod, country: observation.eggMark.country,
      producerCode: observation.eggMark.producerCode,
    } : null,
    dates: observation.dates ? {
      useBy: observation.dates.useBy, bestBefore: observation.dates.bestBefore,
      productionDate: observation.dates.productionDate,
    } : null,
  });
}

export function serializeCheckResult(check: CheckProductResult) {
  const { result, submittedObservation, enrichedObservation } = check;
  if (!result.datasetStatus || result.datasetRegions.length !== 1) throw new Error("Current regional coverage is required to serialise a check.");
  const submittedEvidence = publicEvidence(submittedObservation);
  const checkedEvidence = publicEvidence(enrichedObservation);
  const labels = {
    EAT: ["no_matching_warning", "No matching warning found"],
    YEET: ["warning_match", "Warning match"],
    MAYBE_YEET: ["possible_match", "Possible warning match"],
    NO_CLUE: ["inconclusive", result.inconclusiveReason === "incomplete_data" ? "Warning data unavailable" : "Not enough details"],
  } as const;
  const [status, label] = labels[result.verdict];
  const warnings = result.matches.slice(0, 10).map((match) => {
    const groups = groupAffectedTargets(match.incident.targets);
    return {
      warning: serializeWarningSummary(match.incident), level: match.level,
      reasons: match.reasons.map((reason) => ({ type: reason.type, message: reason.message, evidence: reason.evidence })),
      affectedGroups: groups.slice(0, 3), affectedGroupCount: groups.length,
      affectedGroupsComplete: groups.length <= 3,
      packetReviewRequired: match.level === "possible" || match.level === "contextual" || groups.length > 3,
    };
  });
  const matchCount = result.matchCount ?? result.matches.length;
  return validatePublicResponse(PublicCheckResultSchema, {
    contractVersion: CONTRACT_VERSION, status, label, qualification, checkedAt: result.checkedAt,
    matchLevel: result.matchLevel, submittedEvidence, checkedEvidence,
    enrichedFields: (Object.keys(checkedEvidence) as Array<keyof typeof checkedEvidence>)
      .filter((field) => JSON.stringify(submittedEvidence[field]) !== JSON.stringify(checkedEvidence[field])),
    coverage: serializeCoverage(result.datasetStatus, result.datasetRegions[0]),
    inconclusiveReason: result.inconclusiveReason ?? null,
    warnings, matchCount, matchesComplete: warnings.length === matchCount,
  });
}

export function serializeSearchResult(result: SearchWarningsResult, region: Region) {
  return validatePublicResponse(PublicSearchResultSchema, {
    contractVersion: CONTRACT_VERSION,
    qualification: "Warning search is discovery, not a product check. No search results do not establish that food is safe.",
    asOf: result.asOf, coverage: serializeCoverage(result.status, region),
    warnings: result.items.map(serializeWarningSummary), total: result.total,
    nextCursor: result.nextCursor, complete: result.complete,
  });
}

/** The caller provides a whole-group page and its signed continuation. */
export function serializeWarningDetails(incident: MatchableIncident, groups: PublicAffectedGroup[], total: number, nextCursor: string | null) {
  return validatePublicResponse(PublicWarningDetailsSchema, {
    contractVersion: CONTRACT_VERSION, warning: serializeWarningSummary(incident),
    consumerAdvice: incident.consumerAdvice, affectedGroups: groups, affectedGroupCount: total,
    affectedGroupsComplete: groups.length === total, nextCursor,
  });
}
