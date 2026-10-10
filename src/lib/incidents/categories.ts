import { normaliseGtin } from "../matching/normalise";
import { containsWords, words } from "./words";

// Food types organise the browse feed. They never enter the safety matcher.
//
// Official notices carry no food-type field, and product names often do not
// say what the food is ("Doritos Chilli Heatwave", "Capri Sun Orange"). Each
// product's food type comes from the first of:
//   1. Open Food Facts categories for the product's barcode, looked up and
//      cached by the importer (see convex/products.ts);
//   2. known single-format product lines ("Pot Noodle" is a snack meal even
//      when it says "Chicken Flavour");
//   3. generic food words, ordered so what a product *is* (a sauce, a bun, a
//      ready meal) beats what is in it (chicken, chocolate);
//   4. a known product line named in the notice title.
// "Baby food" and "Pharmaceutical" are extra tags added on top of the food
// type, so a fruit pouch is listed under both Produce and Baby food.

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
  "Baby food",
  "Pharmaceutical",
  "Supplements",
  "Other foods",
] as const;

export type FoodCategory = (typeof foodCategories)[number];

export const foodCategoryGroups: Array<{ label: string; categories: FoodCategory[] }> = [
  { label: "Fresh & chilled", categories: ["Produce", "Meat & poultry", "Fish & seafood", "Dairy & eggs"] },
  { label: "Cupboard & snacks", categories: ["Bakery & grains", "Pantry", "Snacks & sweets", "Drinks"] },
  { label: "Meals & other products", categories: ["Prepared foods", "Baby food", "Pharmaceutical", "Supplements", "Other foods"] },
];

// Open Food Facts lists every ancestor in categories_tags, so a few broad
// tags cover the taxonomy. First match wins, in the same "what it is" order
// as the word rules: doughnuts sit under both biscuits-and-cakes and snacks.
const offFoodTypes: Array<[FoodCategory, string[]]> = [
  ["Supplements", ["en:dietary-supplements"]],
  ["Prepared foods", ["en:meals", "en:sandwiches"]],
  ["Drinks", ["en:beverages"]],
  ["Bakery & grains", ["en:biscuits-and-cakes", "en:breads", "en:viennoiseries", "en:cereals-and-their-products", "en:pastas", "en:rices"]],
  ["Snacks & sweets", ["en:snacks"]],
  ["Pantry", ["en:condiments", "en:spreads", "en:sweeteners", "en:fats", "en:pickles"]],
  ["Fish & seafood", ["en:seafood"]],
  ["Dairy & eggs", ["en:dairies", "en:eggs", "en:ice-creams-and-sorbets"]],
  ["Meat & poultry", ["en:meats-and-their-products"]],
  ["Produce", ["en:fruits", "en:vegetables"]],
  ["Pantry", ["en:canned-foods"]],
];

const OFF_BABY_TAG = "en:baby-foods";

/** The only Open Food Facts tags worth storing; everything else is ignored. */
export const relevantOffCategoryTags: ReadonlySet<string> = new Set([OFF_BABY_TAG, ...offFoodTypes.flatMap(([, tags]) => tags)]);

export function foodTypeFromOffTags(tags: readonly string[]): FoodCategory | null {
  return offFoodTypes.find(([, wanted]) => wanted.some((tag) => tags.includes(tag)))?.[0] ?? null;
}

/**
 * Product lines that only come in one format, so the name alone settles the
 * food type. Umbrella brands that span formats (Heinz, Cadbury, Nutella,
 * Walkers) are deliberately left out: "Nutella Croissant" is bakery.
 */
const knownProducts: Array<[FoodCategory, string[]]> = [
  ["Prepared foods", ["Pot Noodle", "Super Noodles", "Cup Noodles", "Maruchan", "Pot Pasta"]],
  ["Drinks", [
    "Capri-Sun", "Coca-Cola", "Coke", "Pepsi", "Fanta", "Sprite", "7UP", "Dr Pepper", "Irn-Bru", "Lucozade",
    "Ribena", "Red Bull", "Monster Energy", "Prime Hydration", "Tropicana", "Volvic", "Evian", "Gatorade",
    "Powerade", "Snapple",
  ]],
  ["Snacks & sweets", [
    "Doritos", "Pringles", "Lay's", "Quavers", "Wotsits", "Monster Munch", "Hula Hoops", "Skips", "Frazzles",
    "Cheetos", "Takis", "Tyrrells", "Kettle Chips", "Haribo", "Skittles", "Starburst", "Maltesers",
    "Toblerone", "Reese's", "Swizzels", "Chupa Chups", "Jelly Belly",
  ]],
  ["Bakery & grains", [
    "Krispy Kreme", "Warburtons", "Hovis", "Kingsmill", "Lambertz", "McVitie's", "Jacob's", "Ritz", "Oreo",
    "Weetabix", "Kellogg's",
  ]],
  ["Dairy & eggs", ["Babybel", "Dairylea", "Cathedral City", "Yeo Valley", "Müller", "Activia", "Ben & Jerry's", "Häagen-Dazs"]],
];

