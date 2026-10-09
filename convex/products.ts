import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { requireServerSecret } from "./security";

export const getByGtin = query({
  args: { gtin: v.string() },
  handler: (ctx, args) => ctx.db.query("products").withIndex("by_gtin", (q) => q.eq("gtin", args.gtin)).unique(),
});

// Prefer the curated product record and only touch the fallback cache on a miss.
// This lets check requests use one Convex invocation without extra cache reads
// for products already present in the local table.
export const lookupByGtin = query({
  args: { gtin: v.string() },
  handler: async (ctx, args) => {
    const product = await ctx.db.query("products").withIndex("by_gtin", (q) => q.eq("gtin", args.gtin)).unique();
    if (product) return { product, metadata: null };

    const cached = await ctx.db.query("productMetadataCache").withIndex("by_gtin", (q) => q.eq("gtin", args.gtin)).unique();
    return {
      product: null,
      metadata: cached && cached.expiresAt > Date.now() ? cached : null,
    };
  },
});

export const getCachedMetadata = query({
  args: { gtin: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("productMetadataCache").withIndex("by_gtin", (q) => q.eq("gtin", args.gtin)).unique();
    return row && row.expiresAt > Date.now() ? row : null;
  },
});

export const cacheMetadata = mutation({
  args: { secret: v.string(), gtin: v.string(), metadata: v.any(), expiresAt: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.secret);
    const existing = await ctx.db.query("productMetadataCache").withIndex("by_gtin", (q) => q.eq("gtin", args.gtin)).unique();
    const value = { source: "open-food-facts", metadata: args.metadata, expiresAt: args.expiresAt, updatedAt: Date.now() };
    if (existing) await ctx.db.patch(existing._id, value);
    else await ctx.db.insert("productMetadataCache", { gtin: args.gtin, ...value });
  },
});
