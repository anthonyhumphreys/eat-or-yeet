import type { ProductObservation, Region, TargetType } from "@/lib/domain/schemas";

export type MatchLevel =
  | "confirmed"
  | "probable"
  | "possible"
  | "contextual"
  | "none";

export type Verdict = "EAT" | "YEET" | "MAYBE_YEET" | "NO_CLUE";

export type MatchReason = {
  type: TargetType | "date" | "supplyChain";
  message: string;
  evidence: string;
};

export type MatchableTarget = {
  id: string;
  incidentId: string;
  type: TargetType;
  value: string;
  valueNormalized: string;
  matchType: "exact" | "pattern";
  groupId?: string | null;
  dateFrom: Date | null;
  dateTo: Date | null;
  notes: string | null;
  weight: number;
  confidence: number;
};

export type MatchableIncident = {
  id: string;
  title: string;
  slug: string;
  region: "UK" | "US";
  hazard: string | null;
  pathogen: string | null;
  summary: string;
  consumerAdvice: string;
  authority: string;
  authorityUrl: string;
  sourceId: string;
  publishedAt: Date;
  updatedAt: Date;
  severity: "low" | "medium" | "high" | "critical";
  confidence: number;
  targets: MatchableTarget[];
};

export type IncidentMatch = {
  incident: MatchableIncident;
  level: MatchLevel;
  score: number;
  reasons: MatchReason[];
};

export type VerdictResult = {
  verdict: Verdict;
  matchLevel: MatchLevel;
  observation: ProductObservation;
  matches: IncidentMatch[];
  checkedAt: string;
  datasetRegions: Region[];
  datasetStatus?: DatasetStatus;
  inconclusiveReason?: "insufficient_evidence" | "incomplete_data";
  matchCount?: number;
  shareToken?: string;
};

export type DatasetStatus = {
  healthy: boolean;
  checkedAt: string | null;
  regions: Region[];
  sources: Array<{
    id: string;
    name: string;
    region: Region;
    lastSuccessfulAt: string | null;
    status: "healthy" | "stale" | "failed" | "missing";
    scope: string;
  }>;
};
