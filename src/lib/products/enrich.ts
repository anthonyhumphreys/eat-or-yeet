import "server-only";

import { fetchMutation, fetchQuery } from "convex/nextjs";
import { z } from "zod";

import { api } from "@convex/_generated/api";
import type { ProductObservation } from "@/lib/domain/schemas";
import { readResponseJson } from "@/lib/http/bounded-response";
import { isValidGtin, normaliseGtin } from "@/lib/matching/normalise";
import { lookupBarcode, OFF_USER_AGENT } from "@/lib/products/open-food-facts";

const offSchema = z.object({
  status: z.number(),
  product: z
    .object({
      product_name: z.string().trim().max(300).optional(),
      brands: z.string().trim().max(300).optional(),
    })
    .optional(),
});

type Metadata = z.infer<typeof offSchema>["product"];

async function fetchOpenFoodFacts(gtin: string, lookupCode: string): Promise<Metadata | null> {
  try {
    const response = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(lookupCode)}.json?fields=product_name,brands`,
      {
        headers: { "User-Agent": OFF_USER_AGENT },
        signal: AbortSignal.timeout(5_000),
        cache: "no-store",
      },
    );
    if (!response.ok && response.status !== 404) return null;
    const result = offSchema.safeParse(await readResponseJson(response, 64 * 1024));
    if (!result.success || ![0, 1].includes(result.data.status)) return null;
    const metadata = result.data.status === 1 ? result.data.product ?? null : null;
    const expiresAt = Date.now() + (metadata ? 7 * 24 : 24) * 60 * 60 * 1000;
    await fetchMutation(api.products.cacheMetadata, {
      secret: process.env.CONVEX_SERVER_SECRET ?? "",
      gtin,
      metadata,
      expiresAt,
    });
    return metadata;
  } catch {
    return null;
  }
}

export async function enrichObservation(observation: ProductObservation): Promise<ProductObservation> {
  if (!observation.barcode || !isValidGtin(observation.barcode)) return observation;
  const gtin = normaliseGtin(observation.barcode);
  const lookup = await fetchQuery(api.products.lookupByGtin, { gtin });
  const local = lookup.product;
  if (local) {
    return {
      ...observation,
      barcode: gtin,
      productName: observation.productName ?? local.name,
      brand: observation.brand ?? local.brand ?? null,
      producer: observation.producer ?? local.producer ?? null,
      countryOfOrigin: observation.countryOfOrigin ?? local.countryOfOrigin ?? null,
      category: observation.category ?? local.category ?? null,
    };
  }
  const cached = lookup.metadata;
  let metadata: Metadata | null;
  if (cached) {
    const parsed = offSchema.shape.product.safeParse(cached.metadata);
    metadata = parsed.success ? parsed.data ?? null : null;
  } else {
    metadata = await fetchOpenFoodFacts(gtin, lookupBarcode(observation.barcode));
  }
  if (!metadata) return { ...observation, barcode: gtin };
  return {
    ...observation,
    barcode: gtin,
    productName: observation.productName ?? (metadata.product_name || null),
    brand: observation.brand ?? (metadata.brands?.split(",")[0]?.trim() || null),
  };
}
