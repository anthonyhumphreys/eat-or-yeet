import type { ProductObservation, TargetType } from "@/lib/domain/schemas";

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
  datasetRegions: Array<"UK" | "US">;
  shareToken?: string;
};
