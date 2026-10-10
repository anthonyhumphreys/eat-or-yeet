import { getCheckDataset } from "@/db/queries";
import type { ProductObservation, Region } from "@/lib/domain/schemas";
import type { VerdictResult } from "@/lib/domain/types";
import { runMatcher } from "@/lib/matching/matcher";
import { enrichObservation } from "@/lib/products/enrich";

export type CheckProductResult = {
  result: VerdictResult;
  submittedObservation: ProductObservation;
  enrichedObservation: ProductObservation;
};

export type CheckProductOptions = {
  signal?: AbortSignal;
};

/** Enriches a submitted product and checks it against the selected region's dataset. */
export async function checkProduct(
  observation: ProductObservation,
  region: Region,
  options: CheckProductOptions = {},
): Promise<CheckProductResult> {
  options.signal?.throwIfAborted();
  const [enrichedObservation, dataset] = await Promise.all([
    enrichObservation(observation, { signal: options.signal }),
    getCheckDataset(region),
  ]);
  options.signal?.throwIfAborted();
  const result = runMatcher(enrichedObservation, dataset.incidents, [region], dataset.status);

  return { result, submittedObservation: observation, enrichedObservation };
}
