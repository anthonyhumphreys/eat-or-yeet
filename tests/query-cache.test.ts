import { getFunctionName } from "convex/server";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { query, entries } = vi.hoisted(() => ({ query: vi.fn(), entries: new Map<string, Promise<unknown>>() }));
vi.mock("convex/nextjs", () => ({ fetchQuery: query }));
vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...args: unknown[]) => Promise<unknown>, keys: string[]) => (...args: unknown[]) => {
    const key = JSON.stringify([keys, args]);
    if (!entries.has(key)) {
      const promise = fn(...args);
      entries.set(key, promise);
      void promise.catch(() => entries.delete(key));
    }
    return entries.get(key);
  },
}));

const now = Date.parse("2026-10-09T12:00:00Z");
const row = {
  incidentId: "notice", title: "Biscuit recall", slug: "biscuit-recall", region: "UK", startsAt: now - 1000,
  summary: "Check pack", consumerAdvice: "Do not eat", authority: "FSA", authorityUrl: "https://alerts.food.gov.uk/",
  sourceId: "1", publishedAt: now - 1000, updatedAt: now, severity: "high", confidence: 1, targets: [], categories: [], stores: [],
};
let revision: string;
let healthy: boolean;
let rows: Array<typeof row & { endsAt?: number }>;

