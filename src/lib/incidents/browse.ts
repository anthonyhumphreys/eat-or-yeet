export { namedRetailers } from "./retailers";

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

export const foodCategoryGroups: Array<{ label: string; categories: FoodCategory[] }> = [
  { label: "Fresh & chilled", categories: ["Produce", "Meat & poultry", "Fish & seafood", "Dairy & eggs"] },
  { label: "Cupboard & snacks", categories: ["Bakery & grains", "Pantry", "Snacks & sweets", "Drinks"] },
  { label: "Meals & other products", categories: ["Prepared foods", "Supplements", "Other foods"] },
];

type BrowseSource = {
  title: string;
  targets: Array<{ type: string; value: string }>;
  originalSourceData: unknown;
};

const categoryRules: Array<[FoodCategory, RegExp]> = [
  ["Supplements", /\b(?:supplement|vitamin|herbal formula|moringa|supergrass)\b/i],
  ["Prepared foods", /\b(?:ready meal|meal kit|sandwich|wrap|pizza|sushi|soup|curry|lasagne|pasta meal|prepared meal|(?:chicken|tuna|pasta|potato|egg) salad)\b/i],
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
