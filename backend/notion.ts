import { BackendError, v } from "./values";

import { internal } from "./api";
import type { Doc, Id } from "./model";
import { internalMutation, internalQuery, mutation, query, type MutationCtx } from "./operations";
import { requireServerSecret } from "./security";

const DAY = 86_400_000;
const OAUTH_TTL = 10 * 60_000;
const SESSION_TTL = 30 * DAY;
const EVENT_TTL = 25 * 60 * 60_000;
const DISCONNECT_RECEIPT_TTL = 7 * DAY;
const MAX_INSTALLATIONS = 20;
const MAX_OAUTH_PENDING = 1_000;
const MAX_SESSIONS = 10;
const MAX_QUEUE = 1_000;
const MAX_EVENTS = 5_000;
const MAX_FINGERPRINTS = 5_000;
const MAX_GLOBAL_LEASES = 2;
const LEASE_MS = 120_000;
const PER_INSTALLATION_DAILY = 100;
const GLOBAL_DAILY = 1_000;
const regionValidator = v.union(v.literal("UK"), v.literal("US"));
const bindingValidator = v.object({
  templatePageId: v.string(), databaseId: v.string(), dataSourceId: v.string(),
  properties: v.record(v.string(), v.object({ id: v.string(), kind: v.union(v.literal("title"), v.literal("rich_text"), v.literal("checkbox"), v.literal("select"), v.literal("date")) })),
  statusLabels: v.object({ found: v.string(), none: v.string(), unable: v.string() }),
});
const webhookTypeValidator = v.union(v.literal("page.created"), v.literal("page.properties_updated"));
const inputPropertyNames = ["item", "brand", "barcode", "bought", "batchCode", "lotCode", "producer", "countryOfOrigin", "establishmentNumber", "approvalNumber", "retailer", "useBy", "bestBefore", "productionDate"] as const;
type InstallationId = Id<"notionInstallations">;
type Installation = Doc<"notionInstallations">;
const notionActions = internal.notionActions;

function unauthorized(): never { throw new BackendError("Unauthorized"); }
function budgetDay(now: number): number { return Math.floor(now / DAY); }
function decodePropertyId(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}
function inputIds(binding: Installation): Set<string> {
  const properties = binding.properties as Record<string, { id: string }> | undefined;
  return new Set(inputPropertyNames.flatMap((name) => properties?.[name] ? [decodePropertyId(properties[name]!.id)] : []));
}

async function recoverExpiredLease(ctx: MutationCtx, installationId: InstallationId, leaseId: string, now: number): Promise<void> {
  const installation = await ctx.db.get("notionInstallations", installationId);
  const slots = await ctx.db.query("notionProcessingSlots").withIndex("by_slot").take(MAX_GLOBAL_LEASES);
  const slot = slots.find((row) => row.installationId === installationId && row.leaseId === leaseId);
  if (slot && (!installation || installation.leaseId !== leaseId || (installation.leaseUntil ?? 0) <= now)) {
    if (slot.jobId) {
      const job = await ctx.db.get("notionJobs", slot.jobId);
      if (job?.leaseId === leaseId) await ctx.db.patch(job._id, { leaseId: undefined, leaseUntil: undefined, leasedGeneration: undefined, dueAt: Math.min(job.dueAt, now), touchedAt: now });
    }
    await ctx.db.delete(slot._id);
  }
  if (!installation || installation.leaseId !== leaseId || (installation.leaseUntil ?? 0) > now) return;

  const pendingCredentials = installation.pendingCredentialEnvelope;
  const disconnecting = installation.status === "disconnecting" || installation.disconnectAfterDrain;
  const refreshAmbiguous = installation.refreshLeaseUntil !== undefined && installation.refreshLeaseUntil <= now &&
    installation.refreshAttemptRevision === installation.credentialRevision && !pendingCredentials && !disconnecting;
  const nextStatus = disconnecting ? "disconnecting" : refreshAmbiguous ? "needs_reconnect" : pendingCredentials ? "setting_up" : installation.status;
  await ctx.db.patch(installation._id, {
    leaseId: undefined, leaseUntil: undefined,
    ...(pendingCredentials ? { credentialEnvelope: pendingCredentials, credentialRevision: installation.credentialRevision + 1, pendingCredentialEnvelope: undefined, refreshLeaseUntil: undefined, refreshAttemptRevision: undefined } : {}),
    ...(refreshAmbiguous ? { generation: installation.generation + 1, errorCode: "access_revoked", refreshLeaseUntil: undefined } : {}),
    status: nextStatus,
    controlBusy: nextStatus === "setting_up" || nextStatus === "disconnecting",
    controlAction: nextStatus === "setting_up" ? "setup" : nextStatus === "disconnecting" ? "disconnect" : undefined,
    updatedAt: now,
  });
  if (nextStatus === "disconnecting") await ctx.scheduler.runAfter(0, notionActions.disconnect, { installationId });
  else if (nextStatus === "setting_up") await ctx.scheduler.runAfter(0, notionActions.setup, { installationId, expectedGeneration: installation.generation });
  else if (nextStatus === "active") await ctx.scheduler.runAfter(0, notionActions.run, { installationId });
}

export const beginOAuth = mutation({
  args: { secret: v.string(), stateHash: v.string(), bindingHash: v.string(), region: regionValidator, installationId: v.optional(v.id("notionInstallations")), now: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.secret);
    if (args.stateHash.length !== 64 || args.bindingHash.length !== 64) unauthorized();
    const now = args.now;
    const expired = await ctx.db.query("notionOAuthPending").withIndex("by_expiresAt", (q) => q.lte("expiresAt", now)).take(100);
    for (const row of expired) await ctx.db.delete(row._id);
    const pending = await ctx.db.query("notionOAuthPending").take(MAX_OAUTH_PENDING + 1);
    if (pending.length >= MAX_OAUTH_PENDING) throw new BackendError("OAuth setup is temporarily busy.");
    if (args.installationId && !(await ctx.db.get("notionInstallations", args.installationId))) unauthorized();
    await ctx.db.insert("notionOAuthPending", {
      stateHash: args.stateHash, bindingHash: args.bindingHash, region: args.region,
      installationId: args.installationId, expiresAt: now + OAUTH_TTL,
    });
  },
});

export const consumeOAuth = mutation({
  args: { secret: v.string(), stateHash: v.string(), bindingHash: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.secret);
    const row = await ctx.db.query("notionOAuthPending").withIndex("by_stateHash", (q) => q.eq("stateHash", args.stateHash)).unique();
    if (!row) return null;
    if (row.expiresAt <= args.now) { await ctx.db.delete(row._id); return null; }
    if (row.bindingHash !== args.bindingHash) return null;
    await ctx.db.delete(row._id);
    return { region: row.region, installationId: row.installationId ?? null };
  },
});

