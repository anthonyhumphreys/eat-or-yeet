import "server-only";

import { getCheckDataset } from "@/db/queries";
import { emptyObservation, type Region } from "@/lib/domain/schemas";
import type { MatchableIncident, MatchableTarget } from "@/lib/domain/types";
import { normaliseGtin, normaliseText } from "@/lib/matching/normalise";
import { matchIncident } from "@/lib/matching/matcher";
import { ReviewShoppingInputSchema, ReviewShoppingResultSchema } from "@/lib/integrations/shopping/contracts";
import type {
  ReviewShoppingInput,
  ReviewShoppingItem,
  ShoppingRelationship,
  ShoppingRelationshipReason,
  ShoppingReviewItemResult,
  ShoppingWarningReference,
} from "@/lib/integrations/shopping/contracts";
import { serializeCoverage, serializeWarningSummary, validatePublicResponse } from "../serialize";

type FoodClass = "milk" | "eggs" | "peanut_nut" | "butter" | "cheese" | "yogurt" | "bread" | "chocolate" | "biscuit";
type TargetGroup = { association: "source_group" | "ungrouped"; targets: MatchableTarget[] };
type RelatedGroup = { relationship: ShoppingRelationship; classes: FoodClass[] };
type ItemReview = Omit<ShoppingReviewItemResult, "id">;

const foodAliases: Array<{ foodClass: FoodClass; aliases: string[] }> = [
  { foodClass: "milk", aliases: ["milk"] },
  { foodClass: "eggs", aliases: ["egg", "eggs"] },
  { foodClass: "peanut_nut", aliases: ["peanut", "peanuts", "nut", "nuts", "almond", "almonds"] },
  { foodClass: "butter", aliases: ["butter"] },
  { foodClass: "cheese", aliases: ["cheese"] },
  { foodClass: "yogurt", aliases: ["yogurt", "yoghurt"] },
  { foodClass: "bread", aliases: ["bread"] },
  { foodClass: "chocolate", aliases: ["chocolate"] },
  { foodClass: "biscuit", aliases: ["biscuit", "biscuits", "cookie", "cookies"] },
];

const hazardTail = /\b(?:undeclared|not declared|may contain|contains|allergen|allergy|incorrectly labelled|mislabelled|label(?:ling)? error)\b/i;
const packetDateNote = /\b(?:use[ -]?by|best[ -]?before|sell[ -]?by|exp(?:iry|iration|ires?)|production date|pack(?:ed)? date|date range|affected date|BBE)\b/i;
const reviewQualification = "This is a discovery review of published warnings in the displayed regional coverage. A missing warning does not establish that food is safe.";
const incompleteCoverageQualification = "Current warning coverage is incomplete for this region. No review or safety conclusion was made.";
const unsupportedItemQualification = "This item name has no supported product alias, so its warning review is incomplete. Search warnings or check the full package and official notice; no safety conclusion was made.";
const noRelatedQualification = "No related warning was found in the current covered dataset using these product aliases and supplied identifiers. This does not establish that the item is safe.";
const relatedQualification = "Related published warnings were found. Review the official notice and package details, including any batch or date restrictions.";
const skippedQualification = "Marked as already bought; no warning review was performed.";

function foodClasses(value: string): FoodClass[] {
  const words = value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const paddedWords = ` ${words} `;
  const classes = new Set(foodAliases
    .filter(({ aliases }) => aliases.some((alias) => paddedWords.includes(` ${normaliseText(alias)} `)))
    .map(({ foodClass }) => foodClass));

  // These compounds name other foods; ingredient-like tokens must not make them
  // candidates for the standalone class (milk chocolate, peanut butter, etc.).
  if (classes.has("milk") && classes.has("chocolate") && /\bmilk chocolate\b/.test(words)) classes.delete("milk");
  if (classes.has("milk") && classes.has("chocolate") && /\bchocolate milk\b/.test(words)) classes.delete("chocolate");
  if (classes.has("eggs") && classes.has("chocolate") && /\bchocolate eggs?\b/.test(words)) classes.delete("eggs");
  if (classes.has("butter") && /\b(?:peanuts?|almonds?|nuts?) butter\b|\bbutter (?:cookies?|biscuits?)\b/.test(words)) {
    classes.delete("butter");
  }
  return [...classes];
}

function productTitleCore(title: string): string {
  const beforeHazard = title.split(hazardTail, 1)[0] ?? title;
  return beforeHazard.split(/[|:–—]/, 1)[0] ?? beforeHazard;
}

