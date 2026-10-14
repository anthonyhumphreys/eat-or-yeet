import { z } from "zod";
import schema from "./schema";
import type { TableNames } from "./model";
import { internalMutation, internalQuery } from "./operations";

const tables = Object.keys(schema) as [TableNames, ...TableNames[]];
export const preflight = internalQuery({
  args: { ids: z.array(z.string().min(1)).max(100_000) },
  handler: async (ctx, { ids }) => {
    if (process.env.BACKEND_RESTORE_ENABLED !== "true") throw new Error("Restore is disabled");
    const existing = await ctx.db.sql.prepare("SELECT id FROM records LIMIT 100001").all<{ id: string }>();
    const allowed = new Set(ids);
    if (existing.results.length > 100_000 || existing.results.some((row) => !allowed.has(row.id))) {
      throw new Error("The destination contains records outside this export. Use an empty isolated database or resume the same restore.");
    }
    return { existing: existing.results.length };
  },
});
export const restore = internalMutation({
  args: {
    table: z.enum(tables),
    rows: z.array(z.strictObject({ id: z.string().min(1).max(200), createdAt: z.number().nonnegative(), value: z.record(z.string(), z.unknown()) })).max(25),
  },
  handler: async (ctx, args) => {
    if (process.env.BACKEND_RESTORE_ENABLED !== "true") throw new Error("Restore is disabled");
    await ctx.db.restoreRows(args.table, args.rows);
    return { restored: args.rows.length };
  },
});