export const authorize = mutation({
  args: {
    secret: v.string(), ownerId: v.string(), workspaceId: v.string(), botId: v.string(), templatePageId: v.optional(v.string()),
    region: regionValidator, credentialEnvelope: v.string(), now: v.number(), expectedInstallationId: v.optional(v.id("notionInstallations")),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.secret);
    if (!args.ownerId || !args.workspaceId || !args.botId || !/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(args.credentialEnvelope)) unauthorized();
    const existing = await ctx.db.query("notionInstallations").withIndex("by_owner_workspace", (q) => q.eq("ownerId", args.ownerId).eq("workspaceId", args.workspaceId)).unique();
    if (args.expectedInstallationId && existing?._id !== args.expectedInstallationId) unauthorized();
    if (existing) {
      if (existing.status === "disconnecting" || existing.disconnectAfterDrain) unauthorized();
      const inFlight = existing.leaseUntil !== undefined && existing.leaseUntil > args.now;
      await ctx.db.patch(existing._id, {
        botId: args.botId,
        templatePageId: existing.dataSourceId ? existing.templatePageId : args.templatePageId ?? existing.templatePageId,
        region: args.region, status: "setting_up", generation: existing.generation + 1,
        ...(inFlight ? { pendingCredentialEnvelope: args.credentialEnvelope } : { credentialEnvelope: args.credentialEnvelope, credentialRevision: existing.credentialRevision + 1, pendingCredentialEnvelope: undefined }),
        controlBusy: true, controlAction: inFlight ? "setup" : undefined, disconnectAfterDrain: false, updatedAt: args.now, errorCode: undefined,
      });
      await ctx.scheduler.runAfter(0, notionActions.setup, { installationId: existing._id, expectedGeneration: existing.generation + 1 });
      return { installationId: existing._id, generation: existing.generation + 1, status: "setting_up" as const };
    }
    const all = await ctx.db.query("notionInstallations").take(MAX_INSTALLATIONS + 1);
    if (all.length >= MAX_INSTALLATIONS) throw new BackendError("Installation capacity is full.");
    const installationId = await ctx.db.insert("notionInstallations", {
      ownerId: args.ownerId, workspaceId: args.workspaceId, botId: args.botId, templatePageId: args.templatePageId,
      region: args.region, status: "setting_up", generation: 1, credentialRevision: 1, credentialEnvelope: args.credentialEnvelope,
      controlBusy: true, controlAction: "setup", disconnectAfterDrain: false, createdAt: args.now, updatedAt: args.now,
      eventCount: 0, pendingCount: 0, fingerprintCount: 0,
    });
    await ctx.scheduler.runAfter(0, notionActions.setup, { installationId, expectedGeneration: 1 });
    return { installationId, generation: 1, status: "setting_up" as const };
  },
});

export const createSession = mutation({
  args: { secret: v.string(), sessionHash: v.string(), installationId: v.id("notionInstallations"), csrfHash: v.string(), expiresAt: v.number(), now: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.secret);
    if (args.expiresAt <= args.now || args.expiresAt > args.now + SESSION_TTL || args.sessionHash.length !== 64 || args.csrfHash.length !== 64) unauthorized();
    const installation = await ctx.db.get("notionInstallations", args.installationId);
    if (!installation || installation.status === "disconnecting") unauthorized();
    await ctx.db.insert("notionSessions", { installationId: args.installationId, sessionHash: args.sessionHash, csrfHash: args.csrfHash, expiresAt: args.expiresAt, createdAt: args.now });
    const sessions = await ctx.db.query("notionSessions").withIndex("by_installation", (q) => q.eq("installationId", args.installationId)).collect();
    sessions.sort((a, b) => b.expiresAt - a.expiresAt || b.createdAt - a.createdAt);
    for (const old of sessions.slice(MAX_SESSIONS)) await ctx.db.delete(old._id);
  },
});

export const management = query({
  args: { secret: v.string(), sessionHash: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.secret);
    const session = await ctx.db.query("notionSessions").withIndex("by_sessionHash", (q) => q.eq("sessionHash", args.sessionHash)).unique();
    if (!session) return null;
    if (session.expiresAt <= args.now) return null;
    const installation = await ctx.db.get("notionInstallations", session.installationId);
    if (!installation) return null;
    const day = budgetDay(args.now);
    const [local, global] = await Promise.all([
      ctx.db.query("notionQuotas").withIndex("by_installation_day", (q) => q.eq("installationId", installation._id).eq("day", day)).unique(),
      ctx.db.query("notionGlobalQuotas").withIndex("by_day", (q) => q.eq("day", day)).unique(),
    ]);
    return {
      installation: { id: installation._id, region: installation.region, status: installation.status, ...(installation.databaseId ? { binding: { databaseId: installation.databaseId } } : {}), ...(installation.errorCode ? { errorCode: installation.errorCode } : {}) },
      busy: installation.controlBusy,
      budget: { allowed: installation.status === "active" && !installation.controlBusy && (local?.used ?? 0) < PER_INSTALLATION_DAILY && (global?.used ?? 0) < GLOBAL_DAILY, retryAt: (day + 1) * DAY },
    };
  },
});

export const disconnectReceipt = query({
  args: { secret: v.string(), sessionHash: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.secret);
    if (!/^[a-f0-9]{64}$/.test(args.sessionHash)) return null;
    const receipt = await ctx.db.query("notionDisconnectReceipts").withIndex("by_sessionHash", (q) => q.eq("sessionHash", args.sessionHash)).unique();
    if (!receipt || receipt.expiresAt <= args.now) return null;
    return { permissionRemoved: receipt.permissionRemoved };
  },
});

