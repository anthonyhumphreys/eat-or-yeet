import type { ProductObservation, Region, TargetType } from "@/lib/domain/schemas";
import { isValidGtin } from "@/lib/domain/gtin";
import type {
  DatasetStatus,
  IncidentMatch,
  MatchLevel,
  MatchReason,
  MatchableIncident,
  MatchableTarget,
  Verdict,
  VerdictResult,
} from "@/lib/domain/types";
import { normaliseCode, normaliseGtin, normaliseText } from "@/lib/matching/normalise";

const defaultWeights: Record<TargetType, number> = {
  gtin: 70,
  product: 35,
  category: 12,
  brand: 25,
  producer: 45,
  farm: 45,
  batch: 60,
  lot: 60,
  establishment: 65,
  approval: 65,
  eggProducerCode: 70,
  country: 10,
  retailer: 15,
};

const codeTypes = new Set<TargetType>([
  "gtin",
  "batch",
  "lot",
  "establishment",
  "approval",
  "eggProducerCode",
]);

const identityTypes = new Set<TargetType>(["gtin", "product"]);

const retailerProductPrefixes = [
  "sainsburys taste the difference",
  "sainsburys by sainsburys",
  "sainsbury s taste the difference",
  "sainsbury s by sainsbury s",
  "marks and spencer collection",
  "m s collection",
  "m s food",
  "marks spencer collection",
  "kroger private selection",
  "kroger simple truth",
  "morrisons the best",
  "asda extra special",
  "asda just essentials",
  "tesco everyday value",
  "tesco finest",
  "aldi specially selected",
  "aldi everyday essentials",
  "waitrose duchy",
  "waitrose essential",
  "coop irresistible",
  "lidl deluxe",
  "sainsburys",
  "sainsbury s",
  "morrisons",
  "waitrose",
  "iceland",
  "walmart",
  "target",
  "kroger",
  "costco",
  "tesco",
  "asda",
  "aldi",
  "lidl",
  "marks and spencer",
  "marks spencer",
  "m s",
  "co op",
].map((prefix) => prefix.split(" "));

function valuesFor(observation: ProductObservation, type: TargetType): string[] {
  const values: Partial<Record<TargetType, Array<string | null | undefined>>> = {
    gtin: [observation.barcode],
    product: [observation.productName],
    category: [observation.category],
    brand: [observation.brand],
    producer: [observation.producer],
    farm: [observation.farmCode],
    batch: [observation.batchCode],
    lot: [observation.lotCode],
    establishment: [observation.establishmentNumber],
    approval: [observation.approvalNumber],
    eggProducerCode: [observation.eggMark?.producerCode],
    country: [observation.countryOfOrigin, observation.eggMark?.country],
    retailer: [observation.retailer],
  };
  return (values[type] ?? []).filter((value): value is string => Boolean(value?.trim()));
}

function normaliseForType(type: TargetType, value: string): string {
  if (type === "gtin") return normaliseGtin(value);
  return codeTypes.has(type) ? normaliseCode(value) : normaliseText(value);
}

function words(value: string): string[] {
  return (
    value
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
  );
}

function matchesRetailerPrefixedProduct(targetValue: string, candidate: string): boolean {
  const targetWords = words(targetValue);
  const candidateWords = words(candidate);

  return retailerProductPrefixes.some((prefix) => {
    if (prefix.length >= targetWords.length) return false;
    const hasPrefix = prefix.every((word, index) => targetWords[index] === word);
    const productWords = targetWords.slice(prefix.length);

    // Requiring two exact remaining words avoids turning a short retailer range
    // name such as "Tesco Milk" into a broad match for every milk product.
    return (
      hasPrefix &&
      productWords.length >= 2 &&
      productWords.length === candidateWords.length &&
      productWords.every((word, index) => candidateWords[index] === word)
    );
  });
}

function isInformativeProductName(value: string): boolean {
  const productWords = words(value);
  const letters = productWords.join("").replace(/[^a-z]/g, "");
  return productWords.length >= 2 && letters.length >= 8;
}

