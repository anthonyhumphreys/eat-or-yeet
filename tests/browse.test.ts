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

  describe("named shops", () => {
    const fsa = (commonName: string, extra: Partial<Parameters<typeof namedRetailers>[0]> = {}) => ({
      title: "Example recall",
      targets: [],
      originalSourceData: { reportingBusiness: { commonName } },
      ...extra,
    });

    it("tags every shop a manufacturer's notice names (FSA-PRIN-48-2026)", () => {
      expect(namedRetailers(fsa("Greencore", {
        targets: [
          { type: "producer", value: "Greencore" },
          { type: "product", value: "Pinch Pan Poppin’ Chicken Pasanda & Nutty Pilau Rice" },
          { type: "product", value: "M&S Super Nutty Wholefood with a Soy & Ginger Dressing" },
          { type: "product", value: "M&S Fresh Collection Pistachio Pesto" },
        ],
        consumerAdvice: "If you have bought the above product, do not eat it. Instead, return it to the store where you purchased it where you will be given a full refund. You do not need your receipt. Pinch products are sold exclusively through Tesco.",
      })).sort()).toEqual(["Marks & Spencer", "Tesco"]);
    });

    it("recognises regional and legal business names for a shop", () => {
      for (const [business, shop] of [
        ["Lidl Northern Ireland", "Lidl"],
        ["Waitrose & Partners", "Waitrose"],
        ["Sainsbury’s Supermarkets Ltd", "Sainsbury's"],
        ["The Co-operative Group", "Co-op"],
        ["Marks and Spencer plc", "Marks & Spencer"],
        ["SPAR UK", "SPAR"],
        ["Iceland Foods Ltd", "Iceland"],
        ["Lidl US Trading", "Lidl"],
      ]) {
        expect(namedRetailers(fsa(business))).toEqual([shop]);
      }
    });

    it("does not treat a business that merely starts with a shop's name as that shop", () => {
      for (const business of ["Iceland Seafood International", "Targeted Nutrition Inc", "Tesco Farm Supplier Co-packers"]) {
        expect(namedRetailers(fsa(business))).toEqual([]);
      }
    });

    it("tags own-brand ranges from the product names", () => {
      for (const [product, shop] of [
        ["Tesco Finest Caesar & Smoked Bacon Coleslaw", "Tesco"],
        ["Inspired to Cook by Sainsbury’s Pitted Black Olives", "Sainsbury's"],
        ["Waitrose & Partners 8 Chocolate Chip Brioche Rolls", "Waitrose"],
        ["Morrisons Maple & Bacon Back of the Net", "Morrisons"],
      ]) {
        expect(namedRetailers(fsa("Some Manufacturer Ltd", { targets: [{ type: "product", value: product }] }))).toEqual([shop]);
      }
    });

    it("tags each shop's own range in a multi-shop notice (FSA-PRIN-38-2026)", () => {
      expect(namedRetailers(fsa("Greencore", { targets: [
        { type: "product", value: "Asda Cheese & Tomato Pasta Salad" },
        { type: "product", value: "Asda Nacho Cheese Pasta Salad" },
        { type: "product", value: "Morrisons Chicken and Bacon Pasta" },
      ] }))).toEqual(["Asda", "Morrisons"]);
    });

    it("ignores product names that only share letters or a word with a shop", () => {
      expect(namedRetailers(fsa("Maker", { targets: [{ type: "product", value: "Sparkling Elderflower" }, { type: "product", value: "Tesco" }] }))).toEqual([]);
      // FSA-PRIN-40-2026: "Target a Snack" is a UK wrap brand, not the US shop.
      expect(namedRetailers(fsa("Summit Foods", { targets: [{ type: "product", value: "Target a Snack Chicken Fajita Wrap" }] }))).toEqual([]);
    });

    it("reads lists of shops from the notice's own words", () => {
      expect(namedRetailers(fsa("Maker", { consumerAdvice: "This product is sold in Asda, Morrisons and Sainsbury's stores." }))).toEqual(["Asda", "Morrisons", "Sainsbury's"]);
      expect(namedRetailers(fsa("Maker", { summary: "The product has been sold at M&S and Co-op." }))).toEqual(["Marks & Spencer", "Co-op"]);
    });

    it("reads US distribution patterns", () => {
      expect(namedRetailers({ title: "Recall", targets: [], originalSourceData: { recalling_firm: "Acme Foods", distribution_pattern: "Distributed to Walmart and Target stores in TX and OK." } })).toEqual(["Walmart", "Target"]);
    });

    it("does not tag a shop from prose that is not about where it was sold", () => {
      expect(namedRetailers(fsa("Maker", { consumerAdvice: "Customer safety is of paramount importance to Marks & Spencer." }))).toEqual([]);
      expect(namedRetailers(fsa("Maker", { consumerAdvice: "This product is not sold at Tesco." }))).toEqual([]);
      expect(namedRetailers(fsa("Maker", { consumerAdvice: "More information is available from Tesco customer services." }))).toEqual([]);
      expect(namedRetailers(fsa("Maker", { summary: "The cod was sold in Iceland and Norway." }))).toEqual([]);
      expect(namedRetailers(fsa("Maker", { summary: "Products were distributed to retail outlets. Our target is to remove them quickly." }))).toEqual([]);
    });
  });
});
