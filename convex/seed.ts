import { v } from "convex/values";

import type { TargetType } from "../src/lib/domain/schemas";
import { browseCategories, namedRetailers } from "../src/lib/incidents/browse";
import { normaliseCode, normaliseGtin, normaliseText } from "../src/lib/matching/normalise";
import { mutation } from "./_generated/server";
import { requireServerSecret } from "./security";

const demos: Array<{
  title: string; slug: string; region: "UK" | "US"; hazard: string; pathogen?: string;
  summary: string; consumerAdvice: string; sourceId: string; severity: "medium" | "high";
  targets: Array<[TargetType, string, number]>;
}> = [
  {
    title: "DEMO: Northstar Peanut Bites recall", slug: "demo-northstar-peanut-bites", region: "UK",
    hazard: "Possible Salmonella contamination", pathogen: "Salmonella",
    summary: "DEMO DATA. A fictional recall used to test an exact barcode and batch match.",
    consumerAdvice: "DEMO DATA. Do not use this notice as real food-safety advice.", sourceId: "DEMO-EXACT-001", severity: "high",
    targets: [["gtin", "05000000000005", 70], ["batch", "24182", 65], ["product", "Northstar Peanut Bites", 35]],
  },
  {
    title: "DEMO: Demo Valley Foods producer investigation", slug: "demo-valley-foods-producer", region: "UK",
    hazard: "Undeclared allergen", summary: "DEMO DATA. A fictional producer-level warning used to test a probable match.",
    consumerAdvice: "DEMO DATA. Do not use this notice as real food-safety advice.", sourceId: "DEMO-PRODUCER-002", severity: "medium",
    targets: [["producer", "Demo Valley Foods", 48]],
  },
  {
    title: "DEMO: US leafy greens investigation", slug: "demo-us-leafy-greens", region: "US",
    hazard: "Investigation into possible contamination", pathogen: "E. coli",
    summary: "DEMO DATA. A fictional contextual warning used to test country and category matching.",
    consumerAdvice: "DEMO DATA. Check the official authority for current advice.", sourceId: "DEMO-CONTEXT-003", severity: "medium",
    targets: [["country", "United States", 10], ["category", "Leafy greens", 14]],
  },
];

function normalise(type: TargetType, value: string) {
  if (type === "gtin") return normaliseGtin(value);
  if (["batch", "lot", "establishment", "approval", "eggProducerCode"].includes(type)) return normaliseCode(value);
  return normaliseText(value);
}

export const demo = mutation({
  args: { secret: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.secret);
    if (process.env.ALLOW_DEMO_DATA !== "true") throw new Error("Demo data is disabled for this deployment");
    const now = Date.now();
    const endsAt = now + 365 * 24 * 60 * 60 * 1000;
    for (const item of demos) {
      const record = {
        ...item, status: "active" as const, authority: "Eat or Yeet demo data", authorityUrl: "http://localhost:3000/privacy",
        publishedAt: now, updatedAt: now, startsAt: now, endsAt, confidence: 1, originalSourceData: { demo: true },
        retrievedAt: now, isDemo: true,
        targets: item.targets.map(([type, value, weight]) => ({ type, value, valueNormalized: normalise(type, value), matchType: "exact" as const, weight, confidence: 1 })),
      };
      const existing = await ctx.db.query("incidents").withIndex("by_authority_sourceId", (q) => q.eq("authority", record.authority).eq("sourceId", record.sourceId)).unique();
      const incidentId = existing
        ? (await ctx.db.patch(existing._id, record), existing._id)
        : await ctx.db.insert("incidents", record);
      const browseSource = { title: record.title, targets: record.targets, originalSourceData: record.originalSourceData };
      const matchRecord = {
        incidentId,
        title: record.title,
        slug: record.slug,
        region: record.region,
        status: record.status,
        startsAt: record.startsAt,
        endsAt: record.endsAt,
        isDemo: record.isDemo,
        hazard: record.hazard,
        pathogen: record.pathogen,
        summary: record.summary,
        consumerAdvice: record.consumerAdvice,
        authority: record.authority,
        authorityUrl: record.authorityUrl,
        sourceId: record.sourceId,
        publishedAt: record.publishedAt,
        updatedAt: record.updatedAt,
        severity: record.severity,
        confidence: record.confidence,
        targets: record.targets,
        categories: browseCategories(browseSource),
        stores: namedRetailers(browseSource),
      };
      const existingMatch = await ctx.db.query("incidentMatchData").withIndex("by_incidentId", (q) => q.eq("incidentId", incidentId)).unique();
      if (existingMatch) await ctx.db.patch(existingMatch._id, matchRecord);
      else await ctx.db.insert("incidentMatchData", matchRecord);
    }
    const gtin = normaliseGtin("5000000000005");
    const product = await ctx.db.query("products").withIndex("by_gtin", (q) => q.eq("gtin", gtin)).unique();
    const productRecord = { gtin, name: "Northstar Peanut Bites", brand: "Northstar", category: "Snacks", metadata: { demo: true }, updatedAt: now };
    if (product) await ctx.db.patch(product._id, productRecord);
    else await ctx.db.insert("products", productRecord);
    return demos.length;
  },
});
