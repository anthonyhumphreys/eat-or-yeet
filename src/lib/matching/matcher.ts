import type { ProductObservation, TargetType } from "@/lib/domain/schemas";
import type {
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
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

function dateFits(target: MatchableTarget, observation: ProductObservation): boolean | null {
  if (!target.dateFrom && !target.dateTo) return true;
  const dates = [
    parseVisibleDate(observation.dates?.useBy),
    parseVisibleDate(observation.dates?.bestBefore),
    parseVisibleDate(observation.dates?.productionDate),
  ].filter((date): date is Date => date !== null);
  if (dates.length === 0) return null;
  return dates.some(
    (date) => (!target.dateFrom || date >= target.dateFrom) && (!target.dateTo || date <= target.dateTo),
  );
}

function targetMatch(target: MatchableTarget, observation: ProductObservation) {
  const candidates = valuesFor(observation, target.type);
  for (const candidate of candidates) {
    const normalised = normaliseForType(target.type, candidate);
    const matched =
      target.matchType === "exact"
        ? normalised === target.valueNormalized
        : safePatternMatches(target.value, candidate);
    if (!matched) continue;
    const dateMatch = dateFits(target, observation);
    if (dateMatch === false) continue;
    return { candidate, dateMatch };
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

function levelFor(matched: MatchableTarget[]): MatchLevel {
  const types = new Set(matched.map((target) => target.type));
  const hasIdentity = ["gtin", "product", "brand", "producer", "farm"].some((type) => types.has(type as TargetType));
  const hasBatch = types.has("batch") || types.has("lot");

  if (
    types.has("eggProducerCode") ||
    types.has("establishment") ||
    types.has("approval") ||
    (hasBatch && hasIdentity)
  ) {
    return "confirmed";
  }
  if (types.has("gtin") || types.has("producer") || types.has("farm")) return "probable";
  if (types.has("product") || types.has("brand") || hasBatch) return "possible";
  return "contextual";
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

  const matchedTargets = matches.map(({ target }) => target);
  const level = levelFor(matchedTargets);
  const rawScore = matches.reduce(
    (total, { target, result }) =>
      total + (target.weight || defaultWeights[target.type]) * target.confidence * (result.dateMatch === null ? 0.8 : 1),
    0,
  );
  const reasons = matches.map(({ target, result }) => reasonFor(target, result.candidate));
  if (matches.some(({ result }) => result.dateMatch === null)) {
    reasons.push({
      type: "date",
      evidence: "Date not supplied",
      message: "This warning also names affected dates. Add the use-by or best-before date to confirm the match.",
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
  return Boolean(
    observation.barcode ||
      observation.productName ||
      observation.brand ||
      observation.batchCode ||
      observation.lotCode ||
      observation.producer ||
      observation.farmCode ||
      observation.establishmentNumber ||
      observation.approvalNumber ||
      observation.eggMark?.producerCode,
  );
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

export function runMatcher(
  observation: ProductObservation,
  incidents: MatchableIncident[],
  regions: Array<"UK" | "US">,
): VerdictResult {
  const matches = incidents
    .map((incident) => matchIncident(observation, incident))
    .filter((match): match is IncidentMatch => match !== null)
    .sort((a, b) => rank[b.level] - rank[a.level] || b.score - a.score);
  const matchLevel = matches[0]?.level ?? "none";
  return {
    verdict: verdictFor(matchLevel, hasUsefulEvidence(observation) || matches.length > 0),
    matchLevel,
    observation,
    matches,
    checkedAt: new Date().toISOString(),
    datasetRegions: regions,
  };
}