/** Brands that only make food for babies and toddlers. */
const babyBrands = [
  "Aptamil", "Cow & Gate", "SMA", "Kendamil", "HiPP", "Ella's Kitchen", "Little Freddie", "Organix",
  "Kiddylicious", "Gerber", "Similac", "Enfamil", "ByHeart", "Bobbie", "Earth's Best", "Plum Organics",
  "Happy Baby", "Baby Gourmet",
];

// "Capri-Sun" is also written "Capri Sun", so each hyphenated name gets both spellings.
function spellings(name: string): string[][] {
  return [...new Set([words(name).join(" "), words(name.replace(/-/g, " ")).join(" ")])].map((spelling) => spelling.split(" "));
}

const knownProductWords = knownProducts.flatMap(([category, names]) => names.flatMap((name) => spellings(name).map((spelling) => ({ category, name: spelling }))));
const babyBrandWords = babyBrands.flatMap(spellings);

// Specific phrases only: "Baby Spinach" and "baby potatoes" are produce.
const babySignals = /\b(?:baby (?:foods?|milk|formula|rice|porridge|cereal|snacks?|puffs|pouch(?:es)?)|for babies|infants?|toddlers?|follow[- ]on milk|growing[- ]up milk|weaning|from (?:4|6|7|9|10|12) months)\b|\b\d{1,2}\s?m(?:onths?)?\+/i;

// A medicine in or as the product: hidden drugs in supplements and honey,
// or veterinary medicine residues in food.
const pharmaceuticalSignals = /\b(?:tadalafil|sildenafil|vardenafil|sibutramine|phenolphthalein|tianeptine|phenibut|dmaa|dmha|undeclared (?:drug|pharmaceutical)s?|drug ingredients?|unapproved (?:new )?drugs?|hidden drugs?|pharmaceuticals?|prescription (?:drugs?|medicines?)|veterinary (?:medicines?|drugs?)|(?:antibiotic|drug|medicine) residues?|penicillin)\b/i;

// First match wins. Optional plurals are spelled out so each list stays readable.
const categoryRules: Array<[FoodCategory, RegExp]> = [
  ["Supplements", /\b(?:supplements?|vitamins?|herbal formula|moringa|supergrass|cod liver oil|fish oil|omega[- ]?3|protein powder|capsules?)\b/i],
  ["Prepared foods", /\b(?:ready meals?|meal kits?|sandwich(?:es)?|wraps?|pizzas?|sushi|soups?|curry|curries|lasagne|pasta meals?|pasta bake|prepared meals?|(?:chicken|tuna|pasta|orzo|couscous|grain|rice|noodle|potato|egg)\s+salads?|coleslaw|quiches?|burritos?|samosas?|spring rolls?|(?:fish|crab)\s?cakes?|biryani|risotto|stir[- ]fry|noodle pots?|instant noodles)\b/i],
  ["Drinks", /\b(?:drinks?|juices?|soda|cola|water|beer|ale|lager|wine|cider|smoothies?|coffee|tea|ipa|squash|cordial|kombucha|lemonade|milkshakes?|(?:oat|rice|almond|soya?|coconut|plant) milk)\b/i],
  ["Bakery & grains", /\b(?:bread|buns?|rolls?|bagels?|cakes?|pastry|pastries|croissants?|doughnuts?|donuts?|brioche|muffins?|crumpets?|scones?|pancakes?|waffles?|shortbread|biscuits?|cookies?|crackers?|crumble|spekulatius|speculoos|gingerbread|stollen|panettone)\b/i],
  ["Snacks & sweets", /\b(?:chocolates?|choc|sweets|candy|confectionery|confections?|marshmallows?|popcorn|chips?|crisps?|snacks?|bars?|puffs?|fudge|toffee|nougat|lollipops?|jelly beans|pretzels?)\b/i],
  ["Pantry", /\b(?:sauces?|salsa|dips?|paste|pesto|houmous|hummus|oils?|olives?|spices?|seasonings?|stock|gravy|ketchup|mayonnaise|mayo|chutney|pickles?|jams?|marmalade|honey|spreads?|vinegar|syrup)\b/i],
  ["Bakery & grains", /\b(?:cereals?|granola|oats?|porridge|flour|rice|pasta|orzo|couscous|quinoa|noodles?|wontons?|dumplings?)\b/i],
  ["Fish & seafood", /\b(?:fish|salmon|tuna|cod|haddock|mackerel|sardines?|prawns?|shrimp|crab|lobster|mussels?|oysters?|scallops?|squid|seafood|anchov(?:y|ies))\b/i],
  ["Dairy & eggs", /\b(?:milk|cheeses?|yogh?urts?|cream|butter|eggs?|mozzarella|ricotta|requeson|gouda|cheddar|brie|camembert|feta|halloumi|parmesan|mascarpone|paneer|stilton|burrata|bocconcini|kefir|custard|ice creams?|gelato)\b/i],
  ["Meat & poultry", /\b(?:beef|pork|lamb|chicken|turkey|duck|ham|bacon|sausages?|meat|poultry|steak|chorizo|salami|pepperoni|prosciutto|pastrami|jerky|mince|meatballs?)\b/i],
  ["Produce", /\b(?:fruits?|vegetables?|veg|sprouts?|alfalfa|lettuce|lett\/rom|iceberg|salad leaves|leafy greens|spinach|kale|broccoli|cauliflower|cabbage|carrots?|corn|sweetcorn|peas|asparagus|beetroot|courgettes?|aubergines?|leeks?|garlic|ginger|yams?|mango(?:es|s)?|(?:straw|rasp|blue|black|goose|cran)?berry|(?:straw|rasp|blue|black|goose|cran)?berries|apples?|pears?|peach(?:es)?|plums?|cherries|cherry|grapes?|oranges?|lemons?|limes?|bananas?|pineapples?|melons?|tomato(?:es|s)?|peppers?|cucumbers?|avocados?|onions?|potato(?:es|s)?|mushrooms?|herbs?)\b/i],
  ["Prepared foods", /\bsalads?\b/i],
  ["Pantry", /\b(?:tinned|canned|beans?|lentils?|chickpeas?)\b/i],
];

