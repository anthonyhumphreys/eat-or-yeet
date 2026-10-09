import { getFunctionName } from "convex/server";
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
  it("shares unchanged warning pages across requests and server workers", async () => {
    let db = await import("@/db/queries");
    await db.listActivePublicIncidents("UK");
    vi.resetModules();
    db = await import("@/db/queries");
    await db.listActivePublicIncidents("UK");
    expect(calls("getDatasetVersion")).toHaveLength(2);
    expect(calls("listActivePage")).toHaveLength(1);
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
