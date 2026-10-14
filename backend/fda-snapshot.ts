import { z } from "zod";
import schema from "./schema";
import type { NormalisedIncident } from "../src/lib/incidents/types";
import { readSourceSnapshot } from "../src/lib/incidents/fsis-snapshot";

const prefix = "/safety/recalls-market-withdrawals-safety-alerts/";
const record = schema.incidents.validator.omit({ sourceKey: true, sourceRunId: true, productCategoryTags: true }).extend({
  region: z.literal("US"), status: z.enum(["active", "resolved"]), isDemo: z.literal(false), authority: z.literal("U.S. Food and Drug Administration"),
  originalSourceData: z.object({ announcementParagraphs: z.array(z.string().min(1)).min(1),
    productType: z.string().refine(value => value.split(",").some(type => ["Food & Beverages", "Dietary Supplements"].includes(type.trim()))),
  }).passthrough(),
}).refine(item => {
  try {
    const url = new URL(item.authorityUrl);
    return url.origin === "https://www.fda.gov" && !url.search && !url.hash && url.pathname.startsWith(prefix)
      && item.sourceId === `announcement:${url.pathname}` && Array.isArray(item.originalSourceData.announcementParagraphs)
      && item.originalSourceData.announcementParagraphs.length > 0;
  } catch { return false; }
}, "Snapshot must contain FDA food announcement records and canonical source identifiers");

export async function readFdaSnapshot(blob: Blob | null, fetchedAt: number): Promise<NormalisedIncident[]> {
  const rows = z.array(record).min(1).max(5_000).parse(await readSourceSnapshot(blob, fetchedAt, Date.now(), "FDA"));
  if (new Set(rows.map(row => row.sourceId)).size !== rows.length) throw new Error("FDA snapshot repeats a source identifier");
  return rows.map(row => ({ ...row, hazard: row.hazard ?? null, pathogen: row.pathogen ?? null,
    publishedAt: new Date(row.publishedAt), updatedAt: new Date(row.updatedAt), startsAt: new Date(row.startsAt), endsAt: row.endsAt === undefined ? null : new Date(row.endsAt),
    targets: row.targets.map(target => ({ ...target, dateFrom: target.dateFrom === undefined ? null : new Date(target.dateFrom), dateTo: target.dateTo === undefined ? null : new Date(target.dateTo) })),
  }));
}
