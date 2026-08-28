import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { requireServerSecret } from "./security";

export const get = query({
  args: { shareId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("publicShares").withIndex("by_shareId", (q) => q.eq("shareId", args.shareId)).unique();
    return row && row.expiresAt > Date.now() ? row : null;
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
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.secret);
    await ctx.db.insert("publicShares", {
      shareId: args.shareId,
      verdict: args.verdict,
      matchLevel: args.matchLevel,
      productName: args.productName,
      reason: args.reason,
      incidentSlug: args.incidentSlug,
      expiresAt: args.expiresAt,
    });
  },
});