function calls(name: string) {
  return query.mock.calls.filter(([ref]) => getFunctionName(ref) === `incidents:${name}`);
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  entries.clear();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://test.convex.cloud");
  vi.stubEnv("ALLOW_DEMO_DATA", "false");
  revision = "UK:initial";
  healthy = true;
  rows = [row];
  query.mockImplementation(async (ref, args) => {
    const name = getFunctionName(ref);
    if (name === "incidents:getDatasetStatus") return { version: revision, healthy, checkedAt: new Date().toISOString(), regions: healthy ? [args.region] : [], sources: [] };
    if (name === "incidents:getDatasetVersion") return revision;
    if (name === "incidents:getActivePage") return { page: rows, isDone: true, continueCursor: "done" };
    if (name === "incidents:listActivePage") return { page: rows.map((item) => ({ ...item, id: item.incidentId })), isDone: true, continueCursor: "done" };
    if (name === "incidents:getBySlug") return { ...row, _id: row.incidentId };
    throw new Error(`Unexpected query ${name}`);
  });
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("warning data caches", () => {
  it("treats legacy food details and browse rows as Food when the category field is absent", async () => {
    const db = await import("@/db/queries");
    expect((await db.getIncidentBySlug("biscuit-recall"))?.superCategories).toEqual(["Food"]);
    expect((await db.listActivePublicIncidents("UK"))[0].superCategories).toEqual(["Food"]);
  });

  it("does not reuse food-era cached pages or details after the category shape changes", async () => {
    const url = "https://test.convex.cloud";
    entries.set(JSON.stringify([["public-warning-page-v5"], ["UK", null, url, revision]]),
      Promise.resolve({ page: [{ ...row, id: row.incidentId }], isDone: true, continueCursor: "done" }));
    entries.set(JSON.stringify([["warning-details-v1"], ["biscuit-recall", false, url, revision]]),
      Promise.resolve({ ...row, _id: row.incidentId }));
    const implementation = query.getMockImplementation()!;
    query.mockImplementation(async (...args) => {
      const result = await implementation(...args);
      const name = getFunctionName(args[0]);
      if (name === "incidents:getBySlug") return { ...result, superCategories: ["Food"] };
      if (name === "incidents:listActivePage") return { ...result, page: result.page.map((item: typeof row) => ({ ...item, superCategories: ["Food"] })) };
      return result;
    });
    const db = await import("@/db/queries");
    expect((await db.listActivePublicIncidents("UK"))[0].superCategories).toEqual(["Food"]);
    expect((await db.getIncidentBySlug("biscuit-recall"))?.superCategories).toEqual(["Food"]);
    expect(calls("getBySlug")).toHaveLength(1);
    expect(calls("listActivePage")).toHaveLength(1);
  });

  it("shares unchanged warning pages across requests and server workers", async () => {
    let db = await import("@/db/queries");
    await db.listActivePublicIncidents("UK");
    vi.resetModules();
    db = await import("@/db/queries");
    await db.listActivePublicIncidents("UK");
    expect(calls("getDatasetVersion")).toHaveLength(2);
    expect(calls("listActivePage")).toHaveLength(1);
  });

  it("uses the status revision for a complete snapshot and retains notice boundaries", async () => {
    rows = [{ ...row, endsAt: now + 5_000 }, { ...row, incidentId: "future", startsAt: now + 10_000 }];
    const db = await import("@/db/queries");
    const snapshot = await db.getPublicWarningSnapshot("UK");
    expect(snapshot.revision).toBe(revision);
    expect(snapshot.asOf).toBe(now);
    expect(snapshot.status.healthy).toBe(true);
    expect(snapshot.rows.map((item) => [item.startsAt, item.endsAt])).toEqual([[row.startsAt, now + 5_000], [now + 10_000, undefined]]);
    expect(calls("getDatasetStatus")).toHaveLength(1);
    expect(calls("getDatasetVersion")).toHaveLength(0);
    expect(calls("listActivePage")).toHaveLength(1);
  });

  it("reads regional coverage without loading public dataset pages", async () => {
    const db = await import("@/db/queries");
    expect((await db.getRegionCoverage("UK")).healthy).toBe(true);
    expect(calls("getDatasetStatus")).toHaveLength(1);
    expect(calls("listActivePage")).toHaveLength(0);
  });

  it("restarts the full traversal and source status when an import changes a later page", async () => {
    const implementation = query.getMockImplementation()!;
    query.mockImplementation(async (ref, args) => {
      if (getFunctionName(ref) !== "incidents:listActivePage") return implementation(ref, args);
      if (args.expectedVersion === "UK:initial" && args.cursor === null) {
        return { page: [{ ...row, id: "old" }], isDone: false, continueCursor: "later" };
      }
      if (args.expectedVersion === "UK:initial") {
        revision = "UK:changed:1";
        healthy = false;
        throw new ConvexError({ code: "DATASET_REVISION_CHANGED" });
      }
      return { page: [{ ...row, id: "new", title: "Updated recall" }], isDone: true, continueCursor: "done" };
    });
    const db = await import("@/db/queries");
    const snapshot = await db.getPublicWarningSnapshot("UK");
    expect(snapshot.rows.map((item) => item.id)).toEqual(["new"]);
    expect(snapshot.revision).toBe("UK:changed:1");
    expect(snapshot.status.healthy).toBe(false);
    expect(calls("getDatasetStatus")).toHaveLength(2);
    expect(calls("listActivePage").map(([, args]) => args.expectedVersion)).toEqual(["UK:initial", "UK:initial", "UK:changed:1"]);
  });

  it("fails closed after two revision changes instead of returning a mixed complete snapshot", async () => {
    const implementation = query.getMockImplementation()!;
    query.mockImplementation(async (ref, args) => {
      if (getFunctionName(ref) === "incidents:listActivePage") {
        revision += ":changed";
        throw new ConvexError({ code: "DATASET_REVISION_CHANGED" });
      }
      return implementation(ref, args);
    });
    const db = await import("@/db/queries");
    await expect(db.getPublicWarningSnapshot("UK")).rejects.toMatchObject({ data: { code: "DATASET_REVISION_CHANGED" } });
    expect(calls("getDatasetStatus")).toHaveLength(2);
  });

  it("invalidates pages when a warning changes, including a partial import", async () => {
    const db = await import("@/db/queries");
    expect((await db.getCheckDataset("UK")).incidents[0].title).toBe("Biscuit recall");
    revision = "UK:changed:1";
    healthy = false;
    rows = [{ ...row, title: "Updated recall" }];
    const result = await db.getCheckDataset("UK");
    expect(result.incidents[0].title).toBe("Updated recall");
    expect(result.status.healthy).toBe(false);
    expect(calls("getActivePage")).toHaveLength(2);
  });

  it("reads health on every scan even with the same cached warning data", async () => {
    const db = await import("@/db/queries");
    await db.getCheckDataset("UK");
    healthy = false;
    expect((await db.getCheckDataset("UK")).status.healthy).toBe(false);
    expect(calls("getDatasetStatus")).toHaveLength(2);
    expect(calls("getActivePage")).toHaveLength(1);
  });

  it("applies start and expiry boundaries after reading cached snapshots", async () => {
    rows = [{ ...row, endsAt: now + 1000 }, { ...row, incidentId: "future", startsAt: now + 2000 }];
    const db = await import("@/db/queries");
    expect((await db.getCheckDataset("UK")).incidents.map((item) => item.id)).toEqual(["notice"]);
    expect((await db.listActivePublicIncidents("UK")).map((item) => item.id)).toEqual(["notice"]);
    vi.setSystemTime(now + 2000);
    expect((await db.getCheckDataset("UK")).incidents.map((item) => item.id)).toEqual(["future"]);
    expect((await db.listActivePublicIncidents("UK")).map((item) => item.id)).toEqual(["future"]);
    expect(calls("getActivePage")).toHaveLength(1);
    expect(calls("listActivePage")).toHaveLength(1);
  });

  it("keeps deployments and demo-enabled matcher caches separate", async () => {
    const db = await import("@/db/queries");
    await db.getCheckDataset("UK");
    vi.stubEnv("ALLOW_DEMO_DATA", "true");
    await db.getCheckDataset("UK");
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://another.convex.cloud");
    await db.getCheckDataset("UK");
    expect(calls("getActivePage")).toHaveLength(3);
    expect(calls("getActivePage").map(([, args]) => args.includeDemo)).toEqual([false, true, true]);
  });

  it("retries failed page loads instead of caching an empty success", async () => {
    const implementation = query.getMockImplementation()!;
    let fail = true;
    query.mockImplementation(async (...args) => {
      if (getFunctionName(args[0]) === "incidents:getActivePage" && fail) throw new Error("Unavailable");
      return implementation(...args);
    });
    const db = await import("@/db/queries");
    await expect(db.getCheckDataset("UK")).rejects.toThrow("Unavailable");
    fail = false;
    expect((await db.getCheckDataset("UK")).incidents).toHaveLength(1);
    expect(calls("getActivePage")).toHaveLength(2);
  });

  it("keeps detail entries current after a revision change", async () => {
    const db = await import("@/db/queries");
    await db.getIncidentBySlug("biscuit-recall");
    await db.getIncidentBySlug("biscuit-recall");
    revision = "UK:changed:1";
    await db.getIncidentBySlug("biscuit-recall");
    expect(calls("getBySlug")).toHaveLength(2);
  });
});
