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
const status = { healthy: true, checkedAt: "2026-10-09T12:00:00.000Z", regions: ["UK"], sources: [] };
const makeRow = (index: number, overrides: Record<string, unknown> = {}) => ({
  id: `incident-${index}`,
  title: index === 0 ? "Chocolate bar recall" : `Chocolate warning ${index}`,
  slug: `chocolate-warning-${index}`,
  region: "UK",
  startsAt: now - 60_000,
  endsAt: undefined,
  summary: "Check the packet",
  hazard: index === 0 ? "Undeclared milk allergen" : "Salmonella contamination",
  pathogen: index === 0 ? null : "Salmonella",
  authority: "Food Standards Agency",
  authorityUrl: "https://alerts.food.gov.uk/",
  sourceId: `FSA-PRIN-${index}-2026`,
  publishedAt: now - 10_000,
  updatedAt: now - index,
  categories: ["Snacks & sweets"],
  stores: index === 0 ? ["Waitrose"] : ["Tesco"],
  ...overrides,
});

let revision = "UK:revision-1";
let rows: ReturnType<typeof makeRow>[];
function calls(name: string) { return query.mock.calls.filter(([ref]) => getFunctionName(ref) === `incidents:${name}`); }

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  entries.clear();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://test.convex.cloud");
  vi.stubEnv("ALLOW_DEMO_DATA", "false");
  vi.stubEnv("RATE_LIMIT_SALT", "test secret for warning cursors");
  revision = "UK:revision-1";
  rows = Array.from({ length: 21 }, (_, index) => makeRow(index));
  query.mockImplementation(async (ref) => {
    const name = getFunctionName(ref);
    if (name === "incidents:getDatasetStatus") return { ...status, version: revision };
    if (name === "incidents:listActivePage") return { page: rows, isDone: true, continueCursor: "done" };
    throw new Error(`Unexpected query ${name}`);
  });
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("complete warning search", () => {
  it("filters the complete regional snapshot before slicing and continues past page one", async () => {
    const { searchWarnings } = await import("@/lib/incidents/search");
    const first = await searchWarnings({ region: "UK", pageSize: 20 });
    expect(first.items).toHaveLength(20);
    expect(first.total).toBe(21);
    expect(first.complete).toBe(true);
    expect(first.nextCursor).toBeTruthy();
    const second = await searchWarnings({ region: "UK", pageSize: 20, cursor: first.nextCursor! });
    expect(second.items.map((item) => item.slug)).toEqual(["chocolate-warning-20"]);
    expect(second.nextCursor).toBeNull();
    expect(calls("listActivePage")).toHaveLength(1);
    expect(calls("getDatasetStatus")).toHaveLength(2);
  });

  it("shares website text, hazard, category and retailer matching semantics", async () => {
    const { searchWarnings } = await import("@/lib/incidents/search");
    const chocolate = await searchWarnings({ region: "UK", query: "chocolate BAR", hazard: "allergen", category: "Snacks & sweets", retailer: "waitrose" });
    expect(chocolate.items.map((item) => item.slug)).toEqual(["chocolate-warning-0"]);
    expect((await searchWarnings({ region: "UK", hazard: "pathogen" })).total).toBe(20);
    expect((await searchWarnings({ region: "UK", category: "Produce" })).total).toBe(0);
    expect((await searchWarnings({ region: "UK", retailer: "Tesco" })).total).toBe(20);
  });

  it("rejects tampering, changed filters, revisions and expired cursors with recoverable errors", async () => {
    const { searchWarnings, WarningSearchCursorError } = await import("@/lib/incidents/search");
    const first = await searchWarnings({ region: "UK", pageSize: 2 });
    await expect(searchWarnings({ region: "UK", pageSize: 2, cursor: `${first.nextCursor}x` }))
      .rejects.toBeInstanceOf(WarningSearchCursorError);
    await expect(searchWarnings({ region: "UK", pageSize: 2, query: "different", cursor: first.nextCursor! }))
      .rejects.toMatchObject({ code: "filters_changed", recoverable: true });
    revision = "UK:revision-2";
    await expect(searchWarnings({ region: "UK", pageSize: 2, cursor: first.nextCursor! }))
      .rejects.toMatchObject({ code: "revision_changed", recoverable: true });

    revision = "UK:revision-1";
    const newFirst = await searchWarnings({ region: "UK", pageSize: 2 });
    vi.setSystemTime(now + 10 * 60 * 1_000);
    await expect(searchWarnings({ region: "UK", pageSize: 2, cursor: newFirst.nextCursor! }))
      .rejects.toMatchObject({ code: "expired", recoverable: true });
  });

  it("expires pagination at a start or end boundary even when revision is unchanged", async () => {
    rows = [makeRow(0), makeRow(1, { endsAt: now + 5_000 }), makeRow(2, { startsAt: now + 3_000 })];
    const { searchWarnings } = await import("@/lib/incidents/search");
    const first = await searchWarnings({ region: "UK", pageSize: 1 });
    vi.setSystemTime(now + 3_000);
    await expect(searchWarnings({ region: "UK", pageSize: 1, cursor: first.nextCursor! }))
      .rejects.toMatchObject({ code: "eligibility_changed", recoverable: true });

    vi.setSystemTime(now);
    entries.clear();
    rows = [makeRow(0), makeRow(1, { endsAt: now + 3_000 }), makeRow(2)];
    const withEndBoundary = await searchWarnings({ region: "UK", pageSize: 1 });
    vi.setSystemTime(now + 3_000);
    await expect(searchWarnings({ region: "UK", pageSize: 1, cursor: withEndBoundary.nextCursor! }))
      .rejects.toMatchObject({ code: "eligibility_changed", recoverable: true });
  });

  it("refreshes source health after a warm snapshot and propagates cold page failures", async () => {
    const { searchWarnings } = await import("@/lib/incidents/search");
    expect((await searchWarnings({ region: "UK" })).status.healthy).toBe(true);
    query.mockImplementation(async (ref) => {
      if (getFunctionName(ref) === "incidents:getDatasetStatus") return { ...status, version: revision, healthy: false, regions: [] };
      if (getFunctionName(ref) === "incidents:listActivePage") throw new Error("Convex unavailable");
      throw new Error("Unexpected query");
    });
    // The persistent cache is warm for page data, but health is read for every search.
    expect((await searchWarnings({ region: "UK" })).status.healthy).toBe(false);

    entries.clear();
    await expect(searchWarnings({ region: "UK" })).rejects.toThrow("Convex unavailable");
  });
});
