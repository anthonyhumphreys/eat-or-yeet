import type { ProductCategory } from "./categories";

// Super-categories sit above browse categories: what kind of product a recall
// is about. A recall can be in more than one (infant formula is Baby and Food).
// Each source declares its main super-category; Baby is added on top.
export const superCategories = ["Baby", "Cosmetics", "Food", "Medical", "Pet"] as const;

export type SuperCategory = (typeof superCategories)[number];

// Specific words only: "children's" covers ages well past baby products.
const babyMedicineSignals = /\b(?:infants?|babies|baby|newborns?|toddlers?|pa?ediatric|teething|gripe water)\b/i;

export type SuperCategorySource = {
  /** The source's own super-category. Rows imported before sources declared one are food. */
  source?: SuperCategory;
  title: string;
  summary?: string | null;
  categories: readonly ProductCategory[];
};

export function incidentSuperCategories({ source = "Food", title, summary, categories }: SuperCategorySource): SuperCategory[] {
  const found = new Set<SuperCategory>([source]);
  if (categories.includes("Baby food")) found.add("Baby");
  if (source === "Medical" && babyMedicineSignals.test(`${title} ${summary ?? ""}`)) found.add("Baby");
  return superCategories.filter((category) => found.has(category));
}

/** Rows saved before super-categories existed are all food recalls. */
export function rowSuperCategories(row: { superCategories?: readonly SuperCategory[] }): readonly SuperCategory[] {
  return row.superCategories ?? ["Food"];
}

export function isSuperCategory(value: unknown): value is SuperCategory {
  return typeof value === "string" && (superCategories as readonly string[]).includes(value);
}
