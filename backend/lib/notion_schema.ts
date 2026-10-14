import { defineTable } from "../values";
import { v } from "../values";

const region = v.union(v.literal("UK"), v.literal("US"));
const status = v.union(
  v.literal("setting_up"),
  v.literal("active"),
  v.literal("paused"),
  v.literal("needs_reconnect"),
  v.literal("setup_failed"),
  v.literal("disconnecting"),
);
const propertyKind = v.union(v.literal("title"), v.literal("rich_text"), v.literal("checkbox"), v.literal("select"), v.literal("date"));
const notionProperty = v.object({ id: v.string(), kind: propertyKind });

export const notionTables = {
  notionInstallations: defineTable({
    ownerId: v.string(), workspaceId: v.string(), botId: v.string(),
    templatePageId: v.optional(v.string()), databaseId: v.optional(v.string()), dataSourceId: v.optional(v.string()),
    region, status, generation: v.number(), credentialRevision: v.number(), credentialEnvelope: v.string(),
    pendingCredentialEnvelope: v.optional(v.string()),
    refreshAttemptRevision: v.optional(v.number()), refreshLeaseUntil: v.optional(v.number()),
    properties: v.optional(v.record(v.string(), notionProperty)),
    statusLabels: v.optional(v.object({ found: v.string(), none: v.string(), unable: v.string() })),
    controlBusy: v.boolean(), controlAction: v.optional(v.union(v.literal("pause"), v.literal("resume"), v.literal("setup"), v.literal("disconnect"))),
    disconnectAfterDrain: v.boolean(), eventCount: v.number(), pendingCount: v.number(), fingerprintCount: v.number(), leaseId: v.optional(v.string()), leaseUntil: v.optional(v.number()),
    createdAt: v.number(), updatedAt: v.number(), errorCode: v.optional(v.string()),
  })
    .index("by_owner_workspace", ["ownerId", "workspaceId"])
    .index("by_workspace", ["workspaceId"])
    .index("by_database", ["databaseId"])
    .index("by_dataSource", ["dataSourceId"])
    .index("by_status", ["status"]),

  notionOAuthPending: defineTable({
    stateHash: v.string(), bindingHash: v.string(), region, installationId: v.optional(v.id("notionInstallations")),
    expiresAt: v.number(),
  }).index("by_stateHash", ["stateHash"]).index("by_expiresAt", ["expiresAt"]).index("by_installation", ["installationId"]),

  notionSessions: defineTable({
    installationId: v.id("notionInstallations"), sessionHash: v.string(), csrfHash: v.string(), expiresAt: v.number(), createdAt: v.number(),
  }).index("by_sessionHash", ["sessionHash"]).index("by_installation", ["installationId", "expiresAt"]).index("by_expiresAt", ["expiresAt"]),

  notionDisconnectReceipts: defineTable({ sessionHash: v.string(), permissionRemoved: v.boolean(), expiresAt: v.number() })
    .index("by_sessionHash", ["sessionHash"]).index("by_expiresAt", ["expiresAt"]),

  notionEvents: defineTable({
    installationId: v.id("notionInstallations"), eventHash: v.string(), expiresAt: v.number(),
  }).index("by_installation_event", ["installationId", "eventHash"]).index("by_installation_expiry", ["installationId", "expiresAt"]).index("by_expiry", ["expiresAt"]),

  notionJobs: defineTable({
    installationId: v.id("notionInstallations"), pageId: v.string(), dueAt: v.number(), attempts: v.number(), revision: v.number(),
    leaseId: v.optional(v.string()), leaseUntil: v.optional(v.number()), leasedGeneration: v.optional(v.number()),
    touchedAt: v.number(),
  }).index("by_installation_page", ["installationId", "pageId"])
    .index("by_installation_due", ["installationId", "dueAt"])
    .index("by_due", ["dueAt"]),

  notionProcessingSlots: defineTable({
    slot: v.number(), installationId: v.id("notionInstallations"), jobId: v.optional(v.id("notionJobs")), kind: v.union(v.literal("review"), v.literal("setup"), v.literal("disconnect")), leaseId: v.string(), leaseUntil: v.number(),
  }).index("by_slot", ["slot"]).index("by_leaseUntil", ["leaseUntil"]),

  notionFingerprints: defineTable({
    installationId: v.id("notionInstallations"), pageId: v.string(), region, fingerprint: v.string(), completedAt: v.number(),
  }).index("by_installation_page", ["installationId", "pageId"]).index("by_installation_completed", ["installationId", "completedAt"]),

  notionQuotas: defineTable({ installationId: v.id("notionInstallations"), day: v.number(), used: v.number() })
    .index("by_installation_day", ["installationId", "day"]).index("by_day", ["day"]),
  notionGlobalQuotas: defineTable({ day: v.number(), used: v.number() }).index("by_day", ["day"]),
} as const;
