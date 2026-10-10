import { z } from "zod";

import { isValidGtin } from "@/lib/domain/gtin";
import { RegionSchema, TargetTypeSchema } from "@/lib/domain/schemas";
import { foodCategories } from "@/lib/incidents/browse";
import { hazardKinds } from "@/lib/incidents/hazard";

export const CONTRACT_VERSION = "1" as const;
export const MAX_PUBLIC_RESPONSE_BYTES = 64 * 1024;

const visibleString = z.string().trim().max(300).nullable();
const optionalString = visibleString.optional().default(null);
const calendarDate = z.iso.date().nullable().optional().default(null);
const timestamp = z.iso.datetime();

// Defaults fill absent facts, never infer them. The browser's more permissive
// date input and default region stay in its existing request schema.
export const AgentObservationSchema = z.strictObject({
  productName: optionalString,
  brand: optionalString,
  barcode: visibleString.refine((value) => !value || isValidGtin(value), "Enter a valid GTIN barcode.").optional().default(null),
  batchCode: optionalString,
  lotCode: optionalString,
  producer: optionalString,
  farmCode: optionalString,
  countryOfOrigin: optionalString,
  establishmentNumber: optionalString,
  approvalNumber: optionalString,
  retailer: optionalString,
  category: optionalString,
  eggMark: z.strictObject({
    farmingMethod: optionalString,
    country: optionalString,
    producerCode: optionalString,
  }).nullable().optional().default(null),
  dates: z.strictObject({
    useBy: calendarDate,
    bestBefore: calendarDate,
    productionDate: calendarDate,
  }).nullable().optional().default(null),
});

export const CheckProductInputSchema = z.strictObject({
  region: RegionSchema,
  observation: AgentObservationSchema,
});
export const SearchWarningsInputSchema = z.strictObject({
  region: RegionSchema,
  query: z.string().trim().max(200).optional(),
  hazard: z.enum(hazardKinds).optional(),
  category: z.enum(foodCategories).optional(),
  retailer: z.string().trim().max(200).optional(),
  pageSize: z.number().int().min(1).max(20).optional().default(20),
  cursor: z.string().min(1).max(2048).optional(),
});
export const GetWarningInputSchema = z.strictObject({
  slug: z.string().min(1).max(240).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  pageSize: z.number().int().min(1).max(20).optional().default(20),
  cursor: z.string().min(1).max(2048).optional(),
});
export const GetCoverageInputSchema = z.strictObject({ region: RegionSchema });

const sourceSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  region: RegionSchema,
  lastSuccessfulAt: timestamp.nullable(),
  status: z.enum(["healthy", "stale", "failed", "missing"]),
  scope: z.string(),
});
export const PublicCoverageSchema = z.strictObject({
  contractVersion: z.literal(CONTRACT_VERSION),
  region: RegionSchema,
  healthy: z.boolean(),
  checkedAt: timestamp.nullable(),
  coveredRegions: z.array(RegionSchema).max(2),
  sources: z.array(sourceSchema),
});

export const PublicWarningSummarySchema = z.strictObject({
  slug: z.string(),
  title: z.string(),
  region: RegionSchema,
  summary: z.string(),
  hazard: z.string().nullable(),
  hazardKind: z.enum(hazardKinds),
  hazardLabel: z.string(),
  authority: z.string(),
  publishedAt: timestamp.nullable(),
  updatedAt: timestamp,
  websiteUrl: z.url(),
  officialSource: z.strictObject({ url: z.url(), label: z.string(), note: z.string().optional() }),
});

const affectedTargetSchema = z.strictObject({
  type: TargetTypeSchema,
  value: z.string(),
  matchType: z.enum(["exact", "pattern"]),
  dateFrom: timestamp.nullable(),
  dateTo: timestamp.nullable(),
  notes: z.string().nullable(),
});
export const PublicAffectedGroupSchema = z.strictObject({
  key: z.string(),
  association: z.enum(["source_group", "ungrouped"]),
  targets: z.array(affectedTargetSchema),
});

const matchLevelSchema = z.enum(["confirmed", "probable", "possible", "contextual", "none"]);
const reasonSchema = z.strictObject({
  type: z.union([TargetTypeSchema, z.enum(["date", "supplyChain"])]),
  message: z.string(),
  evidence: z.string(),
});
export const PublicCheckResultSchema = z.strictObject({
  contractVersion: z.literal(CONTRACT_VERSION),
  status: z.enum(["no_matching_warning", "warning_match", "possible_match", "inconclusive"]),
  label: z.string(),
  qualification: z.string(),
  checkedAt: timestamp,
  matchLevel: matchLevelSchema,
  submittedEvidence: AgentObservationSchema,
  checkedEvidence: AgentObservationSchema,
  enrichedFields: z.array(z.enum(Object.keys(AgentObservationSchema.shape) as [keyof typeof AgentObservationSchema.shape, ...Array<keyof typeof AgentObservationSchema.shape>])),
  coverage: PublicCoverageSchema,
  inconclusiveReason: z.enum(["insufficient_evidence", "incomplete_data"]).nullable(),
  warnings: z.array(z.strictObject({
    warning: PublicWarningSummarySchema,
    level: matchLevelSchema,
    reasons: z.array(reasonSchema),
    affectedGroups: z.array(PublicAffectedGroupSchema),
    affectedGroupCount: z.number().int().nonnegative(),
    affectedGroupsComplete: z.boolean(),
    packetReviewRequired: z.boolean(),
  })).max(10),
  matchCount: z.number().int().nonnegative(),
  matchesComplete: z.boolean(),
});
export const PublicSearchResultSchema = z.strictObject({
  contractVersion: z.literal(CONTRACT_VERSION),
  qualification: z.string(),
  asOf: timestamp,
  coverage: PublicCoverageSchema,
  warnings: z.array(PublicWarningSummarySchema).max(20),
  total: z.number().int().nonnegative(),
  nextCursor: z.string().nullable(),
  complete: z.boolean(),
});
export const PublicWarningDetailsSchema = z.strictObject({
  contractVersion: z.literal(CONTRACT_VERSION),
  warning: PublicWarningSummarySchema,
  consumerAdvice: z.string(),
  affectedGroups: z.array(PublicAffectedGroupSchema).max(20),
  affectedGroupCount: z.number().int().nonnegative(),
  affectedGroupsComplete: z.boolean(),
  nextCursor: z.string().nullable(),
});

export type CheckProductInput = z.infer<typeof CheckProductInputSchema>;
export type SearchWarningsInput = z.infer<typeof SearchWarningsInputSchema>;
export type GetWarningInput = z.infer<typeof GetWarningInputSchema>;
export type PublicCoverage = z.infer<typeof PublicCoverageSchema>;
export type PublicCheckResult = z.infer<typeof PublicCheckResultSchema>;
export type PublicAffectedGroup = z.infer<typeof PublicAffectedGroupSchema>;
export type PublicWarningSummary = z.infer<typeof PublicWarningSummarySchema>;
export type PublicSearchResult = z.infer<typeof PublicSearchResultSchema>;
export type PublicWarningDetails = z.infer<typeof PublicWarningDetailsSchema>;