function containsProductPhrase(targetValue: string, candidate: string): boolean {
  const targetWords = words(targetValue);
  const candidateWords = words(candidate);
  if (candidateWords.length < 2 || candidateWords.join("").replace(/[^a-z]/g, "").length < 8) return false;
  if (candidateWords.length >= targetWords.length) return false;

  return targetWords.some((_, start) =>
    candidateWords.every((word, index) => targetWords[start + index] === word),
  );
}

function safePatternMatches(pattern: string, candidate: string): boolean {
  if (pattern.length > 160 || candidate.length > 500) return false;
  try {
    return new RegExp(pattern, "i").test(candidate);
  } catch {
    return false;
  }
}

function parseVisibleDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) return null;
  return parsed;
}

function notesHaveDateRestriction(notes: string | null): boolean {
  return Boolean(
    notes &&
      /\b(?:use[ -]?by|best[ -]?before|sell[ -]?by|exp(?:iry|iration|ires?)|production date|pack(?:ed)? date|date range|affected date|BBE)\b/i.test(
        notes,
      ),
  );
}

function targetHasDateRestriction(target: MatchableTarget): boolean {
  return Boolean(target.dateFrom || target.dateTo || notesHaveDateRestriction(target.notes));
}

function dateFits(target: MatchableTarget, observation: ProductObservation): boolean | null {
  const bounds = [target.dateFrom, target.dateTo].filter((bound): bound is Date => bound !== null);
  if (bounds.some((bound) => Number.isNaN(bound.valueOf()))) return null;
  if (target.dateFrom && target.dateTo && target.dateFrom > target.dateTo) return null;

  if (!target.dateFrom && !target.dateTo) {
    return notesHaveDateRestriction(target.notes) ? null : true;
  }

  const visibleValues = [
    observation.dates?.useBy,
    observation.dates?.bestBefore,
    observation.dates?.productionDate,
  ].filter((value): value is string => Boolean(value?.trim()));
  if (visibleValues.length === 0) return null;

  const dates = visibleValues.map(parseVisibleDate);
  if (dates.some((date) => date === null)) return null;

  const fits = dates.map((date) => {
    if (!date) return false;
    return (!target.dateFrom || date >= target.dateFrom) && (!target.dateTo || date <= target.dateTo);
  });

  if (fits.every(Boolean)) return true;
  if (fits.every((fit) => !fit)) return false;
  return null;
}

type TargetMatchKind = "exact" | "pattern" | "retailerSuffix" | "partialProduct";

function targetMatchKind(
  target: MatchableTarget,
  candidate: string,
  normalised: string,
): TargetMatchKind | null {
  if (target.matchType === "pattern") return safePatternMatches(target.value, candidate) ? "pattern" : null;
  if (normalised === target.valueNormalized) return "exact";
  if (target.type !== "product") return null;
  if (matchesRetailerPrefixedProduct(target.value, candidate)) return "retailerSuffix";
  return containsProductPhrase(target.value, candidate) ? "partialProduct" : null;
}

function targetMatch(target: MatchableTarget, observation: ProductObservation) {
  const candidates = valuesFor(observation, target.type);
  for (const candidate of candidates) {
    if (target.type === "gtin" && !isValidGtin(candidate)) continue;
    if (target.type === "product" && !isInformativeProductName(candidate)) continue;

    const normalised = normaliseForType(target.type, candidate);
    if (!normalised) continue;
    const matchKind = targetMatchKind(target, candidate, normalised);
    if (!matchKind) continue;

    const dateMatch = dateFits(target, observation);
    if (dateMatch === false) continue;
    return { candidate, dateMatch, partial: matchKind === "partialProduct" || matchKind === "pattern" };
  }
  return null;
}

function reasonFor(target: MatchableTarget, candidate: string): MatchReason {
  const labels: Record<TargetType, string> = {
    gtin: "Barcode",
    product: "Product name",
    category: "Product category",
    brand: "Brand",
    producer: "Producer",
    farm: "Farm code",
    batch: "Batch",
    lot: "Lot",
    establishment: "Establishment number",
    approval: "Approval number",
    eggProducerCode: "Egg producer code",
    country: "Country of origin",
    retailer: "Retailer",
  };
  return {
    type: target.type,
    evidence: candidate,
    message: `${labels[target.type]} ${candidate} matches the warning${target.notes ? `: ${target.notes}` : "."}`,
  };
}

