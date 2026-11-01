import { describe, expect, it } from "vitest";
import { recallName } from "@/lib/incidents/product-name";

describe("recallName", () => {
  it.each([
    ["Unilever recalls Pot Noodle Piri Piri Chicken Flavour because of undeclared milk", "Pot Noodle Piri Piri Chicken Flavour", "Unilever"],
    ["Updated: World of Sweets recalls Alyan Dubai Style Crunchy Knafeh and Pistachio Milk Chocolate and Alyan Dubai Style Chocolate Truffles because of contamination with Salmonella", "Alyan Dubai Style Crunchy Knafeh and Pistachio Milk Chocolate and Alyan Dubai Style Chocolate Truffles", "World of Sweets"],
    ["Update 1: Traditional Cheese Company recalls French Bries because of contamination with Listeria monocytogenes", "French Bries", "Traditional Cheese Company"],
    ["Graham’s Family Dairy recalls Graham’s Family Dairy Semi-Skimmed Milk due to the presence of veterinary medicines including antibiotics (penicillin)", "Graham’s Family Dairy Semi-Skimmed Milk", "Graham’s Family Dairy"],
    ["Lucky Saint recalls Hazy IPA products because of risk of cans exploding", "Hazy IPA products", "Lucky Saint"],
    ["Greencore recalls several products due to the presence of Salmonella", "Greencore products", "Greencore"],
    ["Example Foods Recalls Beef Stew Due to Possible Contamination", "Beef Stew", "Example Foods"],
    ["Acme Foods Issues Allergy Alert on Undeclared Peanut in Chocolate Bars", "Chocolate Bars", "Acme Foods"],
    ["Acme Foods recall: Peanut Butter Cups, 12 oz, UPC 012345678905, sold in clear plastic tubs at retail", "Peanut Butter Cups", "Acme Foods"],
  ])("%s", (title, product, company) => {
    expect(recallName({ title })).toEqual({ product, company });
  });

  it("names the product a Food Alert For Action is about", () => {
    expect(recallName({ title: "Food Alert For Action: To food businesses and consumers who have purchased shell eggs originating from Yasensvit Ltd, Ukraine, stamped with the code 3UA1012066" }).product).toBe("Shell eggs");
  });

  it("uses listed products when the title only says several products", () => {
    const targets = [
      { type: "product", value: "Greencore Chicken Sandwich", groupId: "a" },
      { type: "gtin", value: "5000000000005", groupId: "a" },
      { type: "product", value: "Greencore Egg Sandwich", groupId: "b" },
    ];
    expect(recallName({ title: "Greencore recalls several products due to the presence of Salmonella", targets })).toEqual({ company: "Greencore", product: "Greencore Chicken Sandwich and 1 more" });
  });

  it("falls back to the notice title", () => {
    expect(recallName({ title: "Update 2: Advice on raw milk cheese" })).toEqual({ product: "Advice on raw milk cheese" });
  });
});
