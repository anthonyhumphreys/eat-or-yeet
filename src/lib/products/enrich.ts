import "server-only";

import { fetchMutation, fetchQuery } from "convex/nextjs";
import { z } from "zod";

import { api } from "@convex/_generated/api";
import type { ProductObservation } from "@/lib/domain/schemas";
import { normaliseGtin } from "@/lib/matching/normalise";

const offSchema = z.object({
  status: z.number(),
  product: z
    .object({
      product_name: z.string().optional(),
      brands: z.string().optional(),
      categories: z.string().optional(),
      countries: z.string().optional(),
      manufacturing_places: z.string().optional(),
    })
    .optional(),
});

type Metadata = z.infer<typeof offSchema>["product"];

async function cachedMetadata(gtin: string): Promise<Metadata | null> {
  const row = await fetchQuery(api.products.getCachedMetadata, { gtin });
  return (row?.metadata as Metadata | undefined) ?? null;
}

async function fetchOpenFoodFacts(gtin: string): Promise<Metadata | null> {
  try {
    const response = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(gtin)}.json?fields=product_name,brands,categories,countries,manufacturing_places`,
      {
        headers: { "User-Agent": "EatOrYeet/1.0 (food safety metadata lookup)" },
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!response.ok) return null;
    const result = offSchema.safeParse(await response.json());
    if (!result.success || result.data.status !== 1 || !result.data.product) return null;
    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
    await fetchMutation(api.products.cacheMetadata, {
      secret: process.env.CONVEX_SERVER_SECRET ?? "",
      gtin,
      metadata: result.data.product,
      expiresAt,
    });
    return result.data.product;
  } catch {
    return null;
  }
}

export async function enrichObservation(observation: ProductObservation): Promise<ProductObservation> {
  if (!observation.barcode) return observation;
  const gtin = normaliseGtin(observation.barcode);
  const local = await fetchQuery(api.products.getByGtin, { gtin });
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
  const metadata = (await cachedMetadata(gtin)) ?? (await fetchOpenFoodFacts(gtin));
  if (!metadata) return { ...observation, barcode: gtin };
  return {
    ...observation,
    barcode: gtin,
    productName: observation.productName ?? metadata.product_name ?? null,
    brand: observation.brand ?? metadata.brands?.split(",")[0]?.trim() ?? null,
    producer: observation.producer ?? metadata.manufacturing_places ?? null,
    countryOfOrigin: observation.countryOfOrigin ?? metadata.countries?.split(",")[0]?.trim() ?? null,
    category: observation.category ?? metadata.categories?.split(",")[0]?.trim() ?? null,
  };
}
