import { z } from "zod";

import { isValidGtin } from "@/lib/domain/gtin";
import { RegionSchema } from "@/lib/domain/schemas";
import { PublicCoverageSchema, PublicWarningSummarySchema } from "../contracts";

const shoppingItemSchema = z.strictObject({
  id: z.string().min(1).max(100),
  name: z.string().trim().min(1).max(200),
  brand: z.string().trim().min(1).max(200).optional(),
  barcode: z.string().trim().max(14).refine(isValidGtin, "Enter a valid GTIN barcode.").optional(),
  bought: z.boolean().default(false),
});

export const ReviewShoppingInputSchema = z.strictObject({
  region: RegionSchema,
  items: z.array(shoppingItemSchema).min(1).max(20),
}).superRefine(({ items }, context) => {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    if (seen.has(item.id)) {
      context.addIssue({ code: "custom", path: ["items", index, "id"], message: "Shopping item IDs must be unique." });
    }
    seen.add(item.id);
  });
});

export const ShoppingReviewStatusSchema = z.enum([
  "related_warnings",
  "no_related_warnings",
  "unable_to_review",
  "skipped",
]);

export const ShoppingRelationshipReasonSchema = z.strictObject({
  type: z.enum(["food_class", "product", "category", "brand", "barcode"]),
  evidence: z.string().min(1).max(200),
});

export const ShoppingRelationshipSchema = z.strictObject({
  association: z.enum(["source_group", "ungrouped"]),
  reasons: z.array(ShoppingRelationshipReasonSchema).min(1),
  packetReviewRequired: z.boolean(),
});

export const ShoppingWarningReferenceSchema = z.strictObject({
  warning: PublicWarningSummarySchema,
  relationships: z.array(ShoppingRelationshipSchema).min(1).max(20),
  relationshipCount: z.number().int().min(1),
  relationshipsComplete: z.boolean(),
});

const ShoppingNextActionSchema = z.discriminatedUnion("tool", [
  z.strictObject({ tool: z.literal("search_warnings"), region: RegionSchema, query: z.string().max(200) }),
  z.strictObject({ tool: z.literal("get_warning"), slug: z.string().min(1).max(240) }),
  z.strictObject({ tool: z.literal("none") }),
]);

export const ShoppingReviewItemSchema = z.strictObject({
  id: z.string().min(1).max(100),
  status: ShoppingReviewStatusSchema,
  qualification: z.string().min(1).max(500),
  relatedWarnings: z.array(ShoppingWarningReferenceSchema).max(5),
  total: z.number().int().nonnegative(),
  nextAction: ShoppingNextActionSchema,
});

export const ReviewShoppingResultSchema = z.strictObject({
  region: RegionSchema,
  qualification: z.string().min(1).max(500),
  coverage: PublicCoverageSchema,
  items: z.array(ShoppingReviewItemSchema).min(1).max(20),
});

export type ReviewShoppingInput = z.infer<typeof ReviewShoppingInputSchema>;
export type ReviewShoppingItem = ReviewShoppingInput["items"][number];
export type ShoppingReviewStatus = z.infer<typeof ShoppingReviewStatusSchema>;
export type ShoppingRelationshipReason = z.infer<typeof ShoppingRelationshipReasonSchema>;
export type ShoppingRelationship = z.infer<typeof ShoppingRelationshipSchema>;
export type ShoppingWarningReference = z.infer<typeof ShoppingWarningReferenceSchema>;
export type ShoppingReviewItemResult = z.infer<typeof ShoppingReviewItemSchema>;
export type ReviewShoppingResult = z.infer<typeof ReviewShoppingResultSchema>;
