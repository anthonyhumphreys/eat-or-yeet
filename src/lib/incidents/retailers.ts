// Works out which shops an official notice names, for the browse feed's
// "Sold at" label and shop filter. It never feeds the safety matcher.
//
// Every tag must come from the official record itself: the reporting
// business, an own-brand product name, or the notice's own words about where
// the product was sold. Titles and brand targets are deliberately ignored.

type Retailer = {
  name: string;
  aliases: string[];
  /**
   * Also an ordinary word, place or brand ("Target a Snack" wraps are a UK
   * brand), so only the business name or "… stores" in the notice counts.
   */
  ambiguous?: boolean;
};

const retailers: Retailer[] = [
  { name: "Tesco", aliases: ["Tesco"] },
  { name: "Waitrose", aliases: ["Waitrose & Partners", "Waitrose and Partners", "Waitrose"] },
  { name: "Sainsbury's", aliases: ["Sainsbury's", "Sainsburys"] },
  { name: "Asda", aliases: ["Asda"] },
  { name: "Aldi", aliases: ["Aldi"] },
  { name: "Lidl", aliases: ["Lidl"] },
  { name: "Morrisons", aliases: ["Morrisons"] },
  { name: "Co-op", aliases: ["Co-operative", "Co-op"] },
  { name: "Marks & Spencer", aliases: ["Marks & Spencer", "Marks and Spencer", "M&S"] },
  { name: "Iceland", aliases: ["Iceland"], ambiguous: true },
  { name: "Ocado", aliases: ["Ocado"] },
  { name: "SPAR", aliases: ["SPAR"] },
  { name: "Walmart", aliases: ["Walmart"] },
  { name: "Target", aliases: ["Target"], ambiguous: true },
  { name: "Kroger", aliases: ["Kroger"] },
  { name: "Trader Joe's", aliases: ["Trader Joe's"] },
  { name: "Costco", aliases: ["Costco"] },
  { name: "Publix", aliases: ["Publix"] },
  { name: "Safeway", aliases: ["Safeway"] },
  { name: "Albertsons", aliases: ["Albertsons"] },
  { name: "Whole Foods Market", aliases: ["Whole Foods Market"] },
];

/** Words that can follow a retailer's name in its legal or regional business name. */
const businessSuffixWords = new Set([
  "ltd", "limited", "plc", "inc", "llc", "co", "corp", "corporation", "company", "group",
  "uk", "gb", "us", "usa", "ni", "northern", "ireland", "scotland", "wales", "england",
  "stores", "store", "supermarkets", "supermarket", "retail", "trading", "wholesale",
  "food", "foods", "and", "partners", "the",
]);

const storeWords = /^\s*(?:stores?|shops?|supermarkets?|branches)\b/i;

