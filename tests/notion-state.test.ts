import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, internal } from "@backend/api";
import { createBackend } from "./backend-harness";

const secret = "notion-test-server-secret";
const now = Date.UTC(2026, 9, 10, 12);
const envelope = "v1.aW5pdGlhbGl6YXRpb24.Y3lwaGVydGV4dA.dGFn";
const hex = (char: string) => char.repeat(64);

const binding = {
  templatePageId: "template",
  databaseId: "database",
  dataSourceId: "source",
  properties: { item: { id: "item-prop", kind: "title" as const } },
  statusLabels: { found: "Found", none: "None", unable: "Unable" },
};

async function authorize(t: ReturnType<typeof createBackend>, ownerId: string, workspaceId: string, botId: string, at = now) {
  return t.mutation(api.notion.authorize, {
    secret, ownerId, workspaceId, botId, templatePageId: "template", region: "UK", credentialEnvelope: envelope, now: at,
  });
}

async function active(t: ReturnType<typeof createBackend>, ownerId: string, at = now, list = binding) {
  const created = await authorize(t, ownerId, `${ownerId}-workspace`, `${ownerId}-bot`, at);
  await t.mutation(internal.notion.bindInstallation, { installationId: created.installationId, expectedGeneration: created.generation, binding: list, now: at });
  const setup = await t.mutation(internal.notion.claimSetup, { installationId: created.installationId, expectedGeneration: created.generation, now: at });
  if (setup.result !== "claimed") throw new Error("Setup lease was not claimed");
  await t.mutation(internal.notion.ready, { installationId: created.installationId, expectedGeneration: created.generation, leaseId: setup.leaseId, pageIds: [], now: at });
  return created;
}

async function enqueue(t: ReturnType<typeof createBackend>, ownerId: string, eventHash: string, pageId: string, at: number, list = binding) {
  return t.mutation(api.notion.receiveWebhook, {
    secret, workspaceId: `${ownerId}-workspace`, botIds: [`${ownerId}-bot`], databaseId: list.databaseId,
    dataSourceId: list.dataSourceId, pageId, eventHash: hex(eventHash), type: "page.created", updatedProperties: [], now: at,
  });
}

