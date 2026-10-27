import { normaliseText } from "@/lib/matching/normalise";

/** Shared public-feed/search text fields and all-terms matching semantics. */
export function warningSearchText(row: {
  title: string;
  stores: string[];
  hazard: { label: string };
  categories: string[];
  /** Complete source-derived text, separate from shortened display labels. */
  searchText?: string;
  hazardText?: string | null;
  targets?: readonly { type: string; value: string }[];
}): string {
  const products = row.targets?.filter((target) => target.type === "product" || target.type === "brand").map((target) => target.value) ?? [];
  return normaliseText([row.title, ...row.stores, row.hazard.label, ...row.categories, row.searchText ?? "", row.hazardText ?? "", ...products].join(" "));
}

export function warningSearchTerms(query: string): string[] {
  return query.trim().split(/\s+/).map(normaliseText).filter(Boolean);
}

export function warningSearchMatchesText(indexedText: string, terms: string[]): boolean {
  return terms.every((term) => indexedText.includes(term));
}
