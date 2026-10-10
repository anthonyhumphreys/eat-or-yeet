import { normaliseText } from "../matching/normalise";

export { browseCategories, foodCategories, foodCategoryGroups, medicineBrowseCategories, productCategories, type CategorySource, type FoodCategory, type ProductCategory } from "./categories";
export { incidentSuperCategories, isSuperCategory, rowSuperCategories, superCategories, type SuperCategory } from "./super-categories";

type BrowseSource = {
  title: string;
  targets: Array<{ type: string; value: string }>;
  originalSourceData: unknown;
};

const retailerNames: Record<string, string> = {
  tesco: "Tesco",
  waitrose: "Waitrose",
  waitrosepartners: "Waitrose",
  sainsburys: "Sainsbury's",
  sainsburyssupermarketsltd: "Sainsbury's",
  asda: "Asda",
  aldi: "Aldi",
  aldistoreslimited: "Aldi",
  lidl: "Lidl",
  lidlustrading: "Lidl",
  morrisons: "Morrisons",
  coop: "Co-op",
  marksandspencer: "Marks & Spencer",
  ms: "Marks & Spencer",
  iceland: "Iceland",
  ocado: "Ocado",
  walmart: "Walmart",
  target: "Target",
  kroger: "Kroger",
  traderjoes: "Trader Joe's",
  costco: "Costco",
  publix: "Publix",
  safeway: "Safeway",
  albertsons: "Albertsons",
  wholefoodsmarket: "Whole Foods Market",
};

function sourceBusiness(source: unknown): string | null {
  if (!source || typeof source !== "object") return null;
  const data = source as Record<string, unknown>;
  const reporting = data.reportingBusiness;
  if (reporting && typeof reporting === "object") {
    const name = (reporting as Record<string, unknown>).commonName;
    if (typeof name === "string") return name;
  }
  if (typeof data.recalling_firm === "string") return data.recalling_firm;
  if (typeof data.company === "string") return data.company;
  return null;
}

export function namedRetailers(incident: BrowseSource): string[] {
  const explicit = incident.targets.filter((target) => target.type === "retailer").map((target) => target.value.trim()).filter(Boolean);
  const business = sourceBusiness(incident.originalSourceData);
  const namedBusiness = business ? retailerNames[normaliseText(business)] : undefined;
  return [...new Set([...explicit, ...(namedBusiness ? [namedBusiness] : [])])];
}