export const control = mutation({
    args: { secret: v.string(), sessionHash: v.string(), csrfHash: v.string(), action: v.union(v.literal("pause"), v.literal("resume"), v.literal("retry"), v.literal("disconnect"), v.literal("region")), region: v.optional(regionValidator), now: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.secret);
    const session = await ctx.db.query("notionSessions").withIndex("by_sessionHash", (q) => q.eq("sessionHash", args.sessionHash)).unique();
    if (!session || session.expiresAt <= args.now || session.csrfHash !== args.csrfHash) unauthorized();
    const installation = await ctx.db.get("notionInstallations", session.installationId);
    if (!installation || installation.status === "disconnecting") unauthorized();
    const hasLease = installation.leaseUntil !== undefined && installation.leaseUntil > args.now;
    if (args.action === "pause") {
      await ctx.db.patch(installation._id, { status: "paused", generation: installation.generation + 1, controlBusy: hasLease, controlAction: hasLease ? "pause" : undefined, updatedAt: args.now });
    } else if (args.action === "resume" || args.action === "retry") {
      const needsSetup = !installation.databaseId || !installation.dataSourceId || args.action === "retry";
      const status = needsSetup || hasLease ? "setting_up" : "active";
      await ctx.db.patch(installation._id, { status, generation: installation.generation + 1, controlBusy: hasLease || needsSetup, controlAction: needsSetup ? "setup" : hasLease ? "resume" : undefined, updatedAt: args.now });
      if (!hasLease) {
        if (needsSetup) await ctx.scheduler.runAfter(0, notionActions.setup, { installationId: installation._id, expectedGeneration: installation.generation + 1 });
        else await ctx.scheduler.runAfter(0, notionActions.run, { installationId: installation._id });
      }
    } else if (args.action === "region") {
      if (!args.region) throw new BackendError("A region is required.");
      await ctx.db.patch(installation._id, { region: args.region, status: "setting_up", generation: installation.generation + 1, controlBusy: true, controlAction: "setup", updatedAt: args.now });
      if (!hasLease) await ctx.scheduler.runAfter(0, notionActions.setup, { installationId: installation._id, expectedGeneration: installation.generation + 1 });
    } else {
      await ctx.db.patch(installation._id, { status: "disconnecting", generation: installation.generation + 1, controlBusy: true, controlAction: "disconnect", disconnectAfterDrain: true, updatedAt: args.now });
      if (!hasLease) await ctx.scheduler.runAfter(0, notionActions.disconnect, { installationId: installation._id });
    }
    return { accepted: true as const };
  },
});

export const receiveWebhook = mutation({
  args: {
    secret: v.string(), workspaceId: v.string(), botIds: v.array(v.string()), databaseId: v.string(), dataSourceId: v.optional(v.string()),
    pageId: v.string(), eventHash: v.string(), type: webhookTypeValidator, updatedProperties: v.array(v.string()), now: v.number(),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.secret);
    if (args.botIds.length < 1 || args.botIds.length > 20 || args.updatedProperties.length > 100 || !/^[a-f0-9]{64}$/.test(args.eventHash) || !args.pageId || args.pageId.length > 256 || !args.databaseId) unauthorized();
    const installations = await ctx.db.query("notionInstallations").withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId)).take(MAX_INSTALLATIONS);
    const recipients = new Set(args.botIds);
    const installation = installations.find((row) => recipients.has(row.botId) && row.databaseId === args.databaseId &&
      (args.dataSourceId === undefined || row.dataSourceId === args.dataSourceId) && row.databaseId !== undefined &&
      (args.type === "page.created" || args.updatedProperties.some((id) => {
        return inputIds(row).has(decodePropertyId(id));
      })));
    if (!installation) {
      const unboundSetup = installations.some((row) => recipients.has(row.botId) && row.status === "setting_up" && !row.databaseId);
      return { result: unboundSetup ? "setting_up" as const : "unmatched" as const };
    }
    if (installation.status === "setting_up") return enqueueForInstallation(ctx, installation, args.pageId, args.eventHash, args.now, false);
    if (installation.status !== "active") return { result: "inactive" as const, installationId: installation._id };
    return enqueueForInstallation(ctx, installation, args.pageId, args.eventHash, args.now);
  },
});

async function enqueueForInstallation(ctx: MutationCtx, installation: Installation, pageId: string, eventHash: string, now: number, schedule = true) {
  const oldEvents = await ctx.db.query("notionEvents").withIndex("by_installation_expiry", (q) => q.eq("installationId", installation._id).lte("expiresAt", now)).take(100);
  for (const event of oldEvents) await ctx.db.delete(event._id);
  const eventCount = Math.max(0, installation.eventCount - oldEvents.length);
  if (oldEvents.length) await ctx.db.patch(installation._id, { eventCount });
  const duplicate = await ctx.db.query("notionEvents").withIndex("by_installation_event", (q) => q.eq("installationId", installation._id).eq("eventHash", eventHash)).unique();
  if (duplicate) return { result: "duplicate" as const, installationId: installation._id };
  if (eventCount >= MAX_EVENTS) return { result: "full" as const, installationId: installation._id };
  const existing = await ctx.db.query("notionJobs").withIndex("by_installation_page", (q) => q.eq("installationId", installation._id).eq("pageId", pageId)).unique();
  if (!existing && installation.pendingCount >= MAX_QUEUE) return { result: "full" as const, installationId: installation._id };
  await ctx.db.insert("notionEvents", { installationId: installation._id, eventHash, expiresAt: now + EVENT_TTL });
  if (existing) await ctx.db.patch(existing._id, { dueAt: now, revision: existing.revision + 1, touchedAt: now });
  else {
    await ctx.db.insert("notionJobs", { installationId: installation._id, pageId, dueAt: now, attempts: 0, revision: 1, touchedAt: now });
    await ctx.db.patch(installation._id, { pendingCount: installation.pendingCount + 1 });
  }
  await ctx.db.patch(installation._id, { eventCount: eventCount + 1 });
  if (schedule) await ctx.scheduler.runAfter(0, notionActions.run, { installationId: installation._id });
  return { result: "accepted" as const, installationId: installation._id };
}

export const installationSnapshot = internalQuery({
  args: { installationId: v.id("notionInstallations") },
  handler: async (ctx, args) => ctx.db.get("notionInstallations", args.installationId),
});

export const bindInstallation = internalMutation({
  args: { installationId: v.id("notionInstallations"), expectedGeneration: v.number(), binding: bindingValidator, now: v.number() },
  handler: async (ctx, args) => {
    const installation = await ctx.db.get("notionInstallations", args.installationId);
    if (!installation || installation.generation !== args.expectedGeneration) throw new BackendError("Installation generation changed.");
    const [byDatabase, bySource] = await Promise.all([
      ctx.db.query("notionInstallations").withIndex("by_database", (q) => q.eq("databaseId", args.binding.databaseId)).take(2),
      ctx.db.query("notionInstallations").withIndex("by_dataSource", (q) => q.eq("dataSourceId", args.binding.dataSourceId)).take(2),
    ]);
    if ([...byDatabase, ...bySource].some((row) => row._id !== installation._id)) throw new BackendError("Notion list is already reserved.");
    await ctx.db.patch(installation._id, {
      templatePageId: args.binding.templatePageId, databaseId: args.binding.databaseId, dataSourceId: args.binding.dataSourceId,
      properties: args.binding.properties, statusLabels: args.binding.statusLabels, updatedAt: args.now,
    });
    return { installationId: installation._id, generation: installation.generation };
  },
});

