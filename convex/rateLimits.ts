import { v } from "convex/values";

import { mutation, type MutationCtx } from "./_generated/server";
import { requireServerSecret } from "./security";

type RateLimitBucket = {
  key: string;
  subjectHash: string;
  action: RateLimitAction;
  windowStartedAt: number;
  expiresAt: number;
  cost?: number;
};

type RateLimitAction = "check" | "share" | "mcp_check" | "mcp_browse" | "mcp_coverage" | "mcp_shopping";

async function takeBucket(ctx: MutationCtx, bucket: RateLimitBucket) {
  const cost = bucket.cost ?? 1;
  if (!Number.isInteger(cost) || cost < 1 || cost > 20) {
    throw new Error("Rate-limit cost must be an integer from 1 to 20.");
  }
  const existing = await ctx.db.query("rateLimits").withIndex("by_key", (q) => q.eq("key", bucket.key)).unique();
  if (existing) {
    if (!Number.isSafeInteger(existing.count) || existing.count < 1) {
      throw new Error("The rate-limit datastore contains an invalid count.");
    }
    const count = existing.count + cost;
    if (!Number.isSafeInteger(count)) throw new Error("The rate-limit datastore returned an invalid count.");
    await ctx.db.patch(existing._id, { count });
    return count;
  }
  await ctx.db.insert("rateLimits", {
    key: bucket.key,
    subjectHash: bucket.subjectHash,
    action: bucket.action,
    windowStartedAt: bucket.windowStartedAt,
    expiresAt: bucket.expiresAt,
    count: cost,
  });
  return cost;
}

const rateLimitAction = v.union(
  v.literal("check"),
  v.literal("share"),
  v.literal("mcp_check"),
  v.literal("mcp_browse"),
  v.literal("mcp_coverage"),
  v.literal("mcp_shopping"),
);

export const take = mutation({
  args: {
    secret: v.string(),
    key: v.string(),
    subjectHash: v.string(),
    action: rateLimitAction,
    windowStartedAt: v.number(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.secret);
    return takeBucket(ctx, {
      key: args.key,
      subjectHash: args.subjectHash,
      action: args.action,
      windowStartedAt: args.windowStartedAt,
      expiresAt: args.expiresAt,
    });
  },
});

// New callers can atomically consume multiple existing buckets in one mutation.
// Keep `take` above for compatibility with requests from older app deployments.
export const takeMany = mutation({
  args: {
    secret: v.string(),
    buckets: v.array(v.object({
      key: v.string(),
      subjectHash: v.string(),
      action: rateLimitAction,
      windowStartedAt: v.number(),
      expiresAt: v.number(),
      cost: v.optional(v.number()),
    })),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.secret);
    const counts: number[] = [];
    for (const bucket of args.buckets) {
      if (bucket.cost !== undefined && (!Number.isInteger(bucket.cost) || bucket.cost < 1 || bucket.cost > 20)) {
        throw new Error("Rate-limit cost must be an integer from 1 to 20.");
      }
      counts.push(await takeBucket(ctx, bucket));
    }
    return counts;
  },
});
