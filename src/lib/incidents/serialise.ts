import type { NormalisedIncident, NormalisedTarget } from "./types";
import { normaliseCode, normaliseGtin, normaliseText } from "../matching/normalise";

function targetValue(target: NormalisedTarget): string {
  if (target.type === "gtin") return normaliseGtin(target.value);
  if (["batch", "lot", "establishment", "approval", "eggProducerCode"].includes(target.type)) return normaliseCode(target.value);
  return normaliseText(target.value);
}

export function serialiseSourceIncident(item: NormalisedIncident) {
  return { ...item, hazard: item.hazard ?? undefined, pathogen: item.pathogen ?? undefined,
    publishedAt: item.publishedAt.getTime(), updatedAt: item.updatedAt.getTime(), startsAt: item.startsAt.getTime(), endsAt: item.endsAt?.getTime(),
    retrievedAt: Date.now(), isDemo: false,
    targets: item.targets.map(target => ({ type: target.type, value: target.value, valueNormalized: targetValue(target), matchType: target.matchType ?? "exact",
      dateFrom: target.dateFrom?.getTime(), dateTo: target.dateTo?.getTime(), notes: target.notes ?? undefined, groupId: target.groupId ?? undefined,
      weight: target.weight ?? 25, confidence: target.confidence ?? 1 })),
  };
}
