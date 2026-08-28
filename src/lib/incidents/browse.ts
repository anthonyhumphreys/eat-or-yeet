import { normaliseText } from "../matching/normalise";

export const foodCategories = [
  "Produce",
  "Meat & poultry",
  "Fish & seafood",
  "Dairy & eggs",
  "Bakery & grains",
  "Snacks & sweets",
  "Drinks",
  "Prepared foods",
  "Pantry",
  "Supplements",
  "Other foods",
] as const;

export type FoodCategory = (typeof foodCategories)[number];

type BrowseSource = {
  title: string;
  targets: Array<{ type: string; value: string }>;
  originalSourceData: unknown;
};

const categoryRules: Array<[FoodCategory, RegExp]> = [
  ["Supplements", /\b(?:supplement|vitamin|herbal formula|moringa|supergrass)\b/i],
  ["Drinks", /\b(?:drink|juice|soda|cola|water|beer|ale|lager|wine|cider|smoothie|coffee|tea|ipa)\b/i],
  ["Snacks & sweets", /\b(?:chocolate|sweet|candy|confection|truffle|marshmallow|popcorn|chips?|crisps?|snack|bars?|puffs?)\b/i],
  ["Fish & seafood", /\b(?:fish|salmon|tuna|cod|haddock|prawn|shrimp|crab|lobster|mussel|oyster|seafood|anchov)/i],
  ["Dairy & eggs", /\b(?:milk|cheese|yogurt|yoghurt|cream|butter|eggs?|mozzarella|ricotta|requeson|ice cream|gelato)\b/i],
  ["Meat & poultry", /\b(?:beef|pork|lamb|chicken|turkey|duck|ham|bacon|sausage|meat|poultry|steak)\b/i],
  ["Produce", /\b(?:fruits?|vegetables?|sprouts?|alfalfa|lettuce|lett\/rom|iceberg|salad leaves|leafy greens|spinach|kale|broccoli|cauliflower|yams?|mango(?:es|s)?|berry|berries|apples?|melons?|tomato(?:es|s)?|peppers?|cucumbers?|avocados?|onions?|potato(?:es|s)?|mushrooms?|herbs?)\b/i],
  ["Prepared foods", /\b(?:ready meal|meal kit|sandwich|wrap|pizza|sushi|soup|salad|curry|lasagne|pasta meal|prepared meal)\b/i],
  ["Bakery & grains", /\b(?:bread|bun|roll|bagel|cake|pastry|croissant|shortbread|crumble|flour|rice|pasta|noodles?|wonton|dumpling|cereal|oat|granola|biscuit|cookie|cracker)\b/i],
  ["Pantry", /\b(?:sauce|salsa|dip|paste|oil|olives?|spice|seasoning|pickle|jam|honey|spread|tinned|canned|bean|lentil)\b/i],
];

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

export function browseCategories(incident: BrowseSource): FoodCategory[] {
  // These labels organise the feed; they never enter the safety matcher.
  const products = incident.targets.filter((target) => target.type === "product" || target.type === "category").map((target) => target.value);
  const names = products.length ? products : [incident.title];
  const found = new Set<FoodCategory>();
  for (const name of names) {
    found.add(categoryRules.find(([, pattern]) => pattern.test(name))?.[0] ?? "Other foods");
  }
  return [...found];
}

export function namedRetailers(incident: BrowseSource): string[] {
  const explicit = incident.targets.filter((target) => target.type === "retailer").map((target) => target.value.trim()).filter(Boolean);
  const business = sourceBusiness(incident.originalSourceData);
  const namedBusiness = business ? retailerNames[normaliseText(business)] : undefined;
  return [...new Set([...explicit, ...(namedBusiness ? [namedBusiness] : [])])];
}
