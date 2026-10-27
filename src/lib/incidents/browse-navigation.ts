import { isSuperCategory, productCategories, type ProductCategory, type SuperCategory } from "./browse";
import { hazardKinds, type HazardKind } from "./hazard";
import { parseRegion, type WarningRegion } from "../location";

export type ExplorerFilters = { q: string; hazard?: HazardKind; type?: SuperCategory; category?: ProductCategory; store?: string };
export const BROWSE_PAGE_SIZE = 40;

export function filterUrl(path: string, region: WarningRegion, { q, hazard, type, category, store }: ExplorerFilters, page?: number) {
  const params = new URLSearchParams({ region });
  if (q) params.set("q", q);
  if (hazard) params.set("hazard", hazard);
  if (type) params.set("type", type);
  if (category) params.set("category", category);
  if (store) params.set("store", store);
  if (page && page > 1) params.set("page", String(Math.min(999, Math.floor(page))));
  return `${path}?${params}`;
}

/** Accept only local list routes and the same bounded filters as the list UI. */
export function browseReturnUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048 || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  const url = new URL(value, "https://browse.invalid");
  if (url.origin !== "https://browse.invalid" || !["/", "/incidents"].includes(url.pathname) || url.hash) return null;
  const params = url.searchParams;
  const region = parseRegion(params.get("region"));
  if (!region) return null;
  const hazard = params.get("hazard");
  const type = params.get("type");
  const category = params.get("category");
  const page = params.get("page");
  return filterUrl(url.pathname, region, {
    q: (params.get("q") ?? "").slice(0, 120),
    hazard: hazardKinds.includes(hazard as HazardKind) ? hazard as HazardKind : undefined,
    type: isSuperCategory(type) ? type : undefined,
    category: productCategories.includes(category as ProductCategory) ? category as ProductCategory : undefined,
    store: params.get("store")?.slice(0, 120) || undefined,
  }, page && /^\d{1,3}$/.test(page) ? Math.max(1, Number(page)) : 1);
}