describe("managed Notion D1 state", () => {
  beforeEach(() => { process.env.BACKEND_SECRET = secret; });
  afterEach(() => { vi.useRealTimers(); });

  it("keeps OAuth state single-use, expiring it and not consuming it for a wrong binding", async () => {
    const t = createBackend();
    await t.mutation(api.notion.beginOAuth, { secret, stateHash: hex("a"), bindingHash: hex("b"), region: "UK", now });
    expect(await t.mutation(api.notion.consumeOAuth, { secret, stateHash: hex("a"), bindingHash: hex("c"), now: now + 1 })).toBeNull();
    expect(await t.mutation(api.notion.consumeOAuth, { secret, stateHash: hex("a"), bindingHash: hex("b"), now: now + 1 })).toEqual({ region: "UK", installationId: null });
    expect(await t.mutation(api.notion.consumeOAuth, { secret, stateHash: hex("a"), bindingHash: hex("b"), now: now + 2 })).toBeNull();

    await t.mutation(api.notion.beginOAuth, { secret, stateHash: hex("d"), bindingHash: hex("e"), region: "US", now });
    expect(await t.mutation(api.notion.consumeOAuth, { secret, stateHash: hex("d"), bindingHash: hex("e"), now: now + 10 * 60_000 })).toBeNull();
  });

  it("enforces expected ownership, reuses an owner's installation, and preserves the original template after binding", async () => {
    const t = createBackend();
    const created = await authorize(t, "owner-a", "workspace-a", "bot-a");
    const other = await authorize(t, "owner-b", "workspace-b", "bot-b");
    await t.mutation(internal.notion.bindInstallation, {
      installationId: created.installationId, expectedGeneration: created.generation, binding, now,
    });
    const before = await t.run((ctx) => ctx.db.get(created.installationId));
    await expect(t.mutation(api.notion.authorize, {
      secret, ownerId: "owner-a", workspaceId: "workspace-a", botId: "bot-a", region: "US",
      templatePageId: "new-oauth-duplicate", credentialEnvelope: envelope, now: now + 1,
      expectedInstallationId: other.installationId,
    })).rejects.toThrow();
    expect(await t.run((ctx) => ctx.db.get(created.installationId))).toEqual(before);

    const reauthorized = await t.mutation(api.notion.authorize, {
      secret, ownerId: "owner-a", workspaceId: "workspace-a", botId: "bot-a", region: "US",
      templatePageId: "new-oauth-duplicate", credentialEnvelope: "v1.bmV3aXY.bmV3Y2lwaGVydGV4dA.bmV3dGFn", now: now + 2,
      expectedInstallationId: created.installationId,
    });
    const after = await t.run((ctx) => ctx.db.get(created.installationId));
    expect(reauthorized.generation).toBe(created.generation + 1);
    expect(after?.templatePageId).toBe("template");
    expect(after?.credentialEnvelope).not.toBe(envelope);
  });

  it("reserves bindings while setup is pending and disconnecting, releasing only after removal", async () => {
    const t = createBackend();
    const first = await authorize(t, "owner-a", "workspace-a", "bot-a");
    const second = await authorize(t, "owner-b", "workspace-b", "bot-b");
    await t.mutation(internal.notion.bindInstallation, { installationId: first.installationId, expectedGeneration: first.generation, binding, now });
    await expect(t.mutation(internal.notion.bindInstallation, {
      installationId: second.installationId, expectedGeneration: second.generation,
      binding: { ...binding, templatePageId: "other-template" }, now,
    })).rejects.toThrow(/reserved/);

    const sessionHash = hex("f");
    const csrfHash = hex("0");
    await t.mutation(api.notion.createSession, {
      secret, sessionHash, csrfHash, installationId: first.installationId, expiresAt: now + 30 * 86_400_000, now,
    });
    await t.mutation(api.notion.control, { secret, sessionHash, csrfHash, action: "disconnect", now: now + 1 });
    const disconnecting = await t.run((ctx) => ctx.db.get(first.installationId));
    expect(disconnecting?.status).toBe("disconnecting");
    await expect(t.mutation(internal.notion.bindInstallation, {
      installationId: second.installationId, expectedGeneration: second.generation,
      binding: { ...binding, templatePageId: "other-template" }, now: now + 2,
    })).rejects.toThrow(/reserved/);

    const claim = await t.mutation(internal.notion.claimDisconnect, { installationId: first.installationId, now: now + 2 });
    expect(claim).not.toBeNull();
    await t.mutation(internal.notion.finishDisconnect, {
      installationId: first.installationId, leaseId: claim!.leaseId, permissionRemoved: true, now: now + 3,
    });
    await t.mutation(internal.notion.bindInstallation, {
      installationId: second.installationId, expectedGeneration: second.generation,
      binding: { ...binding, templatePageId: "other-template" }, now: now + 4,
    });
    expect(await t.query(api.notion.disconnectReceipt, { secret, sessionHash, now: now + 4 })).toEqual({ permissionRemoved: true });
  });

  it("reports reviews unavailable while installation controls are busy", async () => {
    const t = createBackend();
    const installation = await active(t, "busy-budget");
    const sessionHash = hex("a"), csrfHash = hex("b");
    await t.mutation(api.notion.createSession, { secret, sessionHash, csrfHash, installationId: installation.installationId, expiresAt: now + 86_400_000, now });
    await t.run((ctx) => ctx.db.patch(installation.installationId, { controlBusy: true }));
    expect(await t.query(api.notion.management, { secret, sessionHash, now })).toMatchObject({ busy: true, budget: { allowed: false } });
    expect(await t.mutation(internal.notion.takeReviewQuota, { installationId: installation.installationId, now })).toMatchObject({ allowed: false, used: 0 });
  });

  it("exposes budget without spending quota and spends quota atomically within both limits", async () => {
    const t = createBackend();
    const installation = await authorize(t, "owner-a", "workspace-a", "bot-a");
    await t.mutation(internal.notion.bindInstallation, { installationId: installation.installationId, expectedGeneration: installation.generation, binding, now });
    const ready = await t.mutation(internal.notion.claimSetup, { installationId: installation.installationId, expectedGeneration: installation.generation, now });
    expect(ready.result).toBe("claimed");
    await t.mutation(internal.notion.ready, { installationId: installation.installationId, expectedGeneration: installation.generation, leaseId: ready.result === "claimed" ? ready.leaseId : "", pageIds: [], now });

    expect(await t.query(internal.notion.budget, { installationId: installation.installationId, now })).toEqual({ allowed: true, retryAt: (Math.floor(now / 86_400_000) + 1) * 86_400_000, used: 0, globalUsed: 0 });
    const results = await Promise.all(Array.from({ length: 101 }, () => t.mutation(internal.notion.takeReviewQuota, { installationId: installation.installationId, now })));
    expect(results.filter((item) => item.allowed)).toHaveLength(100);
    expect(results.filter((item) => !item.allowed)).toHaveLength(1);
    expect(await t.query(internal.notion.budget, { installationId: installation.installationId, now })).toMatchObject({ allowed: false, used: 100, globalUsed: 100 });
  });

  it("expires and removes hashed management sessions and never exposes the credential envelope", async () => {
    const t = createBackend();
    const installation = await authorize(t, "owner-a", "workspace-a", "bot-a");
    const sessionHash = hex("1");
    await t.mutation(api.notion.createSession, { secret, sessionHash, csrfHash: hex("2"), installationId: installation.installationId, expiresAt: now + 100, now });
    const management = await t.query(api.notion.management, { secret, sessionHash, now: now + 1 });
    expect(management?.installation).toEqual({ id: installation.installationId, region: "UK", status: "setting_up" });
    expect(JSON.stringify(management)).not.toContain("credentialEnvelope");
    expect(await t.query(api.notion.management, { secret, sessionHash, now: now + 100 })).toBeNull();
  });

  it("retains webhook events received after setup listing but before activation", async () => {
    const t = createBackend();
    const created = await authorize(t, "setup-race", "setup-race-workspace", "setup-race-bot");
    await t.mutation(internal.notion.bindInstallation, { installationId: created.installationId, expectedGeneration: created.generation, binding, now });
    const accepted = await enqueue(t, "setup-race", "a", "created-during-setup", now + 1);
    expect(accepted.result).toBe("accepted");
    const setup = await t.mutation(internal.notion.claimSetup, { installationId: created.installationId, expectedGeneration: created.generation, now: now + 2 });
    if (setup.result !== "claimed") throw new Error("Setup lease was not claimed");
    const scheduledBeforeReady = await t.scheduledJobs();
    await t.mutation(internal.notion.ready, { installationId: created.installationId, expectedGeneration: created.generation, leaseId: setup.leaseId, pageIds: ["seed-row"], now: now + 3 });
    const scheduledAfterReady = await t.scheduledJobs();
    expect(scheduledAfterReady.length).toBeGreaterThan(scheduledBeforeReady.length);
    const jobs = await t.run((ctx) => ctx.db.query("notionJobs").withIndex("by_installation_due", (q) => q.eq("installationId", created.installationId)).collect());
    expect(jobs.map((job) => job.pageId)).toEqual(expect.arrayContaining(["created-during-setup", "seed-row"]));
    expect(await t.run((ctx) => ctx.db.get(created.installationId))).toMatchObject({ eventCount: 1, pendingCount: 2, status: "active" });

    const unbound = await authorize(t, "unbound-race", "unbound-race-workspace", "unbound-race-bot");
    const retry = await t.mutation(api.notion.receiveWebhook, {
      secret, workspaceId: "unbound-race-workspace", botIds: ["unbound-race-bot"], databaseId: "not-yet-discovered",
      pageId: "early-row", eventHash: hex("b"), type: "page.created", updatedProperties: [], now: now + 4,
    });
    expect(retry).toEqual({ result: "setting_up" });
    expect(await t.run((ctx) => ctx.db.get(unbound.installationId))).toMatchObject({ pendingCount: 0, eventCount: 0 });
  });

  it("matches URL-encoded Notion property IDs after normalizing both stored and webhook IDs", async () => {
    const t = createBackend();
    const encodedBinding = { ...binding, properties: { item: { id: "item%3Aprop", kind: "title" as const } } };
    await active(t, "encoded-ids", now, encodedBinding);
    const accepted = await t.mutation(api.notion.receiveWebhook, {
      secret, workspaceId: "encoded-ids-workspace", botIds: ["encoded-ids-bot"], databaseId: encodedBinding.databaseId,
      dataSourceId: encodedBinding.dataSourceId, pageId: "encoded-row", eventHash: hex("c"), type: "page.properties_updated",
      updatedProperties: ["item%3Aprop"], now: now + 1,
    });
    expect(accepted.result).toBe("accepted");
    const ignored = await t.mutation(api.notion.receiveWebhook, {
      secret, workspaceId: "encoded-ids-workspace", botIds: ["encoded-ids-bot"], databaseId: encodedBinding.databaseId,
      dataSourceId: encodedBinding.dataSourceId, pageId: "output-only-row", eventHash: hex("d"), type: "page.properties_updated",
      updatedProperties: ["review%3Astatus"], now: now + 2,
    });
    expect(ignored.result).toBe("unmatched");
  });

  it("enforces one lease per installation and two global slots while preserving input that arrives during a lease", async () => {
    const t = createBackend();
    const list = (suffix: string) => ({ ...binding, databaseId: `db-${suffix}`, dataSourceId: `source-${suffix}` });
    const a = await active(t, "lease-a", now, list("a"));
    const b = await active(t, "lease-b", now, list("b"));
    const c = await active(t, "lease-c", now, list("c"));
    await enqueue(t, "lease-a", "a", "same-page", now + 1, list("a"));
    await enqueue(t, "lease-b", "b", "b-page", now + 1, list("b"));
    await enqueue(t, "lease-c", "c", "c-page", now + 1, list("c"));
    const first = await t.mutation(internal.notion.claimJob, { installationId: a.installationId, now: now + 2 });
    expect(first).not.toBeNull();
    expect(await t.mutation(internal.notion.claimJob, { installationId: a.installationId, now: now + 3 })).toBeNull();
    const second = await t.mutation(internal.notion.claimJob, { installationId: b.installationId, now: now + 3 });
    expect(second).not.toBeNull();
    expect(await t.mutation(internal.notion.claimJob, { installationId: c.installationId, now: now + 4 })).toBeNull();
    expect(await t.run((ctx) => ctx.db.query("notionProcessingSlots").collect())).toHaveLength(2);

    await enqueue(t, "lease-a", "d", "same-page", now + 5, list("a"));
    await t.mutation(internal.notion.finishJob, {
      installationId: first!.installationId, jobId: first!.jobId, leaseId: first!.leaseId,
      claimedRevision: first!.claimedRevision, result: "success", now: now + 6,
    });
    const retained = await t.run((ctx) => ctx.db.get(first!.jobId));
    expect(retained).toMatchObject({ revision: first!.claimedRevision + 1 });
    expect(retained?.leaseId).toBeUndefined();
    const retried = await t.mutation(internal.notion.claimJob, { installationId: a.installationId, now: now + 7 });
    expect(retried?.claimedRevision).toBe(first!.claimedRevision + 1);
  });

  it.each([
    ["failed", false], ["failed", true],
    ["retry", false], ["retry", true],
    ["success", false], ["success", true],
  ] as const)("retains a paused review finishing with %s, with resume before drain: %s", async (result, resumeBeforeFinish) => {
    const t = createBackend();
    const created = await active(t, "pause-race");
    const sessionHash = hex("3"), csrfHash = hex("4");
    await t.mutation(api.notion.createSession, { secret, sessionHash, csrfHash, installationId: created.installationId, expiresAt: now + 86_400_000, now });
    await enqueue(t, "pause-race", "e", "unfinished-page", now + 1);
    const lease = await t.mutation(internal.notion.claimJob, { installationId: created.installationId, now: now + 2 });
    if (!lease) throw new Error("Job lease was not claimed");

    await t.mutation(api.notion.control, { secret, sessionHash, csrfHash, action: "pause", now: now + 3 });
    expect(await t.query(internal.notion.leaseCurrent, {
      installationId: lease.installationId, jobId: lease.jobId, leaseId: lease.leaseId, generation: lease.generation, now: now + 4,
    })).toBe(false);
    if (resumeBeforeFinish) await t.mutation(api.notion.control, { secret, sessionHash, csrfHash, action: "resume", now: now + 5 });
    expect(await t.mutation(internal.notion.claimJob, { installationId: created.installationId, now: now + 6 })).toBeNull();

    await t.mutation(internal.notion.finishJob, {
      installationId: lease.installationId, jobId: lease.jobId, leaseId: lease.leaseId,
      claimedRevision: lease.claimedRevision, result, now: now + 7,
    });
    const retained = await t.run((ctx) => ctx.db.get(lease.jobId));
    expect(retained).toMatchObject({ pageId: "unfinished-page", revision: lease.claimedRevision });
    expect(retained?.leaseId).toBeUndefined();
    expect(retained?.leaseUntil).toBeUndefined();
    expect(retained?.leasedGeneration).toBeUndefined();
    expect(await t.run((ctx) => ctx.db.get(created.installationId))).toMatchObject({
      status: resumeBeforeFinish ? "active" : "paused", controlBusy: false, pendingCount: 1,
    });
    expect(await t.run((ctx) => ctx.db.query("notionProcessingSlots").collect())).toEqual([]);

    if (!resumeBeforeFinish) await t.mutation(api.notion.control, { secret, sessionHash, csrfHash, action: "resume", now: now + 8 });
    const resumed = await t.mutation(internal.notion.claimJob, { installationId: created.installationId, now: now + 9 });
    if (!resumed) throw new Error("Paused review was not reclaimed after resume");
    expect(resumed).toMatchObject({ jobId: lease.jobId, pageId: lease.pageId, generation: created.generation + 2 });
    expect(await t.mutation(internal.notion.completeFingerprint, {
      installationId: resumed.installationId, jobId: resumed.jobId, leaseId: resumed.leaseId, generation: resumed.generation,
      claimedRevision: resumed.claimedRevision, fingerprint: "completed-review", now: now + 10,
    })).toBe(true);
    await t.mutation(internal.notion.finishJob, {
      installationId: resumed.installationId, jobId: resumed.jobId, leaseId: resumed.leaseId,
      claimedRevision: resumed.claimedRevision, result: "success", now: now + 11,
    });
    expect(await t.run((ctx) => ctx.db.get(resumed.jobId))).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(created.installationId))).toMatchObject({ status: "active", pendingCount: 0 });
    expect(await t.query(internal.notion.getFingerprint, { installationId: resumed.installationId, pageId: resumed.pageId, region: "UK" })).toBe("completed-review");
  });

  it("persists refresh CAS before applying pending reauthorization, even when disconnect is requested", async () => {
    const t = createBackend();
    const created = await active(t, "reauth-race");
    const sessionHash = hex("3"), csrfHash = hex("4");
    await t.mutation(api.notion.createSession, { secret, sessionHash, csrfHash, installationId: created.installationId, expiresAt: now + 30 * 86_400_000, now });
    await enqueue(t, "reauth-race", "e", "token-race-page", now + 1);
    const lease = await t.mutation(internal.notion.claimJob, { installationId: created.installationId, now: now + 2 });
    if (!lease) throw new Error("Job lease was not claimed");
    const refresh = await t.mutation(internal.notion.claimRefresh, { installationId: created.installationId, expectedRevision: lease.credentialRevision, now: now + 2 });
    expect(refresh.result).toBe("claimed");
    const newEnvelope = "v1.bmV3aXY.bmV3Y2lwaGVydGV4dA.bmV3dGFn";
    const reauth = await t.mutation(api.notion.authorize, {
      secret, ownerId: "reauth-race", workspaceId: "reauth-race-workspace", botId: "reauth-race-bot", region: "US",
      credentialEnvelope: newEnvelope, now: now + 3, expectedInstallationId: created.installationId,
    });
    expect(await t.run((ctx) => ctx.db.get(created.installationId))).toMatchObject({ pendingCredentialEnvelope: newEnvelope, credentialRevision: 1 });
    const rotatedEnvelope = "v1.cm90YXRlZGl2.cm90YXRlZGNpcGhlcnRleHQ.cm90YXRlZHRhZw";
    expect(await t.mutation(internal.notion.rotateCredentials, { installationId: created.installationId, expectedRevision: lease.credentialRevision, nextEnvelope: rotatedEnvelope, now: now + 4 })).toMatchObject({ result: "rotated", revision: 2 });
    await t.mutation(api.notion.control, { secret, sessionHash, csrfHash, action: "disconnect", now: now + 5 });
    await t.mutation(internal.notion.finishJob, {
      installationId: lease.installationId, jobId: lease.jobId, leaseId: lease.leaseId,
      claimedRevision: lease.claimedRevision, result: "success", now: now + 6,
    });
    const drained = await t.run((ctx) => ctx.db.get(created.installationId));
    expect(drained).toMatchObject({ status: "disconnecting", credentialEnvelope: newEnvelope, credentialRevision: 3 });
    expect(drained?.pendingCredentialEnvelope).toBeUndefined();
    expect(reauth.generation).toBe(created.generation + 1);
    await expect(t.mutation(api.notion.authorize, {
      secret, ownerId: "reauth-race", workspaceId: "reauth-race-workspace", botId: "reauth-race-bot", region: "UK",
      credentialEnvelope: rotatedEnvelope, now: now + 7, expectedInstallationId: created.installationId,
    })).rejects.toThrow();
  });

  it("pauses a tenant on structural schema errors while retaining its queued review for retry", async () => {
    const t = createBackend();
    const created = await active(t, "structural-error");
    await enqueue(t, "structural-error", "7", "needs-schema-repair", now + 1);
    const lease = await t.mutation(internal.notion.claimJob, { installationId: created.installationId, now: now + 2 });
    if (!lease) throw new Error("Job lease was not claimed");
    await t.mutation(internal.notion.finishJob, {
      installationId: lease.installationId, jobId: lease.jobId, leaseId: lease.leaseId,
      claimedRevision: lease.claimedRevision, result: "failed", errorCode: "missing_property", now: now + 3,
    });
    expect(await t.run((ctx) => ctx.db.get(created.installationId))).toMatchObject({ status: "setup_failed", errorCode: "missing_property", controlBusy: false });
    const retained = await t.run((ctx) => ctx.db.get(lease.jobId));
    expect(retained).toMatchObject({ pageId: "needs-schema-repair" });
    expect(retained?.leaseId).toBeUndefined();
    expect(await t.run((ctx) => ctx.db.get(created.installationId))).toMatchObject({ pendingCount: 1 });
  });

  it("keeps management pending and withholds the disconnect receipt until bounded cleanup completes", async () => {
    const t = createBackend();
    const at = Date.now();
    const created = await authorize(t, "receipt-batch", "receipt-batch-workspace", "receipt-batch-bot", at);
    const sessionHash = hex("8"), csrfHash = hex("9");
    await t.mutation(api.notion.createSession, { secret, sessionHash, csrfHash, installationId: created.installationId, expiresAt: at + 30 * 86_400_000, now: at });
    await t.mutation(api.notion.control, { secret, sessionHash, csrfHash, action: "disconnect", now: at + 1 });
    const claim = await t.mutation(internal.notion.claimDisconnect, { installationId: created.installationId, now: at + 2 });
    if (!claim) throw new Error("Disconnect lease was not claimed");
    await t.run(async (ctx) => {
      for (let index = 0; index < 101; index += 1) {
        await ctx.db.insert("notionEvents", { installationId: created.installationId, eventHash: index.toString(16).padStart(64, "0"), expiresAt: at + 100_000 });
      }
    });
    await t.mutation(internal.notion.finishDisconnect, { installationId: created.installationId, leaseId: claim.leaseId, permissionRemoved: false, now: at + 3 });
    expect(await t.query(api.notion.management, { secret, sessionHash, now: at + 4 })).toMatchObject({ installation: { status: "disconnecting" }, busy: true });
    expect(await t.query(api.notion.disconnectReceipt, { secret, sessionHash, now: at + 4 })).toBeNull();
    await t.mutation(internal.notion.finishDisconnect, { installationId: created.installationId, leaseId: claim.leaseId, permissionRemoved: false, now: at + 5 });
    expect(await t.query(api.notion.management, { secret, sessionHash, now: at + 6 })).toBeNull();
    expect(await t.query(api.notion.disconnectReceipt, { secret, sessionHash, now: at + 6 })).toEqual({ permissionRemoved: false });
  });

  it("recovers expired leases against current pause state and keeps old country fingerprints from suppressing new work", async () => {
    const t = createBackend();
    vi.useFakeTimers();
    const started = Date.now();
    const created = await active(t, "watchdog", started);
    const sessionHash = hex("5"), csrfHash = hex("6");
    await t.mutation(api.notion.createSession, { secret, sessionHash, csrfHash, installationId: created.installationId, expiresAt: started + 30 * 86_400_000, now: started });
    await enqueue(t, "watchdog", "f", "watchdog-page", started + 1);
    const lease = await t.mutation(internal.notion.claimJob, { installationId: created.installationId, now: started + 2 });
    if (!lease) throw new Error("Job lease was not claimed");
    await t.mutation(internal.notion.completeFingerprint, {
      installationId: lease.installationId, jobId: lease.jobId, leaseId: lease.leaseId, generation: lease.generation,
      claimedRevision: lease.claimedRevision, fingerprint: "uk-fingerprint", now: started + 3,
    });
    await t.mutation(api.notion.control, { secret, sessionHash, csrfHash, action: "region", region: "US", now: started + 5 });
    expect(await t.run((ctx) => ctx.db.get(created.installationId))).toMatchObject({ status: "setting_up", region: "US", controlBusy: true });
    await t.mutation(internal.notion.finishJob, { installationId: lease.installationId, jobId: lease.jobId, leaseId: lease.leaseId, claimedRevision: lease.claimedRevision, result: "success", now: started + 6 });
    const setup = await t.mutation(internal.notion.claimSetup, { installationId: created.installationId, expectedGeneration: created.generation + 1, now: started + 6 });
    if (setup.result !== "claimed") throw new Error("Region setup lease was not claimed");
    await t.mutation(internal.notion.ready, { installationId: created.installationId, expectedGeneration: created.generation + 1, leaseId: setup.leaseId, pageIds: [], now: started + 7 });
    expect(await t.query(internal.notion.getFingerprint, { installationId: created.installationId, pageId: "watchdog-page", region: "US" })).toBeNull();
    expect(await t.query(internal.notion.getFingerprint, { installationId: created.installationId, pageId: "watchdog-page", region: "UK" })).toBe("uk-fingerprint");

    await enqueue(t, "watchdog", "9", "watchdog-page", started + 8);
    const crashed = await t.mutation(internal.notion.claimJob, { installationId: created.installationId, now: started + 9 });
    if (!crashed) throw new Error("Second job lease was not claimed");
    await t.mutation(api.notion.control, { secret, sessionHash, csrfHash, action: "pause", now: started + 10 });
    vi.setSystemTime(started + 9 + 120_001);
    await t.mutation(internal.notion.recoverLease, { installationId: crashed.installationId, leaseId: crashed.leaseId });
    const recovered = await t.run((ctx) => ctx.db.get(created.installationId));
    expect(recovered).toMatchObject({ status: "paused", controlBusy: false });
    expect(recovered?.leaseId).toBeUndefined();
    const releasedJob = await t.run((ctx) => ctx.db.get(crashed.jobId));
    expect(releasedJob?.leaseId).toBeUndefined();
    expect(releasedJob?.leaseUntil).toBeUndefined();
    expect(await t.run((ctx) => ctx.db.query("notionProcessingSlots").collect())).toEqual([]);
  });
});