export const recoverLease = internalMutation({
  args: { installationId: v.id("notionInstallations"), leaseId: v.string() },
  handler: async (ctx, args) => {
    await recoverExpiredLease(ctx, args.installationId, args.leaseId, Date.now());
  },
});

export const claimSetup = internalMutation({
  args: { installationId: v.id("notionInstallations"), expectedGeneration: v.number(), now: v.number() },
  handler: async (ctx, args) => {
    const installation = await ctx.db.get("notionInstallations", args.installationId);
    if (!installation || installation.status !== "setting_up" || installation.generation !== args.expectedGeneration) return { result: "stale" as const };
    if (installation.leaseUntil !== undefined && installation.leaseUntil > args.now) {
      await ctx.scheduler.runAfter(Math.max(1_000, installation.leaseUntil - args.now), notionActions.setup, { installationId: installation._id, expectedGeneration: installation.generation });
      return { result: "busy" as const };
    }
    let slots = await ctx.db.query("notionProcessingSlots").withIndex("by_slot").take(MAX_GLOBAL_LEASES);
    for (const expired of slots.filter((slot) => slot.leaseUntil <= args.now)) await recoverExpiredLease(ctx, expired.installationId, expired.leaseId, args.now);
    slots = await ctx.db.query("notionProcessingSlots").withIndex("by_slot").take(MAX_GLOBAL_LEASES);
    const live = slots.filter((slot) => slot.leaseUntil > args.now);
    if (live.length >= MAX_GLOBAL_LEASES) {
      const nearest = Math.min(...live.map((slot) => slot.leaseUntil));
      await ctx.scheduler.runAfter(Math.max(1_000, nearest - args.now), notionActions.setup, { installationId: installation._id, expectedGeneration: installation.generation });
      return { result: "slots_full" as const };
    }
    const used = new Set(live.map((slot) => slot.slot));
    const slot = [0, 1].find((candidate) => !used.has(candidate));
    if (slot === undefined) return { result: "slots_full" as const };
    const leaseId = `${installation._id}:setup:${installation.generation}:${args.now}`;
    const leaseUntil = args.now + LEASE_MS;
    await ctx.db.patch(installation._id, { leaseId, leaseUntil, controlBusy: true });
    await ctx.db.insert("notionProcessingSlots", { slot, installationId: installation._id, kind: "setup", leaseId, leaseUntil });
    await ctx.scheduler.runAfter(LEASE_MS, internal.notion.recoverLease, { installationId: installation._id, leaseId });
    return {
      result: "claimed" as const, leaseId, installationId: installation._id, ownerId: installation.ownerId, workspaceId: installation.workspaceId,
      generation: installation.generation, credentialRevision: installation.credentialRevision, credentialEnvelope: installation.credentialEnvelope,
      region: installation.region, templatePageId: installation.templatePageId, databaseId: installation.databaseId, dataSourceId: installation.dataSourceId,
      properties: installation.properties ?? null, statusLabels: installation.statusLabels ?? null,
    };
  },
});

export const ready = internalMutation({
  args: { installationId: v.id("notionInstallations"), expectedGeneration: v.number(), leaseId: v.string(), pageIds: v.array(v.string()), now: v.number() },
  handler: async (ctx, args) => {
    const installation = await ctx.db.get("notionInstallations", args.installationId);
    if (!installation || installation.generation !== args.expectedGeneration || installation.status !== "setting_up" || installation.leaseId !== args.leaseId || installation.leaseUntil === undefined || installation.leaseUntil <= args.now) return false;
    if (!installation.databaseId || !installation.dataSourceId) throw new BackendError("Installation binding is incomplete.");
    const [byDatabase, bySource] = await Promise.all([
      ctx.db.query("notionInstallations").withIndex("by_database", (q) => q.eq("databaseId", installation.databaseId)).take(2),
      ctx.db.query("notionInstallations").withIndex("by_dataSource", (q) => q.eq("dataSourceId", installation.dataSourceId)).take(2),
    ]);
    if ([...byDatabase, ...bySource].some((row) => row._id !== installation._id)) throw new BackendError("Notion list is already reserved.");
    const pageIds = [...new Set(args.pageIds)];
    if (pageIds.length > MAX_QUEUE || pageIds.some((pageId) => !pageId || pageId.length > 256)) throw new BackendError("Setup page list is invalid or too large.");
    const jobs = await ctx.db.query("notionJobs").withIndex("by_installation_due", (q) => q.eq("installationId", installation._id)).take(MAX_QUEUE + 1);
    const existingPages = new Set(jobs.map((job) => job.pageId));
    const newPages = pageIds.filter((pageId) => !existingPages.has(pageId));
    if (jobs.length + newPages.length > MAX_QUEUE) throw new BackendError("Shopping list queue is full.");
    for (const pageId of pageIds) {
      const existing = jobs.find((job) => job.pageId === pageId);
      if (existing) await ctx.db.patch(existing._id, { dueAt: args.now, revision: existing.revision + 1, touchedAt: args.now });
      else await ctx.db.insert("notionJobs", { installationId: installation._id, pageId, dueAt: args.now, attempts: 0, revision: 1, touchedAt: args.now });
    }
    if (newPages.length) await ctx.db.patch(installation._id, { pendingCount: installation.pendingCount + newPages.length });
    await ctx.db.patch(installation._id, { status: "active", errorCode: undefined, controlBusy: false, controlAction: undefined, updatedAt: args.now });
    const slot = await ctx.db.query("notionProcessingSlots").withIndex("by_slot").take(MAX_GLOBAL_LEASES);
    for (const row of slot) if (row.leaseId === args.leaseId) await ctx.db.delete(row._id);
    await ctx.db.patch(installation._id, { leaseId: undefined, leaseUntil: undefined, controlBusy: false, controlAction: undefined });
    if (jobs.length + newPages.length > 0) await ctx.scheduler.runAfter(0, notionActions.run, { installationId: installation._id });
    return { installationId: installation._id, generation: installation.generation, status: "active" as const };
  },
});

