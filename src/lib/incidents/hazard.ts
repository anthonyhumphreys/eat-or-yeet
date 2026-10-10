export const hazardKinds = ["pathogen", "allergen", "foreign", "spoilage", "other"] as const;
export type HazardKind = (typeof hazardKinds)[number];

export const hazardKindNames: Record<HazardKind, string> = {
  pathogen: "Food poisoning",
  allergen: "Allergens",
  foreign: "Foreign objects",
  spoilage: "Spoilage & hygiene",
  other: "Other hazards",
};

export type HazardSummary = { kind: HazardKind; label: string };

const pathogens: Array<[RegExp, string]> = [
  [/listeria/i, "Listeria"],
  [/salmonella/i, "Salmonella"],
  [/\be\.?\s?coli\b|escherichia|\bstec\b/i, "E. coli"],
  [/botulin|clostridium/i, "Botulism risk"],
  [/campylobacter/i, "Campylobacter"],
  [/hepatitis/i, "Hepatitis A"],
  [/norovirus/i, "Norovirus"],
  [/cronobacter/i, "Cronobacter"],
  [/cyclospora/i, "Cyclospora"],
  [/bacillus cereus/i, "Bacillus cereus"],
];

const allergens: Array<[RegExp, string]> = [
  [/\bmilk|\bdairy|\blactose|\bwhey|\bcasein/i, "milk"],
  [/\beggs?\b/i, "egg"],
  [/\bpeanuts?\b/i, "peanuts"],
  [/\b(?:tree )?nuts?\b|almond|hazelnut|cashew|walnut|pecan|pistachio|macadamia|brazil nut|coconut/i, "nuts"],
  [/\bgluten|\bwheat|\bbarley|\brye\b|\boats?\b|\bspelt/i, "gluten"],
  [/\bsoy|\bsoya/i, "soya"],
  [/\bsesame/i, "sesame"],
  [/\bmustard/i, "mustard"],
  [/\bcelery|\bceleriac/i, "celery"],
  [/\blupin/i, "lupin"],
  [/sulphite|sulfite|sulphur dioxide/i, "sulphites"],
  [/crustacean|shellfish|shrimp|prawn|crab|lobster/i, "crustaceans"],
  [/mollusc|mussel|oyster|squid/i, "molluscs"],
  [/\bfish\b|anchov|\bcod\b|salmon|tuna/i, "fish"],
];

const allergenSignal = /undeclared|allerg|not (?:mentioned|declared|emphasi[sz]ed)|intoleran|coeliac|celiac|label does not (?:identify|declare)|making (?:it|them) a possible health risk/i;
const foreign: Array<[RegExp, string]> = [
  [/\bglass\b/i, "Glass"],
  [/\bplastic\b/i, "Plastic"],
  [/\bmetal\b/i, "Metal"],
  [/\bstones?\b|\bbone\b|\brubber\b|\bwood(?:en)?\b|foreign (?:object|matter|material|body)|particulate|extraneous/i, "Foreign object"],
];
const spoilage: Array<[RegExp, string]> = [
  [/\bmou?ld/i, "Mould"],
  [/\bpests?\b|insect|rodent|\bmice\b|\bmouse\b|\bbeetle|\blarva/i, "Pests"],
  [/spoil|ferment|over-?pressur|swollen|bloat|exploding|rupture|underprocess|temperature abuse|use-by date|use by date/i, "Spoilage risk"],
];

function capitalise(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Groups an official hazard statement into one plain-language tag. The tag never replaces the source wording. */
export function classifyHazard({ title, hazard, pathogen }: { title: string; hazard?: string | null; pathogen?: string | null }): HazardSummary {
  const text = `${pathogen ?? ""}\n${hazard ?? ""}\n${title}`;
  for (const [pattern, label] of pathogens) if (pattern.test(pathogen ?? "") || pattern.test(text)) return { kind: "pathogen", label };

  // Checked before allergens: these notices warn people allergic to the
  // medicine, but the hazard is the residue itself (FSA-PRIN-37-2026).
  if (/veterinary (?:medicine|drug)|(?:antibiotic|drug|medicine) residue|\bantibiotics? \(|penicillin/i.test(text)) return { kind: "other", label: "Medicine residue" };

  if (allergenSignal.test(text)) {
    // Product names in titles ("Milk Chocolate") would add false allergens, so prefer the hazard statement.
    const scope = hazard || title;
    const found = [...new Set(allergens.filter(([pattern]) => pattern.test(scope)).map(([, name]) => name))];
    if (found.length) return { kind: "allergen", label: capitalise(found.length > 2 ? `${found.slice(0, 2).join(", ")} +${found.length - 2}` : found.join(" & ")) };
    if (/allerg/i.test(text)) return { kind: "allergen", label: "Allergen" };
  }

  for (const [pattern, label] of foreign) if (pattern.test(text) && /contain|piece|fragment|foreign|presence|found|object|particulate|extraneous/i.test(text)) return { kind: "foreign", label };
  if (/foreign bod|pieces of|hard lumps|choking/i.test(text)) return { kind: "foreign", label: "Foreign object" };
  for (const [pattern, label] of spoilage) if (pattern.test(text)) return { kind: "spoilage", label };
  if (/hygiene|pasteuri[sz]|microbiological growth|unable to demonstrate/i.test(text)) return { kind: "spoilage", label: "Hygiene failure" };
  if (/fd&c|colou?r(?:ing)? |(?:yellow|red|blue)\s?#?\s?\d/i.test(text)) return { kind: "other", label: "Undeclared colour" };
  if (/tadalafil|sildenafil|dmaa|phenibut|tianeptine|unapproved|undeclared drug/i.test(text)) return { kind: "other", label: "Unapproved ingredient" };
  if (/\blead\b|cadmium|arsenic|mercury|cesium|radioactiv|chemical|pesticide|ethylene oxide|aflatoxin|mycotoxin|chlorate|alcohol is toxic|cyanide/i.test(text)) return { kind: "other", label: "Chemical contaminant" };
  if (/break apart|pop off|injury|burn risk/i.test(text)) return { kind: "other", label: "Injury risk" };
  // Medicine recalls (FDA drug enforcement) are mostly about quality, not contamination of food.
  if (/microbial contamination|lack of (?:assurance of )?sterility|non-?sterile|sterility assurance/i.test(text)) return { kind: "spoilage", label: "Contamination" };
  if (/sub-?potent|super-?potent|\bpotency\b/i.test(text)) return { kind: "other", label: "Wrong strength" };
  if (/nitrosamine|\bndma\b|\bndea\b|impurit/i.test(text)) return { kind: "other", label: "Impurity" };
  if (/child[- ]resistant/i.test(text)) return { kind: "other", label: "Not child-resistant" };
  if (/\bcgmp\b|good manufacturing practice|dissolution|stability|out of specification/i.test(text)) return { kind: "other", label: "Quality failure" };
  if (/label|packag|translation|english|declared nutrients|sugar intake|vitamin/i.test(text)) return { kind: "other", label: "Labelling error" };
  return { kind: "other", label: "See notice" };
}
