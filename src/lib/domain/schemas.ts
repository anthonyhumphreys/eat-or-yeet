import { z } from "zod";
import { isValidGtin } from "@/lib/domain/gtin";

const nullableVisibleString = z.string().trim().max(300).nullable();

const barcodeSchema = nullableVisibleString.refine(
  (value) => value === null || value === "" || isValidGtin(value),
  "Enter a valid 8, 12, 13, or 14 digit barcode.",
);

export const ProductObservationSchema = z.object({
  productName: nullableVisibleString,
  brand: nullableVisibleString,
  barcode: barcodeSchema,
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
export type Region = z.infer<typeof RegionSchema>;

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
  };
}
