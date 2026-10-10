import { v } from "convex/values";

import { categoryLookupDue, fetchOffCategoryTags } from "../src/lib/products/open-food-facts";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
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

// Open Food Facts categories for recalled barcodes (browse labels only).
// Imports read this cache and queue unseen barcodes; an hourly job looks a
// few up at a polite rate, and the next import attaches what it found.

const CATEGORY_LOOKUPS_PER_RUN = 60;
const CATEGORY_LOOKUP_SPACING_MS = 1_100;

export const getCategoryTags = internalQuery({
  args: { gtins: v.array(v.string()) },
  handler: async (ctx, args) => {
    const rows = await Promise.all(args.gtins.map((gtin) =>
      ctx.db.query("productCategoryCache").withIndex("by_gtin", (q) => q.eq("gtin", gtin)).unique()));
    return rows.filter((row) => row !== null).map((row) => ({ gtin: row.gtin, tags: row.tags }));
  },
});

export const queueCategoryLookups = internalMutation({
  args: { items: v.array(v.object({ gtin: v.string(), due: v.number() })) },
  handler: async (ctx, args) => {
    for (const item of args.items) {
      const existing = await ctx.db.query("productCategoryCache").withIndex("by_gtin", (q) => q.eq("gtin", item.gtin)).unique();
      if (!existing) await ctx.db.insert("productCategoryCache", { gtin: item.gtin, status: "pending", tags: [], due: item.due });
    }
  },
});

export const dueCategoryLookups = internalQuery({
  args: { now: v.number(), limit: v.number() },
  handler: async (ctx, args) => {
    const rows = await ctx.db.query("productCategoryCache").withIndex("by_due", (q) => q.lt("due", args.now)).take(args.limit);
    return rows.map((row) => row.gtin);
  },
});

export const saveCategoryLookup = internalMutation({
  args: {
    gtin: v.string(),
    result: v.union(v.null(), v.object({ status: v.union(v.literal("found"), v.literal("missing")), tags: v.array(v.string()) })),
    due: v.number(),
    checkedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("productCategoryCache").withIndex("by_gtin", (q) => q.eq("gtin", args.gtin)).unique();
    if (!row) return;
    // A failed lookup only moves the row back in the queue.
    if (!args.result) await ctx.db.patch(row._id, { due: args.due });
    else await ctx.db.patch(row._id, { status: args.result.status, tags: args.result.tags, due: args.due, checkedAt: args.checkedAt });
  },
});

export const lookupProductCategories = internalAction({
  args: {},
  handler: async (ctx): Promise<{ checked: number }> => {
    if (process.env.PRODUCT_CATEGORY_LOOKUPS === "false") return { checked: 0 };
    const gtins: string[] = await ctx.runQuery(internal.products.dueCategoryLookups, { now: Date.now(), limit: CATEGORY_LOOKUPS_PER_RUN });
    for (const [index, gtin] of gtins.entries()) {
      if (index) await new Promise((resolve) => setTimeout(resolve, CATEGORY_LOOKUP_SPACING_MS));
      const lookup = await fetchOffCategoryTags(gtin);
      const now = Date.now();
      await ctx.runMutation(internal.products.saveCategoryLookup, {
        gtin,
        result: lookup && { status: lookup.status, tags: lookup.status === "found" ? lookup.tags : [] },
        due: categoryLookupDue(lookup, now),
        checkedAt: now,
      });
    }
    return { checked: gtins.length };
  },
});