export const finishSetup = internalMutation({
  args: { installationId: v.id("notionInstallations"), expectedGeneration: v.number(), leaseId: v.string(), now: v.number(), errorCode: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const installation = await ctx.db.get("notionInstallations", args.installationId);
    if (!installation || installation.leaseId !== args.leaseId || installation.leaseUntil === undefined || installation.leaseUntil <= args.now) return false;
    const slots = await ctx.db.query("notionProcessingSlots").withIndex("by_slot").take(MAX_GLOBAL_LEASES);
    for (const slot of slots) if (slot.leaseId === args.leaseId) await ctx.db.delete(slot._id);
    const pending = installation.pendingCredentialEnvelope;
    const stillCurrent = installation.generation === args.expectedGeneration && installation.status === "setting_up";
    const setupFailed = Boolean(args.errorCode && stillCurrent);
    const retrySetup = installation.status === "setting_up" && !setupFailed;
    await ctx.db.patch(installation._id, {
      leaseId: undefined, leaseUntil: undefined, controlBusy: installation.status === "disconnecting" || retrySetup,
      controlAction: installation.status === "disconnecting" ? "disconnect" : retrySetup ? "setup" : undefined,
      ...(pending ? { credentialEnvelope: pending, credentialRevision: installation.credentialRevision + 1, pendingCredentialEnvelope: undefined } : {}),
      ...(setupFailed ? { status: "setup_failed", generation: installation.generation + 1, errorCode: args.errorCode } : {}), updatedAt: args.now,
    });
    if (installation.status === "disconnecting") await ctx.scheduler.runAfter(0, notionActions.disconnect, { installationId: installation._id });
    else if (pending || retrySetup) await ctx.scheduler.runAfter(0, notionActions.setup, { installationId: installation._id, expectedGeneration: installation.generation });
    else if (installation.status === "active") await ctx.scheduler.runAfter(0, notionActions.run, { installationId: installation._id });
    return true;
  },
});

export const failSetup = internalMutation({
  args: { installationId: v.id("notionInstallations"), expectedGeneration: v.number(), errorCode: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const installation = await ctx.db.get("notionInstallations", args.installationId);
    if (!installation || installation.generation !== args.expectedGeneration || installation.status !== "setting_up") return false;
    await ctx.db.patch(installation._id, { status: "setup_failed", generation: installation.generation + 1, errorCode: args.errorCode, updatedAt: args.now });
    return true;
  },
});

export const claimJob = internalMutation({
  args: { installationId: v.id("notionInstallations"), now: v.number() },
  handler: async (ctx, args) => {
    const installation = await ctx.db.get("notionInstallations", args.installationId);
    if (!installation || installation.status !== "active" || installation.controlBusy) return null;
    let slots = await ctx.db.query("notionProcessingSlots").withIndex("by_slot").take(MAX_GLOBAL_LEASES);
    for (const expired of slots.filter((slot) => slot.leaseUntil <= args.now)) await recoverExpiredLease(ctx, expired.installationId, expired.leaseId, args.now);
    slots = await ctx.db.query("notionProcessingSlots").withIndex("by_slot").take(MAX_GLOBAL_LEASES);
    const remainingSlots = slots.filter((slot) => slot.leaseUntil > args.now && slot.installationId !== installation._id);
    if (slots.some((slot) => slot.installationId === installation._id && slot.leaseUntil > args.now)) return null;
    if (remainingSlots.length >= MAX_GLOBAL_LEASES) {
      const nearest = Math.min(...remainingSlots.map((slot) => slot.leaseUntil));
      await ctx.scheduler.runAfter(Math.max(1_000, nearest - args.now), notionActions.run, { installationId: installation._id });
      return null;
    }
    const jobs = await ctx.db.query("notionJobs").withIndex("by_installation_due", (q) => q.eq("installationId", installation._id).lte("dueAt", args.now)).take(10);
    const job = jobs.find((row) => row.leaseUntil === undefined || row.leaseUntil <= args.now);
    if (!job) {
      const next = await ctx.db.query("notionJobs").withIndex("by_installation_due", (q) => q.eq("installationId", installation._id)).first();
      if (next && next.dueAt > args.now) await ctx.scheduler.runAfter(next.dueAt - args.now, notionActions.run, { installationId: installation._id });
      return null;
    }
    const slotNumber = [0, 1].find((candidate) => !slots.some((slot) => slot.slot === candidate && slot.leaseUntil > args.now));
    if (slotNumber === undefined) return null;
    const leaseId = `${job._id}:${installation.generation}:${args.now}:${job.attempts}`;
    const leaseUntil = args.now + LEASE_MS;
    await ctx.db.patch(job._id, { leaseId, leaseUntil, leasedGeneration: installation.generation, attempts: job.attempts + 1 });
    await ctx.db.patch(installation._id, { leaseId, leaseUntil });
    await ctx.db.insert("notionProcessingSlots", { slot: slotNumber, installationId: installation._id, jobId: job._id, kind: "review", leaseId, leaseUntil });
    await ctx.scheduler.runAfter(LEASE_MS, internal.notion.recoverLease, { installationId: installation._id, leaseId });
    return {
      installationId: installation._id, workspaceId: installation.workspaceId, ownerId: installation.ownerId,
      jobId: job._id, leaseId, pageId: job.pageId, generation: installation.generation,
      credentialRevision: installation.credentialRevision, credentialEnvelope: installation.credentialEnvelope,
      region: installation.region, status: installation.status,
      claimedRevision: job.revision,
      binding: installation.databaseId && installation.dataSourceId && installation.templatePageId ? {
        templatePageId: installation.templatePageId, databaseId: installation.databaseId, dataSourceId: installation.dataSourceId,
        properties: installation.properties ?? {}, statusLabels: installation.statusLabels ?? { found: "Found", none: "None", unable: "Unable" },
      } : null,
      attempts: job.attempts + 1,
    };
  },
});

export const leaseCurrent = internalQuery({
  args: { installationId: v.id("notionInstallations"), jobId: v.id("notionJobs"), leaseId: v.string(), generation: v.number(), now: v.number() },
  handler: async (ctx, args) => {
    const [installation, job] = await Promise.all([ctx.db.get("notionInstallations", args.installationId), ctx.db.get("notionJobs", args.jobId)]);
    return Boolean(installation && job && installation.status === "active" && !installation.controlBusy &&
      installation.generation === args.generation && installation.leaseId === args.leaseId && (installation.leaseUntil ?? 0) > args.now && job.installationId === installation._id &&
      job.leaseId === args.leaseId && job.leasedGeneration === args.generation && (job.leaseUntil ?? 0) > args.now);
  },
});

