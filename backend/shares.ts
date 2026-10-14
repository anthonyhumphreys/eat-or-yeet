import { v } from "./values";

import { mutation, query } from "./operations";
import { requireServerSecret } from "./security";

const shareReason = "This result reflects the official food safety data available at the time of the check.";
const region = v.union(v.literal("UK"), v.literal("US"));

export const get = query({
  args: { shareId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("publicShares").withIndex("by_shareId", (q) => q.eq("shareId", args.shareId)).unique();
    const hasSafeMetadata =
      row?.checkedAt !== undefined &&
      row.datasetRegions !== undefined &&
      row.datasetRegions.length > 0 &&
      row.reason === shareReason;
    return row && row.expiresAt > Date.now() && hasSafeMetadata ? row : null;
  },
});

export const create = mutation({
  args: {
    secret: v.string(),
    shareId: v.string(),
    verdict: v.string(),
    matchLevel: v.string(),
    productName: v.optional(v.string()),
    reason: v.string(),
    incidentSlug: v.optional(v.string()),
    checkedAt: v.number(),
    datasetRegions: v.array(region),
    sourceScope: v.optional(v.string()),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.secret);
    if (args.reason !== shareReason) throw new Error("Invalid public share reason");
    if (args.datasetRegions.length === 0 || new Set(args.datasetRegions).size !== args.datasetRegions.length) {
      throw new Error("Invalid public share dataset regions");
    }
    const now = Date.now();
    if (
      !Number.isSafeInteger(args.checkedAt) ||
      args.checkedAt > now ||
      args.expiresAt <= now ||
      args.expiresAt > now + 24 * 60 * 60 * 1000
    ) {
      throw new Error("Invalid public share lifetime");
    }
    await ctx.db.insert("publicShares", {
      shareId: args.shareId,
      verdict: args.verdict,
      matchLevel: args.matchLevel,
      productName: args.productName,
      reason: args.reason,
      incidentSlug: args.incidentSlug,
      checkedAt: args.checkedAt,
      datasetRegions: args.datasetRegions,
      sourceScope: args.sourceScope,
      expiresAt: args.expiresAt,
    });
  },
});
