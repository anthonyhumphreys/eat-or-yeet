import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { getPublicWarningSnapshot } from "@/db/queries";
import type { DatasetStatus } from "@/lib/domain/types";
import type { Region } from "@/lib/domain/schemas";
import { foodCategories, rowSuperCategories, type FoodCategory } from "@/lib/incidents/browse";
import { classifyHazard, hazardKinds, type HazardKind } from "@/lib/incidents/hazard";
import { normaliseText } from "@/lib/matching/normalise";
import { securitySecret } from "@/lib/security/config";
import { warningSearchMatchesText, warningSearchTerms, warningSearchText } from "@/lib/incidents/warning-search";

const CURSOR_TTL_MS = 10 * 60 * 1_000;
const MAX_PAGE_SIZE = 20;
const MAX_QUERY_LENGTH = 200;
const CURSOR_PURPOSE = "eat-or-yeet:warning-search-cursor:v1:";

type Snapshot = Awaited<ReturnType<typeof getPublicWarningSnapshot>>;
type BrowseRow = Snapshot["rows"][number];

export type SearchWarningsInput = {
  region: Region;
  query?: string;
  hazard?: HazardKind;
  category?: FoodCategory;
  retailer?: string;
  pageSize?: number;
  cursor?: string;
};

export type SearchWarningsResult = {
  items: BrowseRow[];
  total: number;
  nextCursor: string | null;
  asOf: string;
  status: DatasetStatus;
  complete: true;
};

type Filters = { query: string; hazard: HazardKind | null; category: FoodCategory | null; retailer: string };
type CursorPayload = {
  v: 1;
  region: Region;
  filters: Filters;
  revision: string;
  pageSize: number;
  offset: number;
  asOf: number;
  expiresAt: number;
  boundaryAt: number | null;
};

export type WarningSearchCursorErrorCode = "invalid" | "expired" | "filters_changed" | "revision_changed" | "eligibility_changed";

/** Cursor errors are recoverable by restarting the search without a cursor. */
export class WarningSearchCursorError extends Error {
  readonly recoverable = true;

  constructor(readonly code: WarningSearchCursorErrorCode) {
    super("This warning search page has expired or changed. Restart the search to see current results.");
    this.name = "WarningSearchCursorError";
  }
}

function normalizedFilters(input: SearchWarningsInput): Filters {
  const rawQuery = input.query?.trim() ?? "";
  if (rawQuery.length > MAX_QUERY_LENGTH) throw new RangeError(`Search query must be ${MAX_QUERY_LENGTH} characters or fewer.`);
  return {
    query: warningSearchTerms(rawQuery).join(" "),
    hazard: input.hazard && hazardKinds.includes(input.hazard) ? input.hazard : null,
    category: input.category && foodCategories.includes(input.category) ? input.category : null,
    retailer: normaliseText(input.retailer),
  };
}

function cursorSignature(encoded: string): Buffer {
  return createHmac("sha256", securitySecret()).update(CURSOR_PURPOSE).update(encoded).digest();
}

function signCursor(payload: CursorPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${cursorSignature(encoded).toString("base64url")}`;
}

function readCursor(cursor: string): CursorPayload {
  try {
    if (cursor.length > 2048) throw new Error("too_large");
    const [encoded, signature, extra] = cursor.split(".");
    if (!encoded || !signature || extra !== undefined) throw new Error("malformed");
    const actual = Buffer.from(signature, "base64url");
    const expected = cursorSignature(encoded);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("signature");
    const value: unknown = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (!value || typeof value !== "object") throw new Error("payload");
    const payload = value as Partial<CursorPayload>;
    if (payload.v !== 1 || (payload.region !== "UK" && payload.region !== "US") || !payload.filters ||
        typeof payload.revision !== "string" || !Number.isSafeInteger(payload.pageSize) ||
        !Number.isSafeInteger(payload.offset) || (payload.offset as number) < 1 ||
        !Number.isSafeInteger(payload.asOf) || !Number.isSafeInteger(payload.expiresAt) ||
        !(payload.boundaryAt === null || Number.isSafeInteger(payload.boundaryAt))) throw new Error("payload");
    return payload as CursorPayload;
  } catch {
    throw new WarningSearchCursorError("invalid");
  }
}

function nextEligibilityBoundary(rows: BrowseRow[], asOf: number): number | null {
  let earliest: number | null = null;
  for (const row of rows) {
    for (const boundary of [row.startsAt, row.endsAt]) {
      if (boundary !== undefined && boundary > asOf && (earliest === null || boundary < earliest)) earliest = boundary;
    }
  }
  return earliest;
}

function isActiveAt(row: BrowseRow, asOf: number) {
  return row.startsAt <= asOf && (row.endsAt === undefined || row.endsAt > asOf);
}

function matches(row: BrowseRow, filters: Filters): boolean {
  const hazard = classifyHazard(row);
  if (!warningSearchMatchesText(warningSearchText({ ...row, hazard }), warningSearchTerms(filters.query))) return false;
  if (filters.hazard && hazard.kind !== filters.hazard) return false;
  if (filters.category && !row.categories.includes(filters.category)) return false;
  if (filters.retailer && !row.stores.some((store) => normaliseText(store) === normaliseText(filters.retailer))) return false;
  return true;
}

/** Complete regional warning search over the cached public snapshot. */
export async function searchWarnings(
  input: SearchWarningsInput,
  options: { signal?: AbortSignal } = {},
): Promise<SearchWarningsResult> {
  options.signal?.throwIfAborted();
  const filters = normalizedFilters(input);
  const pageSize = Math.max(1, Math.min(MAX_PAGE_SIZE, Math.floor(input.pageSize ?? MAX_PAGE_SIZE)));
  const snapshot = await getPublicWarningSnapshot(input.region, options);
  options.signal?.throwIfAborted();
  let offset = 0;
  let asOf = snapshot.asOf;
  let boundaryAt = nextEligibilityBoundary(snapshot.rows, asOf);

  if (input.cursor) {
    const cursor = readCursor(input.cursor);
    if (cursor.region !== input.region || cursor.pageSize !== pageSize || JSON.stringify(cursor.filters) !== JSON.stringify(filters)) {
      throw new WarningSearchCursorError("filters_changed");
    }
    if (cursor.revision !== snapshot.revision) throw new WarningSearchCursorError("revision_changed");
    if (cursor.boundaryAt !== null && snapshot.asOf >= cursor.boundaryAt) throw new WarningSearchCursorError("eligibility_changed");
    if (snapshot.asOf >= cursor.expiresAt) throw new WarningSearchCursorError("expired");
    offset = cursor.offset;
    asOf = cursor.asOf;
    boundaryAt = cursor.boundaryAt;
  }

  const items = snapshot.rows.filter((row) => rowSuperCategories(row).includes("Food") && isActiveAt(row, asOf) && matches(row, filters))
    .sort((a, b) => b.updatedAt - a.updatedAt || a.slug.localeCompare(b.slug));
  const page = items.slice(offset, offset + pageSize);
  const nextOffset = offset + page.length;
  const nextCursor = nextOffset < items.length
    ? signCursor({
      v: 1,
      region: input.region,
      filters,
      revision: snapshot.revision,
      pageSize,
      offset: nextOffset,
      asOf,
      expiresAt: Math.min(asOf + CURSOR_TTL_MS, boundaryAt ?? Number.MAX_SAFE_INTEGER),
      boundaryAt,
    })
    : null;
  return { items: page, total: items.length, nextCursor, asOf: new Date(asOf).toISOString(), status: snapshot.status, complete: true };
}
