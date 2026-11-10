import { fdaListingSnapshotSchema } from "../../src/lib/incidents/fda-listing-snapshot";
import { defineTable, v } from "../values";
import type { MutationCtx, QueryCtx } from "../operations";
import type { Doc } from "../model";

export const fdaMonitorTables = {
  fdaMonitorControl: defineTable({
    key: v.string(), requestedVersion: v.number(), fulfilledVersion: v.number(), pending: v.number(),
    listingFetchedAt: v.number(), lastCheckAt: v.optional(v.number()), lastCheckStatus: v.optional(v.string()),
  }).index("by_key", ["key"]),
  fdaMonitorNotices: defineTable({
    path: v.string(), listing: v.optional(fdaListingSnapshotSchema.element), listingFetchedAt: v.number(), listingVersion: v.number(),
    revision: v.number(), requiredVersion: v.number(), pending: v.boolean(),
    attemptedRevision: v.number(), appliedAt: v.number(), lastError: v.optional(v.string()),
  }).index("by_path", ["path"]).index("by_pending", ["pending"]),
  fdaMonitorReceipts: defineTable({ key: v.string(), expiresAt: v.number() })
    .index("by_key", ["key"]).index("by_expiresAt", ["expiresAt"]),
};

export function monitorControl(ctx: QueryCtx) {
  return ctx.db.query("fdaMonitorControl").withIndex("by_key", q => q.eq("key", "fda-announcements")).unique();
}
export function monitorNotice(ctx: QueryCtx, path: string) {
  return ctx.db.query("fdaMonitorNotices").withIndex("by_path", q => q.eq("path", path)).unique();
}
export async function ensureMonitorControl(ctx: MutationCtx) {
  const existing = await monitorControl(ctx);
  if (existing) return existing;
  const value = { key: "fda-announcements", requestedVersion: 0, fulfilledVersion: 0, pending: 0, listingFetchedAt: 0 };
  const id = await ctx.db.insert("fdaMonitorControl", value);
  return { ...value, _id: id, _creationTime: Date.now() };
}
export async function clearMonitorPending(ctx: MutationCtx, notice: Doc<"fdaMonitorNotices">) {
  if (!notice.pending) return;
  const control = await ensureMonitorControl(ctx);
  await ctx.db.patch(control._id, { pending: Math.max(0, control.pending - 1) });
  await ctx.db.patch(notice._id, { pending: false, lastError: undefined });
}
