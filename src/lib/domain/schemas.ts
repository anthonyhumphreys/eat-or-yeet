import { z } from "zod";

const nullableVisibleString = z.string().trim().max(300).nullable();

export const ProductObservationSchema = z.object({
  productName: nullableVisibleString,
  brand: nullableVisibleString,
  barcode: nullableVisibleString,
  batchCode: nullableVisibleString,
  lotCode: nullableVisibleString,
  producer: nullableVisibleString,
  farmCode: nullableVisibleString,
  countryOfOrigin: nullableVisibleString,
  establishmentNumber: nullableVisibleString,
  approvalNumber: nullableVisibleString.optional().default(null),
  retailer: nullableVisibleString.optional().default(null),
  category: nullableVisibleString.optional().default(null),
  eggMark: z
    .object({
      farmingMethod: nullableVisibleString,
      country: nullableVisibleString,
      producerCode: nullableVisibleString,
    })
    .nullable(),
  dates: z
    .object({
      useBy: nullableVisibleString,
      bestBefore: nullableVisibleString,
      productionDate: nullableVisibleString.optional().default(null),
    })
    .nullable(),
  rawVisibleText: z.array(z.string().trim().max(500)).max(120),
  confidence: z.number().min(0).max(1),
});

export type ProductObservation = z.infer<typeof ProductObservationSchema>;

export const CheckRequestSchema = z.object({
  observation: ProductObservationSchema,
  region: z.enum(["UK", "US"]).default("UK"),
});

export const TargetTypeSchema = z.enum([
  "gtin",
  "product",
  "category",
  "brand",
  "producer",
  "farm",
  "batch",
  "lot",
  "establishment",
  "approval",
  "eggProducerCode",
  "country",
  "retailer",
]);

export type TargetType = z.infer<typeof TargetTypeSchema>;

export const RegionSchema = z.enum(["UK", "US"]);

export function emptyObservation(): ProductObservation {
  return {
    productName: null,
    brand: null,
    barcode: null,
    batchCode: null,
    lotCode: null,
    producer: null,
    farmCode: null,
    countryOfOrigin: null,
    establishmentNumber: null,
    approvalNumber: null,
    retailer: null,
    category: null,
    eggMark: null,
    dates: null,
    rawVisibleText: [],
    confidence: 1,
  };
}
