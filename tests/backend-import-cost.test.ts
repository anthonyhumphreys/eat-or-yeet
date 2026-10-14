import { afterEach, describe, expect, it, vi } from "vitest";

import { api, internal } from "@backend/api";
import type { Doc } from "@backend/model";
import { upsertBatch } from "@backend/incidents";
import { IMPORT_ARCHIVE_AUDIT_MS } from "@backend/lib/import_state";
import { incidentFingerprint } from "@/lib/incidents/fingerprint";
import { createBackend } from "./backend-harness";

const now = Date.parse("2026-10-09T12:00:00Z");

function notice(overrides: Partial<Omit<Doc<"incidents">, "_id" | "_creationTime">> = {}) {
  return {
    title: "Biscuit recall", slug: "biscuit-recall", authority: "Test authority", authorityUrl: "https://example.test/recall",
    sourceId: "recall-1", sourceKey: "fsa", region: "UK" as const, status: "active" as const,
    summary: "Check the pack", consumerAdvice: "Do not eat", startsAt: 1, publishedAt: 1, updatedAt: 1,
    retrievedAt: now, severity: "high" as const, confidence: 1, isDemo: false,
    originalSourceData: { product: "Biscuits", payload: "x".repeat(100 * 1024) },
    targets: [{ type: "gtin" as const, value: "044000061494", valueNormalized: "00044000061494", matchType: "exact" as const, confidence: 1, weight: 70 }],
    ...overrides,
  };
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

async function imported(t: ReturnType<typeof createBackend>) {
  return t.run(async (ctx) => ({
    incident: (await ctx.db.query("incidents").unique())!,
    projection: (await ctx.db.query("incidentMatchData").unique())!,
    state: (await ctx.db.query("incidentImportState").unique())!,
    version: (await ctx.db.query("datasetVersions").unique())!,
  }));
}

describe("import read costs and repair", () => {
  it("seeds state lazily and skips large archive reads and all writes for unchanged notices", async () => {
    const t = createBackend();
    await t.mutation(internal.incidents.upsertBatch, { items: [notice()] });
    const before = await imported(t);
    await t.run(async (ctx) => {
      const queries = vi.spyOn(ctx.db, "query");
      const patch = vi.spyOn(ctx.db, "patch");
      // Run the registered handler inside the mock transaction to inspect reads.
      const result = await upsertBatch.handler(ctx, { items: [notice({ retrievedAt: now + 1 })] });
      expect(result).toEqual({ created: 0, updated: 0, unchanged: 1 });
      expect(queries.mock.calls.map(([table]) => table)).not.toContain("incidents");
      expect(patch).not.toHaveBeenCalled();
    });
    expect(await imported(t)).toEqual(before);
  });

  it("updates changed and resolved notices and their cache revision atomically", async () => {
    const t = createBackend();
    await t.mutation(internal.incidents.upsertBatch, { items: [notice()] });
    const before = await imported(t);
    await t.mutation(internal.incidents.upsertBatch, { items: [notice({ status: "resolved", consumerAdvice: "Return the product" })] });
    const after = await imported(t);
    expect(after.incident._id).toBe(before.incident._id);
    expect(after.projection).toMatchObject({ status: "resolved", consumerAdvice: "Return the product" });
    expect(after.state.fingerprint).not.toBe(before.state.fingerprint);
    expect(after.version.revision).toBe(before.version.revision + 1);
    expect((await t.query(api.incidents.getActivePage, { region: "UK", cursor: null })).page).toEqual([]);
  });

  it.each(["deleted", "corrupt"])("repairs a %s matching record even when the fingerprint is unchanged", async (problem) => {
    const t = createBackend();
    await t.mutation(internal.incidents.upsertBatch, { items: [notice()] });
    const before = await imported(t);
    await t.run(async (ctx) => {
      if (problem === "deleted") await ctx.db.delete(before.projection._id);
      else await ctx.db.patch(before.projection._id, { targets: [] });
    });
    await t.mutation(internal.incidents.upsertBatch, { items: [notice()] });
    const after = await imported(t);
    expect(after.projection.targets).toEqual(before.projection.targets);
    expect(after.state.matchDataId).toBe(after.projection._id);
    expect(after.version.revision).toBe(before.version.revision + 1);
  });

  it("audits the archive weekly and repairs out-of-band archive edits without invalidating unchanged matching data", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const t = createBackend();
    await t.mutation(internal.incidents.upsertBatch, { items: [notice()] });
    const before = await imported(t);
    await t.run((ctx) => ctx.db.patch(before.incident._id, { originalSourceData: { modified: true } }));
    vi.setSystemTime(now + IMPORT_ARCHIVE_AUDIT_MS);
    await t.mutation(internal.incidents.upsertBatch, { items: [notice()] });
    const after = await imported(t);
    expect(after.incident.originalSourceData).toEqual(before.incident.originalSourceData);
    expect(after.state.archiveVerifiedAt).toBe(now + IMPORT_ARCHIVE_AUDIT_MS);
    expect(after.version).toEqual(before.version);
  });

  it("refreshes source health after an unchanged import without changing the warning or its revision", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const t = createBackend();
    async function refresh() {
      const runId = await t.mutation(internal.incidents.beginRun, { source: "fsa", sourceName: "Food Standards Agency", region: "UK", scope: "Official warnings" });
      const result = await t.mutation(internal.incidents.upsertBatch, { items: [notice({ sourceRunId: runId })] });
      await t.mutation(internal.incidents.finishRun, { runId, status: "success", incidentsFound: 1, created: result.created, updated: result.updated, errors: [] });
    }
    await refresh();
    const before = await imported(t);
    vi.setSystemTime(now + 3 * 24 * 60 * 60 * 1000);
    expect((await t.query(api.incidents.getDatasetStatus, { region: "UK" })).healthy).toBe(false);
    await refresh();
    expect((await t.query(api.incidents.getDatasetStatus, { region: "UK" })).healthy).toBe(true);
    expect(await imported(t)).toEqual(before);
  });

  it("relinks the existing warning when a weekly recheck finds its archive record deleted", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const t = createBackend();
    await t.mutation(internal.incidents.upsertBatch, { items: [notice()] });
    const before = await imported(t);
    await t.run((ctx) => ctx.db.delete(before.incident._id));
    vi.setSystemTime(now + IMPORT_ARCHIVE_AUDIT_MS);
    await t.mutation(internal.incidents.upsertBatch, { items: [notice()] });
    const after = await imported(t);
    expect(after.incident._id).not.toBe(before.incident._id);
    expect(after.projection._id).toBe(before.projection._id);
    expect(after.projection.incidentId).toBe(after.incident._id);
    expect(after.state.incidentId).toBe(after.incident._id);
    expect((await t.query(api.incidents.getActivePage, { region: "UK", cursor: null })).page).toHaveLength(1);
  });

  it("does not leave fingerprints or warnings behind when another item makes the batch fail", async () => {
    const t = createBackend();
    await expect(t.mutation(internal.incidents.upsertBatch, { items: [notice(), notice({ sourceId: "bad", severity: "invalid" as never })] })).rejects.toThrow();
    await t.run(async (ctx) => {
      expect(await ctx.db.query("incidents").collect()).toEqual([]);
      expect(await ctx.db.query("incidentMatchData").collect()).toEqual([]);
      expect(await ctx.db.query("incidentImportState").collect()).toEqual([]);
      expect(await ctx.db.query("datasetVersions").collect()).toEqual([]);
    });
  });

  it("removes expired metadata in bounded batches while retaining live cache entries and curated products", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const t = createBackend();
    await t.run(async (ctx) => {
      for (let i = 0; i < 101; i += 1) {
        await ctx.db.insert("productMetadataCache", { gtin: String(i), source: "open-food-facts", metadata: null, updatedAt: 1, expiresAt: 1 });
      }
      await ctx.db.insert("productMetadataCache", { gtin: "live", source: "open-food-facts", metadata: null, updatedAt: 1, expiresAt: Date.now() + 60_000 });
      await ctx.db.insert("products", { gtin: "curated", name: "Product", metadata: {}, updatedAt: 1 });
    });
    const first = await t.mutation(internal.incidents.cleanupExpired, {});
    expect(first.metadataDeleted).toBe(100);
    await t.run(async (ctx) => {
      expect(await ctx.db.query("productMetadataCache").collect()).toHaveLength(2);
      expect(await ctx.db.query("products").collect()).toHaveLength(1);
    });
    await t.finishAllScheduledFunctions(() => { vi.runAllTimers(); });
    await t.run(async (ctx) => {
      expect((await ctx.db.query("productMetadataCache").collect()).map((row) => row.gtin)).toEqual(["live"]);
      expect(await ctx.db.query("products").collect()).toHaveLength(1);
    });
  });
});

describe("content fingerprints", () => {
  it("ignores fetch bookkeeping, undefined properties and source object key ordering", async () => {
    const a = { ...notice(), originalSourceData: { nested: { b: 2, a: 1 } } };
    const b = { ...a, retrievedAt: now + 1, sourceRunId: "different", hazard: undefined, originalSourceData: { nested: { a: 1, b: 2, empty: undefined } } };
    expect(await incidentFingerprint(a)).toBe(await incidentFingerprint(b));
  });

  it("detects raw payload changes and every warning field, including cleared fields and target order", async () => {
    const original = notice({ hazard: "Milk", endsAt: now });
    const initial = await incidentFingerprint(original);
    for (const change of [
      { originalSourceData: { modified: true } }, { status: "resolved" }, { startsAt: 2 }, { endsAt: undefined },
      { consumerAdvice: "Return" }, { hazard: undefined }, { targets: [] }, { region: "US" },
    ]) expect(await incidentFingerprint({ ...original, ...change })).not.toBe(initial);
    expect(await incidentFingerprint({ values: [1, 2] })).not.toBe(await incidentFingerprint({ values: [2, 1] }));
  });
});