function hasAssociatedBatchAndIdentity(
  matches: Array<{ target: MatchableTarget; partial?: boolean }>,
): boolean {
  const batches = matches.filter(({ target }) => target.type === "batch" || target.type === "lot");
  const identities = matches.filter(({ target, partial }) => identityTypes.has(target.type) && !partial);

  return batches.some(({ target: batch }) => {
    const groupId = batch.groupId?.trim();
    if (!groupId || batch.confidence < 0.8) return false;
    return identities.some(
      ({ target: identity }) => identity.groupId?.trim() === groupId && identity.confidence >= 0.8,
    );
  });
}

function hasUnresolvedGroupRestriction(
  matches: Array<{ target: MatchableTarget; dateMatch: boolean | null }>,
  allTargets: MatchableTarget[],
): boolean {
  const matchedIds = new Set(matches.map(({ target }) => target.id));
  const identities = matches.filter(({ target }) => identityTypes.has(target.type));

  return identities.some(({ target: identity }) => {
    const groupId = identity.groupId?.trim();
    if (!groupId) return false;

    const groupTargets = allTargets.filter((target) => target.groupId?.trim() === groupId);
    const groupMatches = matches.filter(({ target }) => target.groupId?.trim() === groupId);
    const batchTargets = groupTargets.filter((target) => target.type === "batch" || target.type === "lot");
    if (batchTargets.some((target) => !matchedIds.has(target.id))) return true;

    return groupTargets.some((target) => {
      if (!targetHasDateRestriction(target)) return false;
      const match = groupMatches.find(({ target: matchedTarget }) => matchedTarget.id === target.id);
      return !match || match.dateMatch !== true;
    });
  });
}

function hasUnmatchedSpecificProductScope(
  matches: Array<{ target: MatchableTarget; partial: boolean }>,
  allTargets: MatchableTarget[],
): boolean {
  const broadMatches = matches.filter(({ target }) =>
    ["producer", "farm", "establishment", "approval"].includes(target.type),
  );

  return broadMatches.some(({ target: broadTarget }) => {
    const groupId = broadTarget.groupId?.trim();
    const scopedTargets = groupId
      ? allTargets.filter((target) => target.groupId?.trim() === groupId)
      : allTargets;
    const specificTargets = scopedTargets.filter((target) => target.type === "product" || target.type === "gtin");
    if (specificTargets.length === 0) return false;

    return !matches.some(
      ({ target, partial }) =>
        !partial && specificTargets.some((specificTarget) => specificTarget.id === target.id),
    );
  });
}

function levelFor(
  matches: Array<{ target: MatchableTarget; dateMatch: boolean | null; partial: boolean }>,
  hasUnresolvedRestriction: boolean,
  hasUnmatchedSpecificProduct: boolean,
): MatchLevel {
  const reliableMatches = matches.filter(({ target }) => target.confidence >= 0.8);
  const types = new Set(reliableMatches.map(({ target }) => target.type));
  const hasBatch = types.has("batch") || types.has("lot");
  const batchIdentityIsAssociated = hasAssociatedBatchAndIdentity(reliableMatches);
  const dateIsUncertain = matches.some(({ dateMatch }) => dateMatch === null);

  let level: MatchLevel;
  if (
    types.has("eggProducerCode") ||
    types.has("establishment") ||
    types.has("approval") ||
    (hasBatch && batchIdentityIsAssociated)
  ) {
    level = "confirmed";
  } else if (types.has("gtin") || types.has("producer") || types.has("farm")) {
    level = "probable";
  } else if (types.has("product") || types.has("brand") || hasBatch) {
    level = "possible";
  } else {
    level = "contextual";
  }

  return (dateIsUncertain || hasUnresolvedRestriction || hasUnmatchedSpecificProduct) &&
    (level === "confirmed" || level === "probable")
    ? "possible"
    : level;
}

