import type { TargetType } from "@/lib/domain/schemas";

export type NormalisedTarget = {
  type: TargetType;
  value: string;
  matchType?: "exact" | "pattern";
  dateFrom?: Date | null;
  dateTo?: Date | null;
  notes?: string | null;
  weight?: number;
  confidence?: number;
};

export type NormalisedIncident = {
  title: string;
  slug: string;
  region: "UK" | "US";
  status: "active" | "resolved";
  hazard: string | null;
  pathogen: string | null;
  summary: string;
  consumerAdvice: string;
  authority: string;
  authorityUrl: string;
  sourceId: string;
  publishedAt: Date;
  updatedAt: Date;
  startsAt: Date;
  endsAt: Date | null;
  severity: "low" | "medium" | "high" | "critical";
  confidence: number;
  originalSourceData: Record<string, unknown>;
  targets: NormalisedTarget[];
};

export interface IncidentSource {
  id: string;
  name: string;
  url: string;
  fetchIncidents(): Promise<NormalisedIncident[]>;
}
