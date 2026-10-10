import { readResponseJson } from "@/lib/http/bounded-response";
import { relevantOffCategoryTags } from "@/lib/incidents/categories";

export const OFF_USER_AGENT = "EatOrYeet/1.0 (food safety metadata lookup)";

/** Open Food Facts keys products by their printed 8, 12 or 13-digit code, not the padded GTIN-14. */
export function lookupBarcode(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 14) return digits;
  for (const length of [8, 12, 13]) {
    const prefixLength = 14 - length;
    if (digits.startsWith("0".repeat(prefixLength))) return digits.slice(prefixLength);
  }
  return digits;
}

export type CategoryLookup = { status: "found"; tags: string[] } | { status: "missing" };

/** Returns null when Open Food Facts could not answer, so the caller retries later. */
export async function fetchOffCategoryTags(gtin: string, fetcher: typeof fetch = fetch): Promise<CategoryLookup | null> {
  try {
    const response = await fetcher(
      `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(lookupBarcode(gtin))}.json?fields=categories_tags`,
      { headers: { "User-Agent": OFF_USER_AGENT }, signal: AbortSignal.timeout(5_000) },
    );
    if (response.status === 404) return { status: "missing" };
    if (!response.ok) return null;
    const body = await readResponseJson<{ status?: unknown; product?: { categories_tags?: unknown } }>(response, 64 * 1024);
    if (body?.status === 0) return { status: "missing" };
    if (body?.status !== 1) return null;
    const categories = body.product?.categories_tags;
    const listed: unknown[] = Array.isArray(categories) ? categories : [];
    const tags = listed.filter((tag): tag is string => typeof tag === "string" && relevantOffCategoryTags.has(tag));
    return tags.length ? { status: "found", tags: [...new Set(tags)].sort() } : { status: "missing" };
  } catch {
    return null;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Lookups are ordered by `due`. Unchecked barcodes get a negative due time so
 * they always come before rechecks, newest notice first.
 */
export function categoryLookupDue(lookup: CategoryLookup | null, now: number): number {
  if (!lookup) return now + DAY_MS;
  return now + (lookup.status === "found" ? 90 : 30) * DAY_MS;
}

export function pendingLookupDue(publishedAt: number): number {
  return -Math.max(0, publishedAt);
}

/** The cached tags for a notice's barcodes, or undefined so unrelated notices keep their stored shape. */
export function productCategoryTagsFor(
  targets: ReadonlyArray<{ type: string; valueNormalized?: string }>,
  cached: ReadonlyMap<string, string[]>,
): Record<string, string[]> | undefined {
  const entries = targets
    .filter((target) => target.type === "gtin" && target.valueNormalized && cached.has(target.valueNormalized))
    .map((target) => [target.valueNormalized!, cached.get(target.valueNormalized!)!] as const);
  return entries.length ? Object.fromEntries(entries) : undefined;
}
