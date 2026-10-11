import { describe, expect, it } from "vitest";

import { classifyHazard } from "@/lib/incidents/hazard";

describe("hazard tags", () => {
  it("prefers the named pathogen", () => {
    expect(classifyHazard({ title: "Recall of cheese", hazard: "Possible contamination", pathogen: "Listeria monocytogenes" })).toEqual({ kind: "pathogen", label: "Listeria" });
    expect(classifyHazard({ title: "Wraps recalled because of possible contamination with E.coli (STEC)" })).toEqual({ kind: "pathogen", label: "E. coli" });
  });

  it("names allergens from the hazard statement rather than product names in the title", () => {
    expect(classifyHazard({ title: "Milk chocolate buttons recalled", hazard: "Peanuts\nThis product may contain peanuts making it a possible health risk for anyone with an allergy to peanuts." })).toEqual({ kind: "allergen", label: "Peanuts" });
    expect(classifyHazard({ title: "Biscuits", hazard: "Undeclared Wheat, Soy, Egg and Sesame" })).toEqual({ kind: "allergen", label: "Egg, gluten +2" });
  });

  it("groups foreign bodies, spoilage and other hazards without inventing detail", () => {
    expect(classifyHazard({ title: "Fishcakes recalled because they may contain pieces of plastic or metal" })).toEqual({ kind: "foreign", label: "Plastic" });
    expect(classifyHazard({ title: "Yoghurt recalled", hazard: "Mould has been found in some pots" })).toEqual({ kind: "spoilage", label: "Mould" });
    expect(classifyHazard({ title: "Supplement recalled", hazard: "Undeclared tadalafil" })).toEqual({ kind: "other", label: "Unapproved ingredient" });
    expect(classifyHazard({ title: "Something recalled", hazard: "The products may cause a burning sensation." })).toEqual({ kind: "other", label: "See notice" });
  });

  it("names common medicine recall reasons", () => {
    expect(classifyHazard({ title: "Penicillin V potassium tablets", hazard: "Subpotent drug", superCategories: ["Medical"] })).toEqual({ kind: "other", label: "Wrong strength" });
    expect(classifyHazard({ title: "Example Pharma recall: Infants' Acetaminophen", hazard: "Subpotent drug" })).toEqual({ kind: "other", label: "Wrong strength" });
    expect(classifyHazard({ title: "Example Pharma recall: Metformin", hazard: "CGMP Deviations: NDMA impurity above the acceptable intake limit" })).toEqual({ kind: "other", label: "Impurity" });
    expect(classifyHazard({ title: "Example Pharma recall: Saline Nasal Spray", hazard: "Microbial contamination of non-sterile products" })).toEqual({ kind: "spoilage", label: "Contamination" });
    expect(classifyHazard({ title: "Example Pharma recall: Lidocaine cream", hazard: "Failed child-resistant packaging requirements" })).toEqual({ kind: "other", label: "Not child-resistant" });
    expect(classifyHazard({ title: "Example Pharma recall: Tablets", hazard: "Failed dissolution specifications" })).toEqual({ kind: "other", label: "Quality failure" });
  });

  it("names veterinary medicine residues rather than calling them an allergen", () => {
    expect(classifyHazard({
      title: "Graham’s Family Dairy recalls Graham’s Family Dairy Semi-Skimmed Milk due to the presence of veterinary medicines including antibiotics (penicillin)",
      hazard: "The presence of antibiotic residues may make the product unsafe to consume and is a possible health risk for anyone with an allergy to penicillin.",
    })).toEqual({ kind: "other", label: "Medicine residue" });
    expect(classifyHazard({ title: "Biscuits", hazard: "Undeclared milk, a possible health risk for anyone with an allergy to milk" })).toEqual({ kind: "allergen", label: "Milk" });
  });
});
