import { z } from "zod";

import { readSourceSnapshot } from "./fsis-snapshot";

export const fdaListingSnapshotSchema = z.array(z.strictObject({
  path: z.string().regex(/^\/safety\/recalls-market-withdrawals-safety-alerts\/[^?#]+$/),
  publishedAt: z.number().min(0).max(8.64e15), brand: z.string(), product: z.string(),
  productType: z.string().refine(value => value.split(",").some(type => ["Food & Beverages", "Dietary Supplements"].includes(type.trim()))),
  reason: z.string(), company: z.string(), terminationStatus: z.string(), terminated: z.boolean(),
})).min(1).max(10_000).refine(rows => new Set(rows.map(row => row.path)).size === rows.length, "FDA listing snapshot repeats a notice");

export async function readFdaListingSnapshot(blob: Blob | null, fetchedAt: number) {
  return fdaListingSnapshotSchema.parse(await readSourceSnapshot(blob, fetchedAt, Date.now(), "FDA listing"));
}
