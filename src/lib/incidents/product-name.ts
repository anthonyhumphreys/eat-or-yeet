/**
 * Short product names for recall headlines. Official notice titles read like
 * "Unilever recalls Pot Noodle Piri Piri Chicken Flavour because of undeclared milk";
 * lists and page headers show "Pot Noodle Piri Piri Chicken Flavour", with the company beside it.
 */
export type RecallName = {
  /** What was recalled, e.g. "Pot Noodle Piri Piri Chicken Flavour". Falls back to the notice title. */
  product: string;
  /** Who recalled it, when the notice names them. */
  company?: string;
  /** Why, in the notice's words, e.g. "Undeclared milk". */
  reason?: string;
};

type NameTarget = { type: string; value: string; groupId?: string | null };

const MAX_LENGTH = 120;
// "Update 1:", "Updated:", "Update 1 –".
const updatePrefix = /^\s*update(?:d)?\s*\d*\s*[:–—-]\s*/i;
// "because of undeclared milk", "due to the presence of Salmonella", "after Listeria was found".
const reasonClause = /\s+(?:because|due to|as a precaution|following|over (?:concerns|fears)|for (?:possible|potential|undeclared)|after\s+(?=(?:undeclared|unapproved|possible|potential|suspected|presence|detection|discovery|contamination|cross[- ]contamination|salmonella|listeria|e\.?\s*coli|botulism|allergen)\b))\b.*$/i;
const recallVerb = /^(.+?)\s+(?:voluntarily\s+|is\s+)?(?:recalls|recall|recalling|has recalled|recalled|withdraws|is withdrawing|updates its recall of)\s+(.+)$/i;
// "various", "several", "three", "specific batches of" say how many, not what.
const quantity = /^(?:(?:several|various|multiple|some|certain|selected|specific batches of|batches of|a number of|a range of|two|three|four|five|six|seven|eight|nine|ten)\s+)+/i;
// FDA announcements: "Acme Foods Issues Allergy Alert on Undeclared Peanut in Chocolate Bars".
const issuesAlert = /^(.+?)\s+issues\s+(?:an?\s+)?(?:voluntary\s+|nationwide\s+|precautionary\s+)*(?:allergy alert|alert|recall)\s+(?:of|on|for)\s+(.+)$/i;
const genericProducts = /^(?:a\s+)?(?:several|various|multiple|some|certain|a number of|a range of|range of|selected)?\s*(?:of\s+its\s+)?products?$/i;

const reasonStart = /\s+(?:because(?:\s+of)?|due to|as a precaution(?: because(?: of)?| due to)?|following|over (?:concerns|fears)(?: (?:about|that|of))?|after)\s+(.+)$/i;

/** "because of undeclared milk" → "Undeclared milk"; "due to the presence of Salmonella" → "Salmonella". */
function reasonFrom(text: string) {
  if (!reasonClause.test(text)) return undefined;
  const match = reasonStart.exec(text);
  if (!match) return undefined;
  const reason = tidy(match[1].replace(/^(?:the\s+)?(?:possible\s+|potential\s+)?presence of\s+/i, "").replace(/^(?:a|an|the)\s+/i, ""));
  return reason ? capitalise(reason) : undefined;
}

function tidy(text: string) {
  return text.replace(/\s+/g, " ").replace(/^[\s,;:–-]+|[\s,;:.–-]+$/g, "").trim();
}

