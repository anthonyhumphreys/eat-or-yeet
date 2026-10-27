const getFunctionName = (ref: { name: string }) => ref.name.replace(".", ":");
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { query, entries } = vi.hoisted(() => ({ query: vi.fn(), entries: new Map<string, Promise<unknown>>() }));
vi.mock("@backend/client", () => ({ fetchQuery: query }));
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
  vi.stubEnv("BACKEND_URL", "https://test.workers.dev");
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
  it("finds complete allergens and affected product names while retaining filters and all-term matching", async () => {
    rows = [makeRow(0, {
      title: "Various products recalled", hazard: "Undeclared milk, egg and sesame allergens",
      searchText: "northstar sesame crunch", stores: ["Waitrose"],
    }), makeRow(1, { title: "Other products", hazard: "Undeclared milk" })];
    const { searchWarnings } = await import("@/lib/incidents/search");
    expect((await searchWarnings({ region: "UK", query: "sesame northstar", hazard: "allergen", retailer: "Waitrose" })).items.map((item) => item.slug)).toEqual(["chocolate-warning-0"]);
    expect((await searchWarnings({ region: "UK", query: "sesame missing" })).total).toBe(0);
    expect((await searchWarnings({ region: "UK", query: "sesame", retailer: "Tesco" })).total).toBe(0);
    expect((await searchWarnings({ region: "UK", query: "sesame", category: "Produce" })).total).toBe(0);
  });

  it("excludes medicines from food-only integration searches and requests food-only pages", async () => {
    rows = [
      makeRow(0, { superCategories: ["Food"] }),
      makeRow(1, { title: "Chocolate flavoured medicine", categories: ["Over-the-counter medicines"], superCategories: ["Baby", "Medical"] }),
      makeRow(2), // Legacy food row with no super-category.
    ];
    const { searchWarnings } = await import("@/lib/incidents/search");
    const result = await searchWarnings({ region: "UK", query: "chocolate" });
    expect(result.items.map((item) => item.slug)).toEqual(["chocolate-warning-0", "chocolate-warning-2"]);
    expect(result.total).toBe(2);
    expect(calls("listActivePage")[0][1].foodOnly).toBe(true);
  });

  it("finds a match that exists only on a later backend page", async () => {
    query.mockImplementation(async (ref, args) => {
      if (getFunctionName(ref) === "incidents:getDatasetStatus") return { ...status, version: revision };
      if (getFunctionName(ref) === "incidents:listActivePage") {
        return args.cursor === null
          ? { page: rows.slice(0, 20), isDone: false, continueCursor: "backend-page-two" }
          : { page: [makeRow(20, { title: "Later page unique product" })], isDone: true, continueCursor: "done" };
      }
      throw new Error("Unexpected query");
    });
    const { searchWarnings } = await import("@/lib/incidents/search");
    const result = await searchWarnings({ region: "UK", query: "unique product" });
    expect(result.items.map((item) => item.slug)).toEqual(["chocolate-warning-20"]);
    expect(result).toMatchObject({ total: 1, complete: true, nextCursor: null });
    expect(calls("listActivePage").map(([, args]) => args.cursor)).toEqual([null, "backend-page-two"]);
    expect(calls("getDatasetStatus")).toHaveLength(1);
  });

  it("stops paging after cancellation arrives while a page is in flight", async () => {
    const controller = new AbortController();
    let pageReads = 0;
    query.mockImplementation(async (ref) => {
      const name = getFunctionName(ref);
      if (name === "incidents:getDatasetStatus") return { ...status, version: revision };
      if (name === "incidents:listActivePage") {
        pageReads += 1;
        controller.abort();
        return { page: rows.slice(0, 20), isDone: false, continueCursor: "page-two" };
      }
      throw new Error(`Unexpected query ${name}`);
    });
    const { searchWarnings } = await import("@/lib/incidents/search");

    await expect(searchWarnings({ region: "UK" }, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(pageReads).toBe(1);
  });

  it("fails with a qualified no-partial-results error at the complete snapshot cap", async () => {
    const capPage = Array.from({ length: 100 }, (_, index) => makeRow(index));
    let pageReads = 0;
    query.mockImplementation(async (ref) => {
      const name = getFunctionName(ref);
      if (name === "incidents:getDatasetStatus") return { ...status, version: revision };
      if (name === "incidents:listActivePage") {
        pageReads += 1;
        return { page: capPage, isDone: false, continueCursor: `page-${pageReads}` };
      }
      throw new Error(`Unexpected query ${name}`);
    });
    const { searchWarnings } = await import("@/lib/incidents/search");
    const { WarningSnapshotLimitError } = await import("@/db/queries");

    const search = searchWarnings({ region: "UK" });
    await expect(search).rejects.toBeInstanceOf(WarningSnapshotLimitError);
    await expect(search).rejects.toMatchObject({ message: expect.stringMatching(/complete warning dataset.*No partial results/i) });
    expect(pageReads).toBe(50);
    expect(calls("getDatasetStatus")).toHaveLength(1);
  });

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

  it("keeps the ten-minute expiry anchored to the initial search time", async () => {
    const { searchWarnings } = await import("@/lib/incidents/search");
    const first = await searchWarnings({ region: "UK", pageSize: 1 });
    vi.setSystemTime(now + 9 * 60 * 1_000);
    const second = await searchWarnings({ region: "UK", pageSize: 1, cursor: first.nextCursor! });
    vi.setSystemTime(now + 10 * 60 * 1_000);
    await expect(searchWarnings({ region: "UK", pageSize: 1, cursor: second.nextCursor! }))
      .rejects.toMatchObject({ code: "expired", recoverable: true });
  });

  it("refreshes source health after a warm snapshot and propagates cold page failures", async () => {
    const { searchWarnings } = await import("@/lib/incidents/search");
    expect((await searchWarnings({ region: "UK" })).status.healthy).toBe(true);
    query.mockImplementation(async (ref) => {
      if (getFunctionName(ref) === "incidents:getDatasetStatus") return { ...status, version: revision, healthy: false, regions: [] };
      if (getFunctionName(ref) === "incidents:listActivePage") throw new Error("Backend unavailable");
      throw new Error("Unexpected query");
    });
    // The persistent cache is warm for page data, but health is read for every search.
    expect((await searchWarnings({ region: "UK" })).status.healthy).toBe(false);

    entries.clear();
    await expect(searchWarnings({ region: "UK" })).rejects.toThrow("Backend unavailable");
  });
});