export const completeFingerprint = internalMutation({
  args: { installationId: v.id("notionInstallations"), jobId: v.id("notionJobs"), leaseId: v.string(), generation: v.number(), claimedRevision: v.number(), fingerprint: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const [installation, job] = await Promise.all([ctx.db.get("notionInstallations", args.installationId), ctx.db.get("notionJobs", args.jobId)]);
    if (!installation || !job || installation.status !== "active" || installation.controlBusy || installation.generation !== args.generation ||
      installation.leaseId !== args.leaseId || (installation.leaseUntil ?? 0) <= args.now || job.leaseId !== args.leaseId || job.leasedGeneration !== args.generation || (job.leaseUntil ?? 0) <= args.now || job.revision !== args.claimedRevision) return false;
    const existing = await ctx.db.query("notionFingerprints").withIndex("by_installation_page", (q) => q.eq("installationId", installation._id).eq("pageId", job.pageId)).unique();
    const value = { installationId: installation._id, pageId: job.pageId, region: installation.region, fingerprint: args.fingerprint, completedAt: args.now };
    if (existing) await ctx.db.patch(existing._id, value);
    else {
      let fingerprintCount = installation.fingerprintCount;
      if (fingerprintCount >= MAX_FINGERPRINTS) {
        const oldest = await ctx.db.query("notionFingerprints").withIndex("by_installation_completed", (q) => q.eq("installationId", installation._id)).first();
        if (oldest) {
          await ctx.db.delete(oldest._id);
          fingerprintCount = Math.max(0, fingerprintCount - 1);
        }
      }
      await ctx.db.insert("notionFingerprints", value);
      await ctx.db.patch(installation._id, { fingerprintCount: fingerprintCount + 1 });
    }
    return true;
  },
});

export const getFingerprint = internalQuery({
  args: { installationId: v.id("notionInstallations"), pageId: v.string(), region: regionValidator },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("notionFingerprints").withIndex("by_installation_page", (q) => q.eq("installationId", args.installationId).eq("pageId", args.pageId)).unique();
    return row?.region === args.region ? row.fingerprint : null;
  },
});

export const finishJob = internalMutation({
  args: { installationId: v.id("notionInstallations"), jobId: v.id("notionJobs"), leaseId: v.string(), claimedRevision: v.number(), result: v.union(v.literal("success"), v.literal("retry"), v.literal("failed")), now: v.number(), retryAt: v.optional(v.number()), errorCode: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const [installation, job] = await Promise.all([ctx.db.get("notionInstallations", args.installationId), ctx.db.get("notionJobs", args.jobId)]);
    if (!installation || !job || job.leaseId !== args.leaseId || installation.leaseId !== args.leaseId || (installation.leaseUntil ?? 0) <= args.now || (job.leaseUntil ?? 0) <= args.now) return { finished: false as const };
    const slot = await ctx.db.query("notionProcessingSlots").withIndex("by_slot").take(MAX_GLOBAL_LEASES);
    for (const row of slot) if (row.leaseId === args.leaseId) await ctx.db.delete(row._id);
    const newerInputArrived = job.revision > args.claimedRevision;
    // Resume may arrive before the invalidated review drains; keep its job in either case.
    const pausedReview = installation.generation !== job.leasedGeneration &&
      (installation.status === "paused" || installation.controlAction === "resume") && !installation.disconnectAfterDrain;
    const structuralFailure = !newerInputArrived && args.result === "failed" &&
      (args.errorCode === "invalid_config" || args.errorCode === "missing_property") &&
      installation.status === "active" && !installation.controlBusy && installation.generation === job.leasedGeneration &&
      !installation.pendingCredentialEnvelope && !installation.disconnectAfterDrain;
    const retryJob = args.result === "retry" && installation.status === "active";
    if (newerInputArrived || pausedReview) {
      await ctx.db.patch(job._id, { dueAt: Math.min(job.dueAt, args.now), leaseId: undefined, leaseUntil: undefined, leasedGeneration: undefined, touchedAt: args.now });
    } else if (structuralFailure) {
      await ctx.db.patch(job._id, { leaseId: undefined, leaseUntil: undefined, leasedGeneration: undefined, touchedAt: args.now });
    } else if (retryJob) {
      await ctx.db.patch(job._id, { dueAt: Math.max(args.retryAt ?? args.now + 5_000, args.now + 1_000), leaseId: undefined, leaseUntil: undefined, leasedGeneration: undefined, touchedAt: args.now });
    } else {
      await ctx.db.delete(job._id);
    }
    const pendingCredentials = installation.pendingCredentialEnvelope;
    const disconnecting = installation.disconnectAfterDrain || installation.status === "disconnecting";
    const nextStatus = disconnecting ? "disconnecting" : structuralFailure ? "setup_failed" : pendingCredentials || installation.controlAction === "setup" ? "setting_up" : installation.controlAction === "resume" ? "active" : installation.status;
    await ctx.db.patch(installation._id, {
      leaseId: undefined, leaseUntil: undefined,
      controlBusy: nextStatus === "setting_up" || disconnecting,
      controlAction: disconnecting ? "disconnect" : nextStatus === "setting_up" ? "setup" : undefined,
      pendingCount: Math.max(0, installation.pendingCount - (newerInputArrived || pausedReview || structuralFailure || retryJob ? 0 : 1)),
      ...(pendingCredentials ? { credentialEnvelope: pendingCredentials, credentialRevision: installation.credentialRevision + 1, pendingCredentialEnvelope: undefined, status: nextStatus } : {}),
      ...(!pendingCredentials && installation.controlAction ? { status: nextStatus } : {}),
      ...(args.result === "failed" && args.errorCode ? { errorCode: args.errorCode } : {}), updatedAt: args.now,
      ...(structuralFailure ? { status: "setup_failed", generation: installation.generation + 1, controlBusy: false, controlAction: undefined } : {}),
    });
    if (disconnecting) await ctx.scheduler.runAfter(0, notionActions.disconnect, { installationId: installation._id });
    else if (pendingCredentials) await ctx.scheduler.runAfter(0, notionActions.setup, { installationId: installation._id, expectedGeneration: installation.generation });
    else if (installation.controlAction === "setup") await ctx.scheduler.runAfter(0, notionActions.setup, { installationId: installation._id, expectedGeneration: installation.generation });
    else if (installation.status === "active" || installation.controlAction === "resume") await ctx.scheduler.runAfter(0, notionActions.run, { installationId: installation._id });
    if (args.result === "retry" && installation.status === "active") await ctx.scheduler.runAfter(Math.max(1_000, (args.retryAt ?? args.now + 5_000) - args.now), notionActions.run, { installationId: installation._id });
    if (args.result !== "retry") {
      const active = await ctx.db.query("notionInstallations").withIndex("by_status", (q) => q.eq("status", "active")).take(MAX_INSTALLATIONS);
      for (const candidate of active) {
        const due = await ctx.db.query("notionJobs").withIndex("by_installation_due", (q) => q.eq("installationId", candidate._id).lte("dueAt", args.now)).first();
        if (due && candidate._id !== installation._id) await ctx.scheduler.runAfter(0, notionActions.run, { installationId: candidate._id });
      }
    }
    return { finished: true as const };
  },
});