const protein = /\b(?:chicken|beef|pork|lamb|turkey|duck|ham|bacon|sausages?|meatballs?|fish|salmon|tuna|cod|prawns?)\b/i;
const starch = /\b(?:rice|pilau|pasta|orzo|couscous|noodles?)\b/i;

/** "Piri Piri Chicken Flavour" names a taste, not an ingredient. */
function withoutFlavours(name: string): string {
  return name.replace(/\b[\p{L}'’]+\s+flavou?r(?:ed)?\b/giu, " ");
}

function knownFoodType(name: string): FoodCategory | null {
  const nameWords = words(name);
  return knownProductWords.find((product) => containsWords(nameWords, product.name))?.category ?? null;
}

function genericFoodType(name: string): FoodCategory | null {
  const text = withoutFlavours(name);
  // A protein served with a starch is a meal: "Chicken Pasanda & Nutty Pilau Rice".
  if (protein.test(text) && starch.test(text)) return "Prepared foods";
  return categoryRules.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
}

function isBabyFood(name: string): boolean {
  if (babySignals.test(name)) return true;
  const nameWords = words(name);
  return babyBrandWords.some((brand) => containsWords(nameWords, brand));
}

/** Drops "Update 1:" and the hazard clause, so "because of undeclared milk" never reads as dairy. */
function titleProducts(title: string): string {
  return title
    .replace(/^\s*update(?:d)?\s*\d*\s*:\s*/i, "")
    .split(/\b(?:because|due to|as a precaution|following|after|over (?:concerns|fears))\b/i)[0];
}

export type CategorySource = {
  title: string;
  targets: Array<{ type: string; value: string; valueNormalized?: string; groupId?: string | null }>;
  hazard?: string | null;
  summary?: string | null;
  /** Relevant Open Food Facts category tags by normalised GTIN, attached at import. */
  productCategoryTags?: Record<string, string[]> | null;
};

export function browseCategories(incident: CategorySource): FoodCategory[] {
  const title = titleProducts(incident.title);
  const offTags = incident.productCategoryTags ?? {};
  const gtinTags = (target: CategorySource["targets"][number]) =>
    offTags[target.valueNormalized || normaliseGtin(target.value)] ?? [];

  const gtins = incident.targets.filter((target) => target.type === "gtin");
  const products = incident.targets.filter((target) => target.type === "product" || target.type === "category");
  const productGroups = new Set(products.map((target) => target.groupId).filter(Boolean));
  // Barcodes not tied to a named product (FDA lists UPCs separately) describe the notice as a whole.
  const looseTags = gtins.filter((target) => !target.groupId || !productGroups.has(target.groupId)).flatMap(gtinTags);
  const allTags = gtins.flatMap(gtinTags);

  const found = new Set<FoodCategory>();
  if (products.length) {
    for (const product of products) {
      const groupTags = product.groupId ? gtins.filter((target) => target.groupId === product.groupId).flatMap(gtinTags) : [];
      found.add(
        foodTypeFromOffTags(groupTags)
          ?? foodTypeFromOffTags(looseTags)
          ?? knownFoodType(product.value)
          ?? genericFoodType(product.value)
          // The title only lends a known product line ("Krispy Kreme"), never
          // its generic words, which may describe another product in the notice.
          ?? knownFoodType(title)
          ?? "Other foods",
      );
    }
  } else {
    found.add(foodTypeFromOffTags(allTags) ?? knownFoodType(title) ?? genericFoodType(title) ?? "Other foods");
  }

  const names = [title, ...products.map((product) => product.value)];
  if (allTags.includes(OFF_BABY_TAG) || names.some(isBabyFood)) found.add("Baby food");
  if ([incident.title, incident.hazard, incident.summary, ...products.map((product) => product.value)]
    .some((text) => text && pharmaceuticalSignals.test(text))) found.add("Pharmaceutical");

  return [...found];
}
