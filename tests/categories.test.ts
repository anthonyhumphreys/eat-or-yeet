import { describe, expect, it } from "vitest";

import { browseCategories, foodTypeFromOffTags, relevantOffCategoryTags } from "@/lib/incidents/categories";

const product = (value: string, groupId?: string) => ({ type: "product", value, ...(groupId ? { groupId } : {}) });
const gtin = (value: string, groupId?: string) => ({ type: "gtin", value, valueNormalized: value.padStart(14, "0"), ...(groupId ? { groupId } : {}) });

describe("food types from product names", () => {
  // Exact product names and titles from current FSA notices that used to land in the wrong place.
  it.each([
    ["FSA-AA-38-2026", "PepsiCo recalls Doritos Chilli Heatwave because of undeclared milk", ["Doritos Chilli Heatwave"], ["Snacks & sweets"]],
    ["FSA-PRIN-34-2026", "Capri Sun UK recalls specific batches of Capri-Sun Orange 10 pack because they contain some cartons of Capri-Sun Zero", ["Capri Sun Orange"], ["Drinks"]],
    ["FSA-AA-43-2026", "Unilever recalls Pot Noodle Piri Piri Chicken Flavour because of undeclared milk", ["Pot Noodle Piri Piri Chicken Flavour"], ["Prepared foods"]],
    ["FSA-AA-29-2026", "Waitrose & Partners recalls Waitrose & Partners 4 Richly Fruited Hot Cross Buns because of undeclared barley", ["Waitrose & Partners 4 Richly Fruited Hot Cross Buns"], ["Bakery & grains"]],
    ["FSA-AA-31-2026", "Krispy Kreme recalls Individual Pitch Perfect Doughnut & Match Day Dozen because of undeclared hazelnuts (nuts)", ["Krispy Kreme Individual Pitch Perfect Doughnut", "Krispy Kreme Match May Dozen"], ["Bakery & grains"]],
    ["FSA-AA-44-2026", "Lambertz recalls Lambertz Mini Spekulatius and Lambertz Christmas Tree Cookies because allergens are not declared in English on the label", ["Lambertz Mini Spekulatius", "Lambertz Christmas Tree Cookies"], ["Bakery & grains"]],
    ["FSA-PRIN-33-2026", "M&S recalls M&S Food Truffle Gouda due to the presence of Listeria Monocytogenes", ["M&S Food Truffle Gouda"], ["Dairy & eggs"]],
    ["FSA-PRIN-48-2026", "Greencore recalls several products due to the presence of Salmonella", ["Pinch Pan Poppin’ Chicken Pasanda & Nutty Pilau Rice", "M&S Fresh Collection Pistachio Pesto"], ["Prepared foods", "Pantry"]],
    ["FSA-AA-34-2026", "SPAR UK recalls Clayton Park Kitchen Chicken & Mushroom sauce because of undeclared soya", ["Clayton Park Kitchen Chicken & Mushroom sauce"], ["Pantry"]],
    ["FSA-AA-42-2026", "Tesco recalls Tesco Finest Caesar & Smoked Bacon Coleslaw because of undeclared mustard", ["Tesco Finest Caesar & Smoked Bacon Coleslaw"], ["Prepared foods"]],
    ["FSA-AA-35-2026", "Dundeis UK Ltd recalls Minton & Donello Organic White Orzo because of undeclared wheat (gluten)", ["Minton & Donello Organic White Orzo"], ["Bakery & grains"]],
    ["FSA-PRIN-36-2026", "Waitrose & Partners recall Waitrose & Partners 8 Chocolate Chip Brioche Rolls because they may contain pieces of hard plastic and metal", ["Waitrose & Partners 8 Chocolate Chip Brioche Rolls"], ["Bakery & grains"]],
  ])("%s", (_, title, names, expected) => {
    expect(browseCategories({ title, targets: names.map((name) => product(name)) })).toEqual(expected);
  });

  it("keeps the existing groupings", () => {
    expect(browseCategories({ title: "Example", targets: [product("Alfalfa Sprouts"), product("Milk Chocolate Truffles")] })).toEqual(["Produce", "Snacks & sweets"]);
    for (const name of ["Chicken curry", "Cheese pizza", "Tuna sandwich", "Chicken salad"]) {
      expect(browseCategories({ title: name, targets: [product(name)] })).toEqual(["Prepared foods"]);
    }
    expect(browseCategories({ title: "Mixed food items", targets: [] })).toEqual(["Other foods"]);
  });

  it("does not read the hazard clause of a title as a food", () => {
    expect(browseCategories({ title: "Maker recalls Mystery Selection because of undeclared milk", targets: [product("Mystery Selection")] })).toEqual(["Other foods"]);
    expect(browseCategories({ title: "Update 1: Maker recalls snack boxes due to undeclared milk", targets: [] })).toEqual(["Snacks & sweets"]);
  });

  it("does not let generic words in a title describe a different product", () => {
    expect(browseCategories({ title: "Greencore recalls three pasta products because of Listeria", targets: [product("M&S Super Nutty Wholefood")] })).toEqual(["Other foods"]);
  });

  it("treats 'sweet' and 'baby' as adjectives unless the phrase says otherwise", () => {
    expect(browseCategories({ title: "Recall", targets: [product("Sweet Potato Fries")] })).toEqual(["Produce"]);
    expect(browseCategories({ title: "Recall", targets: [product("Baby Spinach")] })).toEqual(["Produce"]);
    expect(browseCategories({ title: "Recall", targets: [product("Babybel Mini Original")] })).toEqual(["Dairy & eggs"]);
  });

  it("keeps umbrella brands to their product words", () => {
    expect(browseCategories({ title: "Recall", targets: [product("Nutella Croissant")] })).toEqual(["Bakery & grains"]);
  });
});