function groupsFor(incident: MatchableIncident): TargetGroup[] {
  const groups = new Map<string, TargetGroup>();
  incident.targets.forEach((target, index) => {
    const groupId = target.groupId?.trim();
    const key = groupId ? `source:${groupId}` : `ungrouped:${index}`;
    const group = groups.get(key) ?? { association: groupId ? "source_group" : "ungrouped", targets: [] };
    group.targets.push(target);
    groups.set(key, group);
  });
  return [...groups.values()];
}

function normalizedBarcode(value: string): string {
  return normaliseGtin(value);
}

function hasDateOrBatchRestriction(targets: MatchableTarget[]): boolean {
  return targets.some((target) =>
    target.type === "batch" || target.type === "lot" || target.dateFrom !== null || target.dateTo !== null || packetDateNote.test(target.notes ?? ""),
  );
}

function matchingReason(reason: { type: string; evidence: string }): ShoppingRelationshipReason | null {
  if (reason.type === "gtin") return { type: "barcode", evidence: reason.evidence };
  if (reason.type === "product" || reason.type === "category" || reason.type === "brand") {
    return { type: reason.type, evidence: reason.evidence };
  }
  return null;
}

function uniqueReasons(reasons: ShoppingRelationshipReason[]): ShoppingRelationshipReason[] {
  const seen = new Set<string>();
  return reasons.filter((reason) => {
    const key = `${reason.type}:${normaliseText(reason.evidence)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 8);
}

function targetGroupClasses(
  incident: MatchableIncident,
  group: TargetGroup,
  hasStructuredProductScope: boolean,
): FoodClass[] {
  const structured = group.targets.filter((target) => target.type === "product" || target.type === "category");
  if (structured.length) return [...new Set(structured.flatMap((target) => foodClasses(target.value)))];
  if (hasStructuredProductScope) return [];
  return foodClasses(productTitleCore(incident.title));
}

function identifierTargetsMatch(item: ReviewShoppingItem, group: TargetGroup, incident: MatchableIncident): boolean {
  const incidentGroups = groupsFor(incident);
  const allBrandTargets = incidentGroups.flatMap(({ targets }) => targets.filter((target) => target.type === "brand"));
  const allBarcodeTargets = incidentGroups.flatMap(({ targets }) => targets.filter((target) => target.type === "gtin"));
  const groupBrands = group.targets.filter((target) => target.type === "brand");
  const groupBarcodes = group.targets.filter((target) => target.type === "gtin");

  if (item.brand && groupBrands.length && !groupBrands.some((target) => normaliseText(target.value) === normaliseText(item.brand))) return false;
  if (item.barcode && groupBarcodes.length && !groupBarcodes.some((target) => normalizedBarcode(target.value) === normalizedBarcode(item.barcode ?? ""))) return false;

  // If the warning provides both identifiers and the item supplies both, require
  // the association to be present together in this group. Never bridge groups.
  if (item.brand && item.barcode && allBrandTargets.length && allBarcodeTargets.length) {
    if (!groupBrands.length || !groupBarcodes.length) return false;
    if (!groupBrands.some((target) => normaliseText(target.value) === normaliseText(item.brand))) return false;
    if (!groupBarcodes.some((target) => normalizedBarcode(target.value) === normalizedBarcode(item.barcode ?? ""))) return false;
  }
  return true;
}

function findRelatedGroups(item: ReviewShoppingItem, incidents: MatchableIncident[]): Map<string, RelatedGroup[]> {
  const itemClasses = foodClasses(item.name);
  const observation = {
    ...emptyObservation(),
    productName: item.name,
    brand: item.brand ?? null,
    barcode: item.barcode ?? null,
  };
  const related = new Map<string, RelatedGroup[]>();

  for (const incident of incidents) {
    const targetGroups = groupsFor(incident);
    const hasStructuredProductScope = incident.targets.some((target) => target.type === "product" || target.type === "category");
    const matchedGroups: RelatedGroup[] = [];

    for (const group of targetGroups) {
      if (!identifierTargetsMatch(item, group, incident)) continue;
      const groupClasses = targetGroupClasses(incident, group, hasStructuredProductScope);
      const sharedClasses = itemClasses.filter((foodClass) => groupClasses.includes(foodClass));
      if (!sharedClasses.length) continue;

      const targets = group.targets.filter((target) => ["product", "category", "brand", "gtin"].includes(target.type));
      if (!targets.length) continue;
      const matcherReasons: ShoppingRelationshipReason[] = [];
      for (const foodClass of sharedClasses) {
        const match = matchIncident({ ...observation, category: foodClass }, { ...incident, targets });
        if (!match) continue;
        for (const reason of match.reasons) {
          const mapped = matchingReason(reason);
          if (mapped) matcherReasons.push(mapped);
        }
      }

      // The shared alias is the discovery relationship; matcher evidence adds
      // exact product, category, brand, or barcode detail from this same group.
      const reasons = uniqueReasons([
        ...sharedClasses.map((foodClass) => ({ type: "food_class" as const, evidence: foodClass })),
        ...matcherReasons,
      ]);
      matchedGroups.push({
        classes: sharedClasses,
        relationship: {
          association: group.association,
          reasons,
          packetReviewRequired: hasDateOrBatchRestriction(group.targets),
        },
      });
    }

    if (matchedGroups.length) related.set(incident.id, matchedGroups);
  }
  return related;
}

function nextAction(region: Region, name: string, warnings: ShoppingWarningReference[], total: number, status: ShoppingReviewItemResult["status"]) {
  if (status === "skipped") return { tool: "none" as const };
  if (total > warnings.length || status === "unable_to_review" || warnings.length === 0) {
    return { tool: "search_warnings" as const, region, query: name };
  }
  return { tool: "get_warning" as const, slug: warnings[0].warning.slug };
}

function reviewOne(item: ReviewShoppingItem, region: Region, incidents: MatchableIncident[]): ItemReview {
  if (item.bought) {
    return { status: "skipped", qualification: skippedQualification, relatedWarnings: [], total: 0, nextAction: { tool: "none" } };
  }
  const itemClasses = foodClasses(item.name);
  if (!itemClasses.length) {
    return { status: "unable_to_review", qualification: unsupportedItemQualification, relatedWarnings: [], total: 0, nextAction: { tool: "search_warnings", region, query: item.name } };
  }

  const related = findRelatedGroups(item, incidents.filter((incident) => incident.region === region));
  const byIncidentId = new Map(incidents.map((incident) => [incident.id, incident]));
  const all = [...related.entries()]
    .map(([id, groups]) => {
      const incident = byIncidentId.get(id);
      if (!incident) return null;
      return {
        warning: serializeWarningSummary(incident),
        relationships: groups.slice(0, 20).map(({ relationship }) => relationship),
        relationshipCount: groups.length,
        relationshipsComplete: groups.length <= 20,
      } satisfies ShoppingWarningReference;
    })
    .filter((item): item is ShoppingWarningReference => item !== null)
    .sort((a, b) => a.warning.updatedAt.localeCompare(b.warning.updatedAt) * -1 || a.warning.slug.localeCompare(b.warning.slug));
  const relatedWarnings = all.slice(0, 5);
  const status = all.length ? "related_warnings" : "no_related_warnings";
  const result: ItemReview = {
    status,
    qualification: all.length ? relatedQualification : noRelatedQualification,
    relatedWarnings,
    total: all.length,
    nextAction: nextAction(region, item.name, relatedWarnings, all.length, status),
  };
  return result;
}

function dedupeKey(item: ReviewShoppingItem): string {
  return JSON.stringify([
    normaliseText(item.name),
    foodClasses(item.name).sort(),
    normaliseText(item.brand ?? ""),
    normalizedBarcode(item.barcode ?? ""),
  ]);
}

export async function reviewShoppingItems(
  input: ReviewShoppingInput,
  options: { signal?: AbortSignal } = {},
) {
  const parsed = ReviewShoppingInputSchema.parse(input);
  options.signal?.throwIfAborted();
  const dataset = await getCheckDataset(parsed.region);
  options.signal?.throwIfAborted();
  const coverage = serializeCoverage(dataset.status, parsed.region);
  const reviewed = new Map<string, ItemReview>();
  const results: ShoppingReviewItemResult[] = [];

  for (const item of parsed.items) {
    options.signal?.throwIfAborted();
    let review: ItemReview;
    if (item.bought) {
      review = reviewOne(item, parsed.region, []);
    } else if (!coverage.healthy) {
      review = {
        status: "unable_to_review",
        qualification: incompleteCoverageQualification,
        relatedWarnings: [],
        total: 0,
        nextAction: { tool: "search_warnings", region: parsed.region, query: item.name },
      };
    } else if (!foodClasses(item.name).length) {
      review = reviewOne(item, parsed.region, []);
    } else {
      const key = dedupeKey(item);
      const cached = reviewed.get(key);
      if (cached) review = cached;
      else {
        review = reviewOne(item, parsed.region, dataset.incidents);
        reviewed.set(key, review);
      }
    }
    results.push({ id: item.id, ...review });
  }

  return validatePublicResponse(ReviewShoppingResultSchema, {
    region: parsed.region,
    qualification: reviewQualification,
    coverage,
    items: results,
  });
}
