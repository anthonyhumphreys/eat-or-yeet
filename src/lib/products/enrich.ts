import "server-only";

import { fetchMutation, fetchQuery } from "convex/nextjs";
import { z } from "zod";

import { api } from "@convex/_generated/api";
import type { ProductObservation } from "@/lib/domain/schemas";
import { readResponseJson } from "@/lib/http/bounded-response";
import { isValidGtin, normaliseGtin } from "@/lib/matching/normalise";

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

function lookupBarcode(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 14) return digits;
  for (const length of [8, 12, 13]) {
    const prefixLength = 14 - length;
    if (digits.startsWith("0".repeat(prefixLength))) return digits.slice(prefixLength);
  }
  return digits;
}

async function cachedMetadata(gtin: string): Promise<{ hit: boolean; metadata: Metadata | null }> {
  const row = await fetchQuery(api.products.getCachedMetadata, { gtin });
  if (!row) return { hit: false, metadata: null };
  const parsed = offSchema.shape.product.safeParse(row.metadata);
  return { hit: true, metadata: parsed.success ? parsed.data ?? null : null };
}

async function fetchOpenFoodFacts(gtin: string, lookupCode: string): Promise<Metadata | null> {
  try {
    const response = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(lookupCode)}.json?fields=product_name,brands`,
      {
        headers: { "User-Agent": "EatOrYeet/1.0 (food safety metadata lookup)" },
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
  const cached = await cachedMetadata(gtin);
  const metadata = cached.hit ? cached.metadata : await fetchOpenFoodFacts(gtin, lookupBarcode(observation.barcode));
  if (!metadata) return { ...observation, barcode: gtin };
  return {
    ...observation,
    barcode: gtin,
    productName: observation.productName ?? (metadata.product_name || null),
    brand: observation.brand ?? (metadata.brands?.split(",")[0]?.trim() || null),
  };
}
