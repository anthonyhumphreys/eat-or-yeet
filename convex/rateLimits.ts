import { v } from "convex/values";

import { mutation } from "./_generated/server";
import { requireServerSecret } from "./security";

export const take = mutation({
  args: {
    secret: v.string(),
    key: v.string(),
    subjectHash: v.string(),
    action: v.string(),
    windowStartedAt: v.number(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.secret);
    const existing = await ctx.db.query("rateLimits").withIndex("by_key", (q) => q.eq("key", args.key)).unique();
    if (existing) {
      const count = existing.count + 1;
      await ctx.db.patch(existing._id, { count });
      return count;
    }
    await ctx.db.insert("rateLimits", {
      key: args.key,
      subjectHash: args.subjectHash,
      action: args.action,
      count: 1,
      windowStartedAt: args.windowStartedAt,
      expiresAt: args.expiresAt,
    });
    return 1;
  },
});