export const claimRefresh = internalMutation({
  args: { installationId: v.id("notionInstallations"), expectedRevision: v.number(), now: v.number() },
  handler: async (ctx, args) => {
    const installation = await ctx.db.get("notionInstallations", args.installationId);
    if (!installation) return { result: "missing" as const };
    if (installation.credentialRevision !== args.expectedRevision) return { result: "revision_changed" as const };
    if (installation.status === "disconnecting" || installation.pendingCredentialEnvelope) return { result: "status_blocked" as const };
    if (installation.refreshAttemptRevision === args.expectedRevision) return { result: "already_attempted" as const };
    await ctx.db.patch(installation._id, { refreshAttemptRevision: args.expectedRevision, refreshLeaseUntil: args.now + LEASE_MS });
    return { result: "claimed" as const, revision: installation.credentialRevision, envelope: installation.credentialEnvelope };
  },
});

export const rotateCredentials = internalMutation({
  args: { installationId: v.id("notionInstallations"), expectedRevision: v.number(), nextEnvelope: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const installation = await ctx.db.get("notionInstallations", args.installationId);
    if (!installation) return { result: "missing" as const };
    if (installation.credentialRevision !== args.expectedRevision) return { result: "revision_changed" as const };
    await ctx.db.patch(installation._id, { credentialEnvelope: args.nextEnvelope, credentialRevision: installation.credentialRevision + 1, refreshLeaseUntil: undefined, refreshAttemptRevision: undefined, updatedAt: args.now });
    return { result: "rotated" as const, revision: installation.credentialRevision + 1 };
  },
});

export const failRefresh = internalMutation({
  args: { installationId: v.id("notionInstallations"), expectedRevision: v.number(), now: v.number() },
  handler: async (ctx, args) => {
    const installation = await ctx.db.get("notionInstallations", args.installationId);
    if (!installation || installation.credentialRevision !== args.expectedRevision) return false;
    if (installation.status === "disconnecting" || installation.pendingCredentialEnvelope) return false;
    await ctx.db.patch(installation._id, { status: "needs_reconnect", generation: installation.generation + 1, errorCode: "access_revoked", refreshLeaseUntil: undefined, updatedAt: args.now });
    return true;
  },
});

export const takeReviewQuota = internalMutation({
  args: { installationId: v.id("notionInstallations"), now: v.number() },
  handler: async (ctx, args) => {
    const installation = await ctx.db.get("notionInstallations", args.installationId);
    const day = budgetDay(args.now);
    const retryAt = (day + 1) * DAY;
    if (!installation || installation.status !== "active" || installation.controlBusy) return { allowed: false as const, retryAt: args.now, used: 0, globalUsed: 0 };
    const [local, global] = await Promise.all([
      ctx.db.query("notionQuotas").withIndex("by_installation_day", (q) => q.eq("installationId", installation._id).eq("day", day)).unique(),
      ctx.db.query("notionGlobalQuotas").withIndex("by_day", (q) => q.eq("day", day)).unique(),
    ]);
    const used = local?.used ?? 0;
    const globalUsed = global?.used ?? 0;
    if (used >= PER_INSTALLATION_DAILY || globalUsed >= GLOBAL_DAILY) return { allowed: false as const, retryAt, used, globalUsed };
    if (local) await ctx.db.patch(local._id, { used: used + 1 });
    else await ctx.db.insert("notionQuotas", { installationId: installation._id, day, used: 1 });
    if (global) await ctx.db.patch(global._id, { used: globalUsed + 1 });
    else await ctx.db.insert("notionGlobalQuotas", { day, used: 1 });
    return { allowed: true as const, retryAt, used: used + 1, globalUsed: globalUsed + 1 };
  },
});

export const budget = internalQuery({
  args: { installationId: v.id("notionInstallations"), now: v.number() },
  handler: async (ctx, args) => {
    const installation = await ctx.db.get("notionInstallations", args.installationId);
    const day = budgetDay(args.now);
    const retryAt = (day + 1) * DAY;
    if (!installation) return { allowed: false, retryAt, used: 0, globalUsed: 0 };
    const [local, global] = await Promise.all([
      ctx.db.query("notionQuotas").withIndex("by_installation_day", (q) => q.eq("installationId", installation._id).eq("day", day)).unique(),
      ctx.db.query("notionGlobalQuotas").withIndex("by_day", (q) => q.eq("day", day)).unique(),
    ]);
    const used = local?.used ?? 0;
    const globalUsed = global?.used ?? 0;
    return {
      allowed: installation.status === "active" && !installation.controlBusy && used < PER_INSTALLATION_DAILY && globalUsed < GLOBAL_DAILY,
      retryAt,
      used,
      globalUsed,
    };
  },
});

export const claimDisconnect = internalMutation({
  args: { installationId: v.id("notionInstallations"), now: v.number() },
  handler: async (ctx, args) => {
    const installation = await ctx.db.get("notionInstallations", args.installationId);
    if (!installation || installation.status !== "disconnecting" || (installation.leaseUntil !== undefined && installation.leaseUntil > args.now)) return null;
    let slots = await ctx.db.query("notionProcessingSlots").withIndex("by_slot").take(MAX_GLOBAL_LEASES);
    for (const expired of slots.filter((slot) => slot.leaseUntil <= args.now)) await recoverExpiredLease(ctx, expired.installationId, expired.leaseId, args.now);
    slots = await ctx.db.query("notionProcessingSlots").withIndex("by_slot").take(MAX_GLOBAL_LEASES);
    const live = slots.filter((slot) => slot.leaseUntil > args.now);
    if (live.length >= MAX_GLOBAL_LEASES) {
      const nearest = Math.min(...live.map((slot) => slot.leaseUntil));
      await ctx.scheduler.runAfter(Math.max(1_000, nearest - args.now), notionActions.disconnect, { installationId: installation._id });
      return null;
    }
    const used = new Set(live.map((slot) => slot.slot));
    const slotNumber = [0, 1].find((candidate) => !used.has(candidate));
    if (slotNumber === undefined) return null;
    const leaseId = `${installation._id}:disconnect:${args.now}:${installation.generation}`;
    const leaseUntil = args.now + LEASE_MS;
    await ctx.db.patch(installation._id, { leaseId, leaseUntil, controlBusy: true });
    const existing = await ctx.db.query("notionJobs").withIndex("by_installation_page", (q) => q.eq("installationId", installation._id).eq("pageId", "__disconnect__")).unique();
    const jobId = existing?._id ?? await ctx.db.insert("notionJobs", { installationId: installation._id, pageId: "__disconnect__", dueAt: args.now, attempts: 0, revision: 1, touchedAt: args.now });
    await ctx.db.patch(jobId, { attempts: (existing?.attempts ?? 0) + 1, leaseId, leaseUntil, leasedGeneration: installation.generation });
    await ctx.db.insert("notionProcessingSlots", { slot: slotNumber, installationId: installation._id, jobId, kind: "disconnect", leaseId, leaseUntil });
    await ctx.scheduler.runAfter(LEASE_MS, internal.notion.recoverLease, { installationId: installation._id, leaseId });
    return { leaseId, workspaceId: installation.workspaceId, ownerId: installation.ownerId, credentialEnvelope: installation.credentialEnvelope, credentialRevision: installation.credentialRevision };
  },
});

