import { describe, expect, it } from "vitest";

import { buildDatasetStatus, MAX_DATASET_AGE_MS, type DatasetSource, type DatasetSourceRuns } from "@/lib/incidents/dataset-status";
import { cleanupNeedsContinuation, EPHEMERAL_CLEANUP_BATCH_SIZE } from "@/lib/incidents/cleanup-batches";

const now = Date.parse("2026-10-07T12:00:00.000Z");
const source: DatasetSource = {
  id: "fsa",
  name: "Food Standards Agency",
  region: "UK",
  scope: "UK official food alerts",
};

function successfulRun(completedAt: number) {
  return { source: "fsa", status: "success" as const, startedAt: completedAt - 1_000, completedAt };
}

describe("dataset readiness", () => {
  it("reports a fresh complete source as healthy", () => {
    const runs: Record<string, DatasetSourceRuns> = {
      fsa: { latest: successfulRun(now - 10_000), latestSuccessful: successfulRun(now - 10_000) },
    };

    expect(buildDatasetStatus("UK", [source], runs, now)).toEqual({
      healthy: true,
      checkedAt: new Date(now).toISOString(),
      regions: ["UK"],
      sources: [{
        id: "fsa",
        name: "Food Standards Agency",
        region: "UK",
        lastSuccessfulAt: new Date(now - 10_000).toISOString(),
        status: "healthy",
        scope: "UK official food alerts",
      }],
    });
  });

  it("marks a successful but over-48-hour snapshot stale", () => {
    const lastSuccess = successfulRun(now - MAX_DATASET_AGE_MS - 1);
    const result = buildDatasetStatus("UK", [source], {
      fsa: { latest: lastSuccess, latestSuccessful: lastSuccess },
    }, now);

    expect(result.healthy).toBe(false);
    expect(result.regions).toEqual([]);
    expect(result.sources[0]).toMatchObject({ status: "stale", lastSuccessfulAt: new Date(lastSuccess.completedAt!).toISOString() });
  });

  it("does not treat an older success as healthy after a later partial run", () => {
    const priorSuccess = successfulRun(now - 60_000);
    const latestFailure = { source: "fsa", status: "partial" as const, startedAt: now - 1_000, completedAt: now };
    const result = buildDatasetStatus("UK", [source], {
      fsa: { latest: latestFailure, latestSuccessful: priorSuccess },
    }, now);

    expect(result.healthy).toBe(false);
    expect(result.sources[0]).toMatchObject({ status: "failed", lastSuccessfulAt: new Date(priorSuccess.completedAt!).toISOString() });
  });

  it("treats a source with no ingestion run as missing", () => {
    const result = buildDatasetStatus("UK", [source], {}, now);
    expect(result.healthy).toBe(false);
    expect(result.sources[0]).toMatchObject({ status: "missing", lastSuccessfulAt: null });
  });
});

describe("bounded expired-record cleanup", () => {
  it("continues when either indexed table fills its batch limit", () => {
    expect(cleanupNeedsContinuation(EPHEMERAL_CLEANUP_BATCH_SIZE, 0)).toBe(true);
    expect(cleanupNeedsContinuation(0, EPHEMERAL_CLEANUP_BATCH_SIZE)).toBe(true);
    expect(cleanupNeedsContinuation(EPHEMERAL_CLEANUP_BATCH_SIZE - 1, 0)).toBe(false);
    expect(cleanupNeedsContinuation(0, 0)).toBe(false);
  });
});
