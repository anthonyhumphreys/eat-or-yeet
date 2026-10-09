import { v } from "convex/values";

import { mutation, type MutationCtx } from "./_generated/server";
import { requireServerSecret } from "./security";

type RateLimitBucket = {
  key: string;
  subjectHash: string;
  action: "check" | "share";
  windowStartedAt: number;
  expiresAt: number;
};

async function takeBucket(ctx: MutationCtx, bucket: RateLimitBucket) {
  const existing = await ctx.db.query("rateLimits").withIndex("by_key", (q) => q.eq("key", bucket.key)).unique();
  if (existing) {
    const count = existing.count + 1;
    await ctx.db.patch(existing._id, { count });
    return count;
  }
  await ctx.db.insert("rateLimits", {
    key: bucket.key,
    subjectHash: bucket.subjectHash,
    action: bucket.action,
    windowStartedAt: bucket.windowStartedAt,
    expiresAt: bucket.expiresAt,
    count: 1,
  });
  return 1;
}

export const take = mutation({
  args: {
    secret: v.string(),
    key: v.string(),
    subjectHash: v.string(),
    action: v.union(v.literal("check"), v.literal("share")),
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
      action: v.union(v.literal("check"), v.literal("share")),
      windowStartedAt: v.number(),
      expiresAt: v.number(),
    })),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.secret);
    const counts: number[] = [];
    for (const bucket of args.buckets) counts.push(await takeBucket(ctx, bucket));
    return counts;
  },
});
