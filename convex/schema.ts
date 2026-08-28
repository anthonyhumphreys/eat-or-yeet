import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const region = v.union(v.literal("UK"), v.literal("US"));
const status = v.union(v.literal("draft"), v.literal("active"), v.literal("resolved"));
const severity = v.union(v.literal("low"), v.literal("medium"), v.literal("high"), v.literal("critical"));
const targetType = v.union(
  v.literal("gtin"),
  v.literal("product"),
  v.literal("category"),
  v.literal("brand"),
  v.literal("producer"),
  v.literal("farm"),
  v.literal("batch"),
  v.literal("lot"),
  v.literal("establishment"),
  v.literal("approval"),
  v.literal("eggProducerCode"),
  v.literal("country"),
  v.literal("retailer"),
);

const incidentTarget = v.object({
  type: targetType,
  value: v.string(),
  valueNormalized: v.string(),
  matchType: v.union(v.literal("exact"), v.literal("pattern")),
  dateFrom: v.optional(v.number()),
  dateTo: v.optional(v.number()),
  notes: v.optional(v.string()),
  weight: v.number(),
  confidence: v.number(),
});

export default defineSchema({
  incidents: defineTable({
    title: v.string(),
    slug: v.string(),
    region,
    status,
    hazard: v.optional(v.string()),
    pathogen: v.optional(v.string()),
    summary: v.string(),
    consumerAdvice: v.string(),
    authority: v.string(),
    authorityUrl: v.string(),
    sourceId: v.string(),
    publishedAt: v.number(),
    updatedAt: v.number(),
    startsAt: v.number(),
    endsAt: v.optional(v.number()),
    severity,
    confidence: v.number(),
    originalSourceData: v.any(),
    retrievedAt: v.number(),
    isDemo: v.boolean(),
    targets: v.array(incidentTarget),
  })
    .index("by_authority_sourceId", ["authority", "sourceId"])
    .index("by_slug", ["slug"])
    .index("by_status", ["status"])
    .index("by_region_status", ["region", "status"]),

  products: defineTable({
    gtin: v.string(),
    name: v.string(),
    brand: v.optional(v.string()),
    producer: v.optional(v.string()),
    countryOfOrigin: v.optional(v.string()),
    category: v.optional(v.string()),
    metadata: v.any(),
    updatedAt: v.number(),
  }).index("by_gtin", ["gtin"]),

  productMetadataCache: defineTable({
    gtin: v.string(),
    source: v.string(),
    metadata: v.any(),
    expiresAt: v.number(),
    updatedAt: v.number(),
  }).index("by_gtin", ["gtin"]),

  ingestionRuns: defineTable({
    source: v.string(),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    incidentsFound: v.number(),
    created: v.number(),
    updated: v.number(),
    errors: v.array(v.string()),
  }).index("by_startedAt", ["startedAt"]),

  publicShares: defineTable({
    shareId: v.string(),
    verdict: v.string(),
    matchLevel: v.string(),
    productName: v.optional(v.string()),
    reason: v.string(),
    incidentSlug: v.optional(v.string()),
    expiresAt: v.number(),
  })
    .index("by_shareId", ["shareId"])
    .index("by_expiresAt", ["expiresAt"]),

  rateLimits: defineTable({
    key: v.string(),
    subjectHash: v.string(),
    action: v.string(),
    count: v.number(),
    windowStartedAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_expiresAt", ["expiresAt"]),

  supplyChainRelationships: defineTable({
    sourceProducer: v.string(),
    targetProducer: v.string(),
    relationshipType: v.string(),
    validFrom: v.optional(v.number()),
    validTo: v.optional(v.number()),
    source: v.string(),
    confidence: v.number(),
  }).index("by_sourceProducer", ["sourceProducer"]),
});
