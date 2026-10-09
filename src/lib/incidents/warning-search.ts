import { normaliseText } from "@/lib/matching/normalise";

/** Shared public-feed/search text fields and all-terms matching semantics. */
export function warningSearchText(row: {
  title: string;
  stores: string[];
  hazard: { label: string };
  categories: string[];
}): string {
  return normaliseText(`${row.title} ${row.stores.join(" ")} ${row.hazard.label} ${row.categories.join(" ")}`);
}

export function warningSearchTerms(query: string): string[] {
  return query.trim().split(/\s+/).map(normaliseText).filter(Boolean);
}

export function warningSearchMatchesText(indexedText: string, terms: string[]): boolean {
  return terms.every((term) => indexedText.includes(term));
}
