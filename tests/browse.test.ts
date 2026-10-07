import { describe, expect, it } from "vitest";

import { browseCategories, namedRetailers } from "@/lib/incidents/browse";

describe("incident browsing", () => {
  it("places one notice under each affected food type", () => {
    const incident = {
      title: "Example mixed recall",
      targets: [
        { type: "product", value: "Alfalfa Sprouts" },
        { type: "product", value: "Milk Chocolate Truffles" },
      ],
      originalSourceData: {},
    };
    expect(browseCategories(incident)).toEqual(["Produce", "Snacks & sweets"]);
  });

  it("uses an honest fallback when product names do not identify a food type", () => {
    expect(browseCategories({ title: "Mixed food items", targets: [], originalSourceData: {} })).toEqual(["Other foods"]);
  });

  it("groups complete meals before their individual ingredients", () => {
    for (const product of ["Chicken curry", "Cheese pizza", "Tuna sandwich", "Chicken salad"]) {
      expect(browseCategories({ title: product, targets: [{ type: "product", value: product }], originalSourceData: {} })).toEqual(["Prepared foods"]);
    }
  });

  it("recognises food names from current official notices without treating hazard text as a category", () => {
    const products = [
      ["Outshine Fruit Bars Grape", "Snacks & sweets"],
      ["Waitrose Essential Pitted Black Olives", "Pantry"],
      ["Alfalfa Sprouts", "Produce"],
      ["Herbal Supplement", "Supplements"],
    ] as const;
    for (const [product, expected] of products) {
      expect(browseCategories({ title: `Recall due to Salmonella: ${product}`, targets: [{ type: "product", value: product }], originalSourceData: {} })).toEqual([expected]);
    }
  });

  it("names a store only when the official record identifies the business", () => {
    expect(namedRetailers({ title: "Oat drink recall", targets: [], originalSourceData: { reportingBusiness: { commonName: "Waitrose" } } })).toEqual(["Waitrose"]);
    expect(namedRetailers({ title: "Waitrose oat drink recall", targets: [{ type: "brand", value: "Waitrose" }], originalSourceData: { reportingBusiness: { commonName: "Unrelated manufacturer" } } })).toEqual([]);
  });

  it("retains explicit retailer targets without repeating a named business", () => {
    expect(namedRetailers({ title: "Example", targets: [{ type: "retailer", value: "Tesco" }], originalSourceData: { reportingBusiness: { commonName: "Tesco" } } })).toEqual(["Tesco"]);
  });
});