/** Lower-case words with apostrophes and hyphens folded, and "&" read as "and". */
function words(value: string): string[] {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[’'‘`-]/g, "")
    .replace(/&/g, " and ")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function startsWithWords(haystack: string[], needle: string[]): boolean {
  return needle.length > 0 && needle.length <= haystack.length && needle.every((word, index) => haystack[index] === word);
}

const aliasWords = retailers.flatMap((retailer) => retailer.aliases.map((alias) => ({ retailer, alias: words(alias) })))
  // Longest first, so "Waitrose & Partners" is tried before "Waitrose".
  .sort((a, b) => b.alias.length - a.alias.length);

/** "Lidl Northern Ireland" or "Sainsbury's Supermarkets Ltd", but not "Iceland Seafood". */
function retailerForBusiness(business: string): string | null {
  const name = words(business);
  if (name[0] === "the") name.shift();
  for (const { retailer, alias } of aliasWords) {
    if (startsWithWords(name, alias) && name.slice(alias.length).every((word) => businessSuffixWords.has(word))) return retailer.name;
  }
  return null;
}

/** Own-brand ranges: "M&S Super Nutty Wholefood", "Inspired to Cook by Sainsbury's Olives". */
function retailerForProduct(product: string): string | null {
  const name = words(product);
  const candidates = aliasWords.filter(({ retailer }) => !retailer.ambiguous);
  // A bare shop name is not a product.
  const prefixed = candidates.find(({ alias }) => startsWithWords(name, alias) && name.length > alias.length);
  if (prefixed) return prefixed.retailer.name;
  for (let index = 0; index < name.length - 1; index += 1) {
    if (name[index] !== "by") continue;
    const match = candidates.find(({ alias }) => startsWithWords(name.slice(index + 1), alias));
    if (match) return match.retailer.name;
  }
  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Matches the alias as written, allowing curly apostrophes and optional hyphens.
// The first letter must be a capital so "target" or "spar" in prose never counts.
const aliasPatterns = retailers.flatMap((retailer) => retailer.aliases.map((alias) => {
  const body = escapeRegExp(alias)
    .replace(/'/g, "['’]?")
    .replace(/-/g, "-?")
    .replace(/ /g, "\\s+");
  const pattern = new RegExp(`(?<![A-Za-z0-9])${body}(?![A-Za-z0-9])`, "gi");
  return { retailer, pattern };
}));

const soldPhrase = /\b(?:sold|distributed)\b/i;
const negated = /\b(?:not|never|isn['’]t|wasn['’]t|aren['’]t|weren['’]t)\s+(?:\w+\s+){0,2}$/i;

/** "Pinch products are sold exclusively through Tesco." / "sold in Asda, Tesco and Iceland stores". */
function retailersInText(text: string): string[] {
  const found: Array<{ name: string; at: number }> = [];
  let offset = 0;
  for (const sentence of text.split(/(?<=[.!?;])\s+|\n+/)) {
    const sold = soldPhrase.exec(sentence);
    const start = offset;
    offset += sentence.length + 1;
    if (!sold || negated.test(sentence.slice(0, sold.index))) continue;
    const rest = sentence.slice(sold.index + sold[0].length);
    for (const { retailer, pattern } of aliasPatterns) {
      for (const match of rest.matchAll(pattern)) {
        if (!/^[A-Z]/.test(match[0])) continue;
        if (retailer.ambiguous && !storeWords.test(rest.slice(match.index + match[0].length))) continue;
        found.push({ name: retailer.name, at: start + sold.index + match.index });
        break;
      }
    }
  }
  // Keep the notice's own order: "Asda, Morrisons and Sainsbury's".
  return found.sort((a, b) => a.at - b.at).map((item) => item.name);
}

export type RetailerSource = {
  targets: Array<{ type: string; value: string }>;
  originalSourceData: unknown;
  summary?: string | null;
  consumerAdvice?: string | null;
};

function sourceRecord(source: unknown): Record<string, unknown> {
  return source && typeof source === "object" ? source as Record<string, unknown> : {};
}

function sourceBusiness(data: Record<string, unknown>): string | null {
  const reporting = data.reportingBusiness;
  if (reporting && typeof reporting === "object") {
    const name = (reporting as Record<string, unknown>).commonName;
    if (typeof name === "string") return name;
  }
  if (typeof data.recalling_firm === "string") return data.recalling_firm;
  if (typeof data.company === "string") return data.company;
  return null;
}

export function namedRetailers(incident: RetailerSource): string[] {
  const data = sourceRecord(incident.originalSourceData);
  const found: string[] = incident.targets.filter((target) => target.type === "retailer").map((target) => target.value.trim()).filter(Boolean);

  const business = sourceBusiness(data);
  const businessRetailer = business ? retailerForBusiness(business) : null;
  if (businessRetailer) found.push(businessRetailer);

  for (const target of incident.targets) {
    if (target.type !== "product") continue;
    const retailer = retailerForProduct(target.value);
    if (retailer) found.push(retailer);
  }

  const texts = [incident.summary, incident.consumerAdvice, data.distribution_pattern];
  for (const text of texts) if (typeof text === "string") found.push(...retailersInText(text));

  return [...new Set(found)];
}