describe("Open Food Facts categories", () => {
  it("map the taxonomy's broad tags to food types in 'what it is' order", () => {
    expect(foodTypeFromOffTags(["en:snacks", "en:sweet-snacks", "en:biscuits-and-cakes", "en:cakes", "en:doughnuts"])).toBe("Bakery & grains");
    expect(foodTypeFromOffTags(["en:meals", "en:prepared-salads", "en:coleslaw"])).toBe("Prepared foods");
    expect(foodTypeFromOffTags(["en:beverages", "en:plant-based-beverages", "en:cereals-and-their-products"])).toBe("Drinks");
    expect(foodTypeFromOffTags(["en:canned-foods", "en:seafood", "en:fishes"])).toBe("Fish & seafood");
    expect(foodTypeFromOffTags(["en:baby-foods", "en:baby-milks"])).toBeNull();
    expect(foodTypeFromOffTags([])).toBeNull();
  });

  it("only stores tags the mapping uses", () => {
    expect(relevantOffCategoryTags.has("en:snacks")).toBe(true);
    expect(relevantOffCategoryTags.has("en:baby-foods")).toBe(true);
    expect(relevantOffCategoryTags.has("en:doughnuts")).toBe(false);
  });

  it("take priority over the name for the product their barcode belongs to", () => {
    expect(browseCategories({
      title: "Maker recalls products",
      targets: [product("Heatwave Mix", "p0"), gtin("5000328657950", "p0"), product("Nutty Super Wholefood", "p1")],
      productCategoryTags: { "05000328657950": ["en:snacks"] },
    })).toEqual(["Snacks & sweets", "Other foods"]);
  });

  it("describe the whole notice when the barcodes are listed separately (FDA)", () => {
    expect(browseCategories({
      title: "Recall",
      targets: [product("Assorted items, 12 oz", "product-0"), gtin("044000061494", "gtin-0")],
      productCategoryTags: { "00044000061494": ["en:snacks"] },
    })).toEqual(["Snacks & sweets"]);
  });

  it("keeps categories from each separately listed barcode", () => {
    expect(browseCategories({
      title: "Recall",
      targets: [
        product("Assorted items, 12 oz", "product-0"),
        gtin("044000061494", "gtin-0"),
        gtin("05000328657950", "gtin-1"),
      ],
      productCategoryTags: {
        "00044000061494": ["en:snacks"],
        "05000328657950": ["en:beverages"],
      },
    })).toEqual(["Snacks & sweets", "Drinks"]);
  });

  it("keeps named categories when a mixed notice also has loose barcodes", () => {
    expect(browseCategories({
      title: "Recall",
      targets: [
        product("Milk", "product-0"),
        product("Yogurt", "product-1"),
        gtin("044000061494", "gtin-0"),
      ],
      productCategoryTags: { "00044000061494": ["en:snacks"] },
    })).toEqual(["Dairy & eggs", "Snacks & sweets"]);
  });

  it("keeps each barcode category when a notice has no named products", () => {
    expect(browseCategories({
      title: "Recall",
      targets: [gtin("044000061494"), gtin("05000328657950")],
      productCategoryTags: {
        "00044000061494": ["en:snacks"],
        "05000328657950": ["en:beverages"],
      },
    })).toEqual(["Snacks & sweets", "Drinks"]);
  });

  it("fall back to the name rules when the barcode has no categories", () => {
    expect(browseCategories({ title: "Recall", targets: [product("Doritos Chilli Heatwave", "p0"), gtin("5000328657950", "p0")], productCategoryTags: {} })).toEqual(["Snacks & sweets"]);
  });

  it("keeps product names that start with After", () => {
    expect(browseCategories({ title: "After Eight Chocolate Mints", targets: [] })).toEqual(["Snacks & sweets"]);
  });

  it("drops a hazard clause introduced by after", () => {
    expect(browseCategories({ title: "Maker recalls Mystery Selection after undeclared milk was found", targets: [] })).toEqual(["Other foods"]);
  });
});

