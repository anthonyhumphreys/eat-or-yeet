import type { DatasetStatus } from "@/lib/domain/types";
import type { Region } from "@/lib/domain/schemas";

export const MAX_DATASET_AGE_MS = 48 * 60 * 60 * 1_000;

export type DatasetSource = {
  id: string;
  name: string;
  region: Region;
  scope: string;
};

export type IngestionRunSummary = {
  source: string;
  status?: "running" | "success" | "partial" | "failed";
  startedAt: number;
  completedAt?: number;
};

export type DatasetSourceRuns = {
  latest: IngestionRunSummary | null;
  latestSuccessful: IngestionRunSummary | null;
};

function isoTime(value: number | undefined): string | null {
  if (value === undefined || !Number.isFinite(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Build the conservative health summary used to decide whether a no-match is meaningful. */
export function buildDatasetStatus(
  region: Region,
  requiredSources: DatasetSource[],
  runsBySource: Record<string, DatasetSourceRuns>,
  now = Date.now(),
): DatasetStatus {
  const sources = requiredSources
    .filter((source) => source.region === region)
    .map((source) => {
      const runs = runsBySource[source.id] ?? { latest: null, latestSuccessful: null };
      const lastSuccessfulAt = runs.latestSuccessful?.status === "success"
        ? isoTime(runs.latestSuccessful.completedAt)
        : null;
      const completedAt = runs.latest?.completedAt;
      const latestIsSuccessful = runs.latest?.status === "success" && completedAt !== undefined;
      const isFresh = latestIsSuccessful && completedAt <= now && now - completedAt <= MAX_DATASET_AGE_MS;
      const status: DatasetStatus["sources"][number]["status"] = !runs.latest
        ? "missing"
        : !latestIsSuccessful
          ? "failed"
          : isFresh
            ? "healthy"
            : "stale";

      return {
        id: source.id,
        name: source.name,
        region: source.region,
        lastSuccessfulAt,
        status,
        scope: source.scope,
      };
    });
  const healthy = sources.length > 0 && sources.every((source) => source.status === "healthy");

  return {
    healthy,
    checkedAt: new Date(now).toISOString(),
    regions: healthy ? [region] : [],
    sources,
  };
}