export const finishDisconnect = internalMutation({
  args: { installationId: v.id("notionInstallations"), leaseId: v.string(), permissionRemoved: v.boolean(), now: v.number() },
  handler: async (ctx, args) => {
    const installation = await ctx.db.get("notionInstallations", args.installationId);
    if (!installation || installation.status !== "disconnecting" || installation.leaseId !== args.leaseId || installation.leaseUntil === undefined || installation.leaseUntil <= args.now) return false;
    const slots = await ctx.db.query("notionProcessingSlots").withIndex("by_slot").take(MAX_GLOBAL_LEASES);
    const slot = slots.find((row) => row.leaseId === args.leaseId);
    for (const slot of slots) if (slot.leaseId === args.leaseId) await ctx.db.delete(slot._id);
    // Keep the installation and its binding until every bounded child batch is gone.
    const [sessions, events, jobs, fingerprints, quotas, oauth] = await Promise.all([
      ctx.db.query("notionSessions").withIndex("by_installation", (q) => q.eq("installationId", installation._id)).take(100),
      ctx.db.query("notionEvents").withIndex("by_installation_expiry", (q) => q.eq("installationId", installation._id)).take(100),
      ctx.db.query("notionJobs").withIndex("by_installation_due", (q) => q.eq("installationId", installation._id)).take(100),
      ctx.db.query("notionFingerprints").withIndex("by_installation_page", (q) => q.eq("installationId", installation._id)).take(100),
      ctx.db.query("notionQuotas").withIndex("by_installation_day", (q) => q.eq("installationId", installation._id)).take(100),
      ctx.db.query("notionOAuthPending").withIndex("by_installation", (q) => q.eq("installationId", installation._id)).take(100),
    ]);
    for (const row of [...events, ...jobs, ...fingerprints, ...quotas, ...oauth]) await ctx.db.delete(row._id);
    if ([events, jobs, fingerprints, quotas, oauth].some((rows) => rows.length === 100)) {
      const renewedUntil = Date.now() + LEASE_MS;
      await ctx.db.patch(installation._id, { leaseUntil: renewedUntil });
      if (slot) await ctx.db.insert("notionProcessingSlots", { slot: slot.slot, installationId: installation._id, kind: "disconnect", leaseId: args.leaseId, leaseUntil: renewedUntil });
      await ctx.scheduler.runAfter(0, internal.notion.finishDisconnect, { installationId: installation._id, leaseId: args.leaseId, permissionRemoved: args.permissionRemoved, now: Date.now() });
      return true;
    }
    for (const session of sessions) {
      const prior = await ctx.db.query("notionDisconnectReceipts").withIndex("by_sessionHash", (q) => q.eq("sessionHash", session.sessionHash)).unique();
      if (prior) await ctx.db.patch(prior._id, { permissionRemoved: args.permissionRemoved, expiresAt: args.now + DISCONNECT_RECEIPT_TTL });
      else await ctx.db.insert("notionDisconnectReceipts", { sessionHash: session.sessionHash, permissionRemoved: args.permissionRemoved, expiresAt: args.now + DISCONNECT_RECEIPT_TTL });
      await ctx.db.delete(session._id);
    }
    await ctx.db.delete(installation._id);
    return true;
  },
});

async function cleanupExpiredRows(ctx: MutationCtx, now: number): Promise<void> {
  const oauth = await ctx.db.query("notionOAuthPending").withIndex("by_expiresAt", (q) => q.lte("expiresAt", now)).take(100);
  const sessions = await ctx.db.query("notionSessions").withIndex("by_expiresAt", (q) => q.lte("expiresAt", now)).take(100);
  const receipts = await ctx.db.query("notionDisconnectReceipts").withIndex("by_expiresAt", (q) => q.lte("expiresAt", now)).take(100);
  const events = await ctx.db.query("notionEvents").withIndex("by_expiry", (q) => q.lte("expiresAt", now)).take(100);
  const oldDay = budgetDay(now) - 1;
  const quotas = await ctx.db.query("notionQuotas").withIndex("by_day", (q) => q.lt("day", oldDay)).take(100);
  const globalQuotas = await ctx.db.query("notionGlobalQuotas").withIndex("by_day", (q) => q.lt("day", oldDay)).take(100);
  const eventCounts = new Map<InstallationId, number>();
  for (const event of events) eventCounts.set(event.installationId, (eventCounts.get(event.installationId) ?? 0) + 1);
  for (const [installationId, count] of eventCounts) {
    const installation = await ctx.db.get("notionInstallations", installationId);
    if (installation) await ctx.db.patch(installationId, { eventCount: Math.max(0, installation.eventCount - count) });
  }
  for (const row of [...oauth, ...sessions, ...receipts, ...events, ...quotas, ...globalQuotas]) await ctx.db.delete(row._id);
  let more = [oauth, sessions, receipts, events, quotas, globalQuotas].some((rows) => rows.length === 100);
  const expiredSlots = await ctx.db.query("notionProcessingSlots").withIndex("by_leaseUntil", (q) => q.lte("leaseUntil", now)).take(MAX_GLOBAL_LEASES);
  for (const slot of expiredSlots) await recoverExpiredLease(ctx, slot.installationId, slot.leaseId, now);
  if (expiredSlots.length === MAX_GLOBAL_LEASES) more = true;
  if (more) await ctx.scheduler.runAfter(1_000, internal.notion.cleanupScheduled, {});
}

export const cleanup = internalMutation({
  args: { now: v.number() },
  handler: (ctx, args) => cleanupExpiredRows(ctx, args.now),
});

export const cleanupScheduled = internalMutation({
  args: {},
  handler: (ctx) => cleanupExpiredRows(ctx, Date.now()),
});