function capitalise(text: string) {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

/** Long product descriptions (mostly FDA) keep their first clause, then a word-boundary cut. */
function shorten(text: string) {
  let name = tidy(text);
  if (name.length > 60) {
    const first = tidy(name.split(/[;,(]|\s[–-]\s/)[0]);
    if (first.length >= 3) name = first;
  }
  if (name.length <= MAX_LENGTH) return name;
  const cut = name.slice(0, MAX_LENGTH);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 40)).replace(/[\s,;:–-]+$/, "")}…`;
}

function fromTitle(title: string): RecallName | null {
  const text = tidy(title.replace(updatePrefix, ""));

  // openFDA and FDA announcement imports: "Acme Foods recall: Peanut Butter Cups, 12 oz".
  const colon = /^(.+?)\s+recall:\s+(.+)$/i.exec(text);
  if (colon) return { company: tidy(colon[1]), product: shorten(colon[2]) };

  // FSA: "Food Alert For Action: To food businesses and consumers who have purchased shell eggs originating from…".
  const purchased = /\bwho have (?:purchased|bought)\s+(.+?)(?:\s+(?:originating|produced|supplied|sold|imported|from|stamped|with)\b|[,;]|$)/i.exec(text);
  if (purchased) return { product: capitalise(shorten(purchased[1])) };

  const issued = issuesAlert.exec(text);
  if (issued) {
    const subject = tidy(issued[2].replace(reasonClause, ""));
    // "Undeclared Milk in Chocolate Bars" names the hazard first and the product after "in".
    const product = /^(?:undeclared|possible|potential)\b.*?\s+in\s+(.+)$/i.exec(subject)?.[1] ?? subject;
    return { company: tidy(issued[1]), product: shorten(product), reason: reasonFrom(issued[2]) ?? (/^(undeclared\s+.+?)\s+in\s+/i.exec(subject)?.[1] ? capitalise(/^(undeclared\s+.+?)\s+in\s+/i.exec(subject)![1]) : undefined) };
  }

  const recalled = recallVerb.exec(text);
  if (recalled) {
    const company = tidy(recalled[1]);
    const reason = reasonFrom(recalled[2]);
    const named = tidy(recalled[2].replace(reasonClause, "").replace(/^(?:the|its)\s+/i, ""));
    const product = genericProducts.test(named) ? named : tidy(named.replace(quantity, "")) || named;
    if (!product) return null;
    if (genericProducts.test(product)) return { company, product: `${company} products`, reason };
    return { company, product: shorten(product), reason };
  }
  return null;
}

/** Product names from the notice's structured targets, one per product group. */
function targetProducts(targets: readonly NameTarget[]) {
  const names = new Map<string, string>();
  for (const target of targets) {
    if (target.type !== "product") continue;
    const key = target.groupId ?? target.value;
    if (!names.has(key)) names.set(key, tidy(target.value));
  }
  return [...new Set(names.values())].filter(Boolean);
}

/**
 * The name to lead with in recall lists and on recall pages. Uses the notice title, and on
 * recall pages the listed products when the title only says "several products" or has no product.
 */
export function recallName({ title, targets }: { title: string; targets?: readonly NameTarget[] }): RecallName {
  const parsed = fromTitle(title);
  const generic = !parsed || (parsed.company !== undefined && parsed.product === `${parsed.company} products`);
  if (generic && targets?.length) {
    const products = targetProducts(targets);
    if (products.length === 1) return { company: parsed?.company, reason: parsed?.reason, product: capitalise(shorten(products[0])) };
    if (products.length > 1) {
      const first = shorten(products[0]);
      return { company: parsed?.company, reason: parsed?.reason, product: capitalise(`${first} and ${products.length - 1} more`) };
    }
  }
  const name = parsed ?? { product: tidy(title.replace(updatePrefix, "")) || title };
  return { ...name, product: capitalise(name.product) };
}

type HazardTag = { kind: "pathogen" | "allergen" | "foreign" | "spoilage" | "other"; label: string };

const properNoun = /^(?:salmonella|listeria|e\.?\s*coli|campylobacter|cronobacter|cyclospora|bacillus|clostridium|hepatitis|norovirus|stec|fd&c)\b/i;
const sentence = /\b(?:are|is|was|were|has|have|had|may|might|could|can|did|does|do)\b/i;

function lowerFirst(text: string) {
  return properNoun.test(text) ? text : text[0].toLowerCase() + text.slice(1);
}

/** What the hazard tag means in words, for notices whose titles give no reason. */
function hazardWords(hazard: HazardTag) {
  if (hazard.kind === "pathogen") return hazard.label === "Botulism risk" ? "botulism risk" : hazard.label;
  if (hazard.kind === "allergen") {
    if (hazard.label === "Undeclared allergen" || hazard.label === "Allergen") return "an undeclared allergen";
    const more = /\s*\+(\d+)(?: more)?$/.exec(hazard.label);
    const names = hazard.label.replace(/\s*\+\d+(?: more)?$/, "").toLowerCase();
    return more ? `undeclared ${names} and ${more[1]} more ${more[1] === "1" ? "allergen" : "allergens"}` : `undeclared ${names}`;
  }
  if (hazard.label === "See notice") return null;
  return hazard.label.toLowerCase();
}

/**
 * Why it was recalled, as a short phrase for list rows: "Recalled for undeclared milk",
 * "Recalled because allergens are not declared in English on the label".
 */
export function recallReason(name: RecallName, hazard: HazardTag) {
  // "Undeclared allergens" says less than the tag, which names them.
  const vague = name.reason && /^undeclared allergens?$/i.test(name.reason) && hazard.kind === "allergen" && hazard.label !== "Undeclared allergen" && hazard.label !== "Allergen";
  if (name.reason && !vague) return sentence.test(name.reason) ? `Recalled because ${lowerFirst(name.reason)}` : `Recalled for ${lowerFirst(name.reason)}`;
  const words = hazardWords(hazard);
  return words ? `Recalled for ${words}` : "Recalled, see the notice for why";
}
