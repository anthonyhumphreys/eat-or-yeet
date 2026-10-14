import type { MutationCtx } from "../operations";

export const IMPORT_ARCHIVE_AUDIT_MS = 7 * 24 * 60 * 60 * 1000;

// Maintenance writes outside upsertBatch must invalidate its archive shortcut.
export async function invalidateImportState(ctx: MutationCtx, authority: string, sourceId: string) {
  const state = await ctx.db.query("incidentImportState")
    .withIndex("by_authority_sourceId", (q) => q.eq("authority", authority).eq("sourceId", sourceId)).unique();
  if (state) await ctx.db.delete(state._id);
}