export function matchIncident(
  observation: ProductObservation,
  incident: MatchableIncident,
): IncidentMatch | null {
  const matches = incident.targets.flatMap((target) => {
    const result = targetMatch(target, observation);
    return result ? [{ target, result }] : [];
  });
  if (matches.length === 0) return null;

  const matchedEvidence = matches.map(({ target, result }) => ({ target, dateMatch: result.dateMatch }));
  const unresolvedGroupRestriction = hasUnresolvedGroupRestriction(matchedEvidence, incident.targets);
  const unmatchedSpecificProduct = hasUnmatchedSpecificProductScope(
    matches.map(({ target, result }) => ({ target, partial: result.partial })),
    incident.targets,
  );
  const level = levelFor(
    matches.map(({ target, result }) => ({
      target,
      dateMatch: result.dateMatch,
      partial: result.partial,
    })),
    unresolvedGroupRestriction,
    unmatchedSpecificProduct,
  );
  const rawScore = matches.reduce(
    (total, { target, result }) =>
      total + (target.weight || defaultWeights[target.type]) * target.confidence * (result.dateMatch === null ? 0.8 : 1),
    0,
  );
  const reasons = matches.map(({ target, result }) => reasonFor(target, result.candidate));
  if (matches.some(({ result }) => result.dateMatch === null)) {
    const hasUnparsedDateRestriction = matches.some(
      ({ target }) => !target.dateFrom && !target.dateTo && notesHaveDateRestriction(target.notes),
    );
    reasons.push({
      type: "date",
      evidence: hasUnparsedDateRestriction ? "Date restriction needs review" : "Date not supplied or ambiguous",
      message: hasUnparsedDateRestriction
        ? "The source describes affected dates in its notes. Compare the package date with the official warning before deciding."
        : "This warning names affected dates. Add a clear use-by, best-before, or production date to confirm the match.",
    });
  }

  return {
    incident,
    level,
    score: Math.min(100, Math.round(rawScore)),
    reasons,
  };
}

export function hasUsefulEvidence(observation: ProductObservation): boolean {
  return isInformativeProductName(observation.productName ?? "");
}

export function verdictFor(level: MatchLevel, usefulEvidence: boolean): Verdict {
  if (!usefulEvidence) return "NO_CLUE";
  if (level === "confirmed" || level === "probable") return "YEET";
  if (level === "possible" || level === "contextual") return "MAYBE_YEET";
  return "EAT";
}

const rank: Record<MatchLevel, number> = {
  confirmed: 5,
  probable: 4,
  possible: 3,
  contextual: 2,
  none: 1,
};

const MAX_RETURNED_MATCHES = 10;

function hasDatasetCoverage(
  incidents: MatchableIncident[],
  regions: Region[],
  datasetStatus?: DatasetStatus,
): boolean {
  if (incidents.length === 0 || regions.length === 0) return false;
  if (datasetStatus?.healthy === false) return false;
  if (!datasetStatus) return true;
  if (!datasetStatus.checkedAt) return false;

  return regions.every((region) => datasetStatus.regions.includes(region));
}

export function runMatcher(
  observation: ProductObservation,
  incidents: MatchableIncident[],
  regions: Region[],
  datasetStatus?: DatasetStatus,
): VerdictResult {
  const rankedMatches = incidents
    .map((incident) => matchIncident(observation, incident))
    .filter((match): match is IncidentMatch => match !== null)
    .sort((a, b) => rank[b.level] - rank[a.level] || b.score - a.score);
  const matchLevel = rankedMatches[0]?.level ?? "none";
  const canConclude = hasDatasetCoverage(incidents, regions, datasetStatus);
  const usefulEvidence = hasUsefulEvidence(observation) || rankedMatches.length > 0;
  const matches = rankedMatches.slice(0, MAX_RETURNED_MATCHES);

  return {
    verdict:
      !canConclude || datasetStatus?.healthy === false
        ? "NO_CLUE"
        : verdictFor(matchLevel, usefulEvidence),
    matchLevel,
    observation,
    matches,
    checkedAt: new Date().toISOString(),
    datasetRegions: regions,
    ...(datasetStatus ? { datasetStatus } : {}),
    ...(rankedMatches.length > MAX_RETURNED_MATCHES ? { matchCount: rankedMatches.length } : {}),
  };
}
