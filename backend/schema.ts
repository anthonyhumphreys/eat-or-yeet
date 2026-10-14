import { defineSchema, defineTable } from "./values";
import { v } from "./values";
import { notionTables } from "./lib/notion_schema";

const region = v.union(v.literal("UK"), v.literal("US"));
const status = v.union(v.literal("draft"), v.literal("active"), v.literal("resolved"), v.literal("reported"));
// Browse categories, grouped under super-categories (src/lib/incidents/super-categories.ts).
const productCategory = v.union(
  v.literal("Produce"),
  v.literal("Meat & poultry"),
  v.literal("Fish & seafood"),
  v.literal("Dairy & eggs"),
  v.literal("Bakery & grains"),
  v.literal("Snacks & sweets"),
  v.literal("Drinks"),
  v.literal("Prepared foods"),
  v.literal("Pantry"),
  v.literal("Baby food"),
  v.literal("Pharmaceutical"),
  v.literal("Supplements"),
  v.literal("Other foods"),
  v.literal("Prescription medicines"),
  v.literal("Over-the-counter medicines"),
  v.literal("Other medicines"),
);
const superCategory = v.union(
  v.literal("Baby"),
  v.literal("Cosmetics"),
  v.literal("Food"),
  v.literal("Medical"),
  v.literal("Pet"),
);
const ingestionStatus = v.union(
  v.literal("running"),
  v.literal("success"),
  v.literal("partial"),
  v.literal("failed"),
);
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
  groupId: v.optional(v.string()),
  weight: v.number(),
  confidence: v.number(),
});

export default defineSchema({
  ...notionTables,
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
    sourceKey: v.optional(v.string()),
    sourceRunId: v.optional(v.id("ingestionRuns")),
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
    // Open Food Facts category tags by normalised GTIN, for browse labels only.
    productCategoryTags: v.optional(v.record(v.string(), v.array(v.string()))),
  })
    .index("by_authority_sourceId", ["authority", "sourceId"]),

  datasetVersions: defineTable({ region, revision: v.number() }).index("by_region", ["region"]),

  // Small import fingerprints avoid rereading unchanged source payloads. The
  // projection is checked on every import; incoming source records are reread weekly.
  incidentImportState: defineTable({
    authority: v.string(),
    sourceId: v.string(),
    incidentId: v.id("incidents"),
    matchDataId: v.id("incidentMatchData"),
    fingerprint: v.string(),
    archiveVerifiedAt: v.number(),
  }).index("by_authority_sourceId", ["authority", "sourceId"]),

  // Matcher reads this bounded, source-data-free projection rather than the
  // full incident documents (which may contain multi-kilobyte source payloads).
  incidentMatchData: defineTable({
    incidentId: v.id("incidents"),
    title: v.string(),
    slug: v.string(),
    region,
    status,
    startsAt: v.number(),
    endsAt: v.optional(v.number()),
    isDemo: v.boolean(),
    hazard: v.optional(v.string()),
    pathogen: v.optional(v.string()),
    summary: v.string(),
    consumerAdvice: v.string(),
    authority: v.string(),
    authorityUrl: v.string(),
    sourceId: v.string(),
    publishedAt: v.number(),
    updatedAt: v.number(),
    severity,
    confidence: v.number(),
    targets: v.array(incidentTarget),
    sourceKey: v.optional(v.string()),
    categories: v.array(productCategory),
    // Optional only for rows saved before super-categories; those are food recalls.
    superCategories: v.optional(v.array(superCategory)),
    stores: v.array(v.string()),
  })
    .index("by_incidentId", ["incidentId"])
    .index("by_slug", ["slug"])
    .index("by_sourceKey_status", ["sourceKey", "status"])
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

  // Open Food Facts categories for recalled barcodes. Unlike the metadata
  // cache these rows never expire: they are rechecked when `due` passes, and a
  // failed recheck keeps the last answer so browse labels do not flap.
  productCategoryCache: defineTable({
    gtin: v.string(),
    status: v.union(v.literal("pending"), v.literal("found"), v.literal("missing")),
    tags: v.array(v.string()),
    due: v.number(),
    checkedAt: v.optional(v.number()),
  })
    .index("by_gtin", ["gtin"])
    .index("by_due", ["due"]),

  productMetadataCache: defineTable({
    gtin: v.string(),
    source: v.string(),
    metadata: v.any(),
    expiresAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_gtin", ["gtin"])
    .index("by_expiresAt", ["expiresAt"]),

  ingestionRuns: defineTable({
    source: v.string(),
    sourceName: v.optional(v.string()),
    region: v.optional(region),
    scope: v.optional(v.string()),
    status: v.optional(ingestionStatus),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    incidentsFound: v.number(),
    created: v.number(),
    updated: v.number(),
    errors: v.array(v.string()),
  })
    .index("by_startedAt", ["startedAt"])
    .index("by_source_startedAt", ["source", "startedAt"])
    .index("by_source_status_completedAt", ["source", "status", "completedAt"]),

  publicShares: defineTable({
    shareId: v.string(),
    verdict: v.string(),
    matchLevel: v.string(),
    productName: v.optional(v.string()),
    reason: v.string(),
    incidentSlug: v.optional(v.string()),
    checkedAt: v.optional(v.number()),
    datasetRegions: v.optional(v.array(region)),
    sourceScope: v.optional(v.string()),
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