describe("extra tags", () => {
  it("adds Baby food on top of the food type", () => {
    expect(browseCategories({ title: "Recall", targets: [product("Ella's Kitchen Strawberries + Apples")] })).toEqual(["Produce", "Baby food"]);
    expect(browseCategories({ title: "Recall", targets: [product("Kendamil First Infant Milk")] })).toEqual(["Dairy & eggs", "Baby food"]);
    expect(browseCategories({ title: "ByHeart recalls Whole Nutrition Infant Formula because of possible Clostridium botulinum", targets: [] })).toEqual(["Other foods", "Baby food"]);
    expect(browseCategories({ title: "Recall", targets: [product("Fruit pouch", "p0"), gtin("5000328657950", "p0")], productCategoryTags: { "05000328657950": ["en:baby-foods", "en:fruits"] } })).toEqual(["Produce", "Baby food"]);
  });

  it("adds Pharmaceutical for hidden drugs and medicine residues", () => {
    expect(browseCategories({ title: "Royal Honey VIP recalled because of undeclared tadalafil", targets: [product("Royal Honey VIP")] })).toEqual(["Pantry", "Pharmaceutical"]);
    expect(browseCategories({ title: "Recall", targets: [product("Slimming capsules")], hazard: "Contains undeclared sibutramine" })).toEqual(["Supplements", "Pharmaceutical"]);
    expect(browseCategories({
      title: "Graham’s Family Dairy recalls Graham’s Family Dairy Semi-Skimmed Milk due to the presence of veterinary medicines including antibiotics (penicillin)",
      targets: [product("Graham's Family Dairy Semi-Skimmed Milk")],
    })).toEqual(["Dairy & eggs", "Pharmaceutical"]);
  });

  it("does not add extra tags without a signal", () => {
    expect(browseCategories({ title: "Recall", targets: [product("Baby Corn")], summary: "Raised without antibiotics" })).toEqual(["Produce"]);
  });
});
