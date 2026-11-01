import { describe, expect, it } from "vitest";
import { recallName, recallReason } from "@/lib/incidents/product-name";

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
    expect(recallName({ title })).toMatchObject({ product, company });
  });

  it.each([
    ["Unilever recalls Pot Noodle Piri Piri Chicken Flavour because of undeclared milk", "Undeclared milk"],
    ["Greencore recalls several products due to the presence of Salmonella", "Salmonella"],
    ["Lucky Saint recalls Hazy IPA products because of risk of cans exploding", "Risk of cans exploding"],
    ["Acme Foods Issues Allergy Alert on Undeclared Peanut in Chocolate Bars", "Undeclared Peanut"],
  ])("gives the reason for %s", (title, reason) => {
    expect(recallName({ title }).reason).toBe(reason);
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
    expect(recallName({ title: "Greencore recalls several products due to the presence of Salmonella", targets })).toEqual({ company: "Greencore", reason: "Salmonella", product: "Greencore Chicken Sandwich and 1 more" });
  });

  it("falls back to the notice title", () => {
    expect(recallName({ title: "Update 2: Advice on raw milk cheese" })).toEqual({ product: "Advice on raw milk cheese" });
  });
});

describe("recallReason", () => {
  const allergen = { kind: "allergen" as const, label: "Milk, egg +1" };
  it.each([
    ["Unilever recalls Pot Noodle Piri Piri Chicken Flavour because of undeclared milk", "Recalled for undeclared milk"],
    ["Greencore recalls several products due to the presence of Salmonella", "Recalled for Salmonella"],
    ["Lambertz recalls Lambertz Mini Spekulatius because allergens are not declared in English on the label", "Recalled because allergens are not declared in English on the label"],
    ["Lucky Saint recalls Hazy IPA products because of risk of cans exploding", "Recalled for risk of cans exploding"],
  ])("%s", (title, reason) => {
    expect(recallReason(recallName({ title }), allergen)).toBe(reason);
  });

  it("explains the hazard tag when the title gives no reason", () => {
    const name = recallName({ title: "Acme Snacks recall: Peanut Butter Pretzel Bites" });
    expect(recallReason(name, allergen)).toBe("Recalled for undeclared milk, egg and 1 more allergen");
    expect(recallReason(name, { kind: "pathogen", label: "Listeria" })).toBe("Recalled for Listeria");
    expect(recallReason(name, { kind: "foreign", label: "Glass" })).toBe("Recalled for glass");
    expect(recallReason(name, { kind: "other", label: "See notice" })).toBe("Recalled, see the notice for why");
  });
});

describe("real UK notice titles", () => {
  it.each([
    ["Update 1 – PepsiCo updates its recall of Walkers Variety Snacks Sharing Box because of undeclared wheat (gluten)", "Walkers Variety Snacks Sharing Box", "PepsiCo"],
    ["SuperValu and Centra recall salmon and prawn cocktail products because of contamination with Listeria monocytogenes", "Salmon and prawn cocktail products", "SuperValu and Centra"],
    ["Arla Foods Ltd recalls various Arla Protein Pudding products because they may contain glass", "Arla Protein Pudding products", "Arla Foods Ltd"],
    ["Greencore recalls three pasta products because of possible contamination with Listeria monocytogenes", "Pasta products", "Greencore"],
    ["Capri Sun UK recalls specific batches of Capri-Sun Orange 10 pack because they contain some cartons of Capri-Sun Zero which were filled with the full sugar variety", "Capri-Sun Orange 10 pack", "Capri Sun UK"],
    ["Lidl Northern Ireland recalls 1001 Delights Dubai Style Pistachio Ice Cream because of undeclared cashew (nuts)", "1001 Delights Dubai Style Pistachio Ice Cream", "Lidl Northern Ireland"],
    ["Summit Foods is recalling various products because of possible contamination with Shiga-toxin producing E. coli (STEC)", "Summit Foods products", "Summit Foods"],
  ])("%s", (title, product, company) => {
    expect(recallName({ title })).toMatchObject({ product, company });
  });

  it("names the allergens when the notice only says undeclared allergens", () => {
    const name = recallName({ title: "Full On Flapjacks recalls various Flapjack products because of undeclared allergens" });
    expect(recallReason(name, { kind: "allergen", label: "Nuts, gluten & soya" })).toBe("Recalled for undeclared nuts, gluten & soya");
    expect(recallReason(name, { kind: "allergen", label: "Undeclared allergen" })).toBe("Recalled for undeclared allergens");
  });
});

it("keeps titles like 'Fixture recall 12' whole", () => {
  expect(recallName({ title: "Fixture recall 12" })).toEqual({ product: "Fixture recall 12" });
});
