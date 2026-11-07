import { describe, expect, it } from "vitest";

import type { Id } from "@backend/values";
import {
  transitionControl,
  transitionExpiredLease,
  transitionFinishJob,
  transitionFinishSetup,
  type ExpiredLeaseInput,
  type InstallationState,
  type JobState,
} from "@backend/lib/notion-transitions";

const now = 10_000;
const baseInstallation: InstallationState = {
  status: "active", generation: 4, region: "UK", databaseId: "database", dataSourceId: "source",
  leaseId: "lease-1", leaseUntil: now + 100, pendingCredentialEnvelope: undefined,
  credentialEnvelope: "credential-v1", credentialRevision: 2, refreshLeaseUntil: undefined,
  refreshAttemptRevision: undefined, disconnectAfterDrain: false, controlBusy: true,
  controlAction: undefined, pendingCount: 1, updatedAt: now, errorCode: undefined,
};
const baseJob: JobState = {
  leaseId: "lease-1", leaseUntil: now + 100, leasedGeneration: 4, revision: 3, dueAt: now,
  touchedAt: now,
};

describe("Notion pure state transitions", () => {
  describe("control", () => {
    it.each([
      {
        action: "pause" as const,
        installation: { ...baseInstallation, leaseUntil: now + 1 },
        patch: { status: "paused", generation: 5, controlBusy: true, controlAction: "pause", updatedAt: now },
        commands: [],
      },
      {
        action: "pause" as const,
        installation: { ...baseInstallation, leaseUntil: now },
        patch: { status: "paused", generation: 5, controlBusy: false, controlAction: undefined, updatedAt: now },
        commands: [],
      },
      {
        action: "resume" as const,
        installation: { ...baseInstallation, status: "paused", controlBusy: false, controlAction: undefined, leaseId: undefined, leaseUntil: undefined },
        patch: { status: "active", generation: 5, controlBusy: false, controlAction: undefined, updatedAt: now },
        commands: [{ type: "run", delayMs: 0 }],
      },
      {
        action: "retry" as const,
        installation: { ...baseInstallation, status: "setup_failed", controlBusy: false, leaseId: undefined, leaseUntil: undefined },
        patch: { status: "setting_up", generation: 5, controlBusy: true, controlAction: "setup", updatedAt: now },
        commands: [{ type: "setup", expectedGeneration: 5, delayMs: 0 }],
      },
      {
        action: "region" as const,
        region: "US" as const,
        installation: { ...baseInstallation, leaseUntil: now + 1 },
        patch: { region: "US", status: "setting_up", generation: 5, controlBusy: true, controlAction: "setup", updatedAt: now },
        commands: [],
      },
      {
        action: "disconnect" as const,
        installation: { ...baseInstallation, leaseUntil: undefined },
        patch: { status: "disconnecting", generation: 5, controlBusy: true, controlAction: "disconnect", disconnectAfterDrain: true, updatedAt: now },
        commands: [{ type: "disconnect", delayMs: 0 }],
      },
    ])("applies $action while preserving lease-sensitive scheduling", ({ action, region, installation, patch, commands }) => {
      const result = transitionControl(installation as InstallationState, { type: "control", action, ...(region ? { region } : {}), now });
      expect(result).toEqual({ accepted: true, installationPatch: patch, commands });
    });

    it("rejects controls after disconnect has started", () => {
      expect(transitionControl({ ...baseInstallation, status: "disconnecting" }, { type: "control", action: "resume", now }))
        .toEqual({ accepted: false, installationPatch: {}, commands: [] });
    });
  });

  describe("expired lease", () => {
    it.each([
      {
        name: "does not let an old callback clear a newer installation lease",
        input: { installation: { ...baseInstallation, leaseId: "lease-2", leaseUntil: now + 500 }, job: baseJob, slot: { leaseId: "lease-1", jobId: "job-1" as Id<"notionJobs"> } },
        result: { recoverInstallation: false, deleteSlot: true, jobPatch: { leaseId: undefined, leaseUntil: undefined, leasedGeneration: undefined, dueAt: now, touchedAt: now }, commands: [] },
      },
      {
        name: "clears an expired active lease and schedules the queue",
        input: { installation: { ...baseInstallation, leaseUntil: now }, job: baseJob, slot: { leaseId: "lease-1", jobId: "job-1" as Id<"notionJobs"> } },
        result: { recoverInstallation: true, deleteSlot: true, jobPatch: { leaseId: undefined, leaseUntil: undefined, leasedGeneration: undefined, dueAt: now, touchedAt: now }, installationPatch: { leaseId: undefined, leaseUntil: undefined, status: "active", controlBusy: false, controlAction: undefined, updatedAt: now }, commands: [{ type: "run", delayMs: 0 }] },
      },
      {
        name: "applies pending credentials before deciding what to schedule",
        input: { installation: { ...baseInstallation, status: "setting_up", leaseUntil: now, pendingCredentialEnvelope: "credential-v2", refreshLeaseUntil: now, refreshAttemptRevision: 2 }, job: null, slot: { leaseId: "lease-1" } },
        result: { recoverInstallation: true, deleteSlot: true, installationPatch: { leaseId: undefined, leaseUntil: undefined, credentialEnvelope: "credential-v2", credentialRevision: 3, pendingCredentialEnvelope: undefined, refreshLeaseUntil: undefined, refreshAttemptRevision: undefined, status: "setting_up", controlBusy: true, controlAction: "setup", updatedAt: now }, commands: [{ type: "setup", expectedGeneration: 4, delayMs: 0 }] },
      },
      {
        name: "keeps disconnect ahead of an ambiguous expired refresh",
        input: { installation: { ...baseInstallation, status: "disconnecting", disconnectAfterDrain: true, leaseUntil: now, refreshLeaseUntil: now, refreshAttemptRevision: 2, pendingCredentialEnvelope: "credential-v2" }, job: null, slot: { leaseId: "lease-1" } },
        result: { recoverInstallation: true, deleteSlot: true, installationPatch: { leaseId: undefined, leaseUntil: undefined, credentialEnvelope: "credential-v2", credentialRevision: 3, pendingCredentialEnvelope: undefined, refreshLeaseUntil: undefined, refreshAttemptRevision: undefined, status: "disconnecting", controlBusy: true, controlAction: "disconnect", updatedAt: now }, commands: [{ type: "disconnect", delayMs: 0 }] },
      },
      {
        name: "marks a matching expired refresh attempt as ambiguous",
        input: { installation: { ...baseInstallation, leaseUntil: now, refreshLeaseUntil: now, refreshAttemptRevision: 2 }, job: null, slot: null },
        result: { recoverInstallation: true, deleteSlot: false, installationPatch: { leaseId: undefined, leaseUntil: undefined, generation: 5, errorCode: "access_revoked", refreshLeaseUntil: undefined, status: "needs_reconnect", controlBusy: false, controlAction: undefined, updatedAt: now }, commands: [] },
      },
    ])("$name", ({ input, result }) => {
      expect(transitionExpiredLease(input as ExpiredLeaseInput, { type: "lease_expired", leaseId: "lease-1", now })).toEqual(result);
    });

    it("leaves a still-live matching lease alone", () => {
      expect(transitionExpiredLease({ installation: baseInstallation, job: baseJob, slot: { leaseId: "lease-1" } }, { type: "lease_expired", leaseId: "lease-1", now }))
        .toEqual({ recoverInstallation: false, deleteSlot: false, commands: [] });
    });
  });

  describe("setup completion", () => {
    it.each([
      [null, false],
      [{ ...baseInstallation, leaseId: "another-lease" }, false],
      [{ ...baseInstallation, leaseUntil: now }, false],
    ] as const)("rejects a stale or expired completion (%s)", (installation, accepted) => {
      expect(transitionFinishSetup({ installation }, { type: "setup_finished", leaseId: "lease-1", expectedGeneration: 4, now }).accepted).toBe(accepted);
    });

    it("applies handover credentials and retries setup at the current generation", () => {
      const result = transitionFinishSetup({ installation: { ...baseInstallation, status: "setting_up", pendingCredentialEnvelope: "credential-v2" } }, {
        type: "setup_finished", leaseId: "lease-1", expectedGeneration: 4, now,
      });
      expect(result).toMatchObject({
        accepted: true, deleteLeaseSlot: true,
        installationPatch: { credentialEnvelope: "credential-v2", credentialRevision: 3, pendingCredentialEnvelope: undefined, controlBusy: true, controlAction: "setup" },
        commands: [{ type: "setup", expectedGeneration: 4, delayMs: 0 }],
      });
    });

    it("only turns a setup error into setup_failed when its generation is still current", () => {
      const stale = transitionFinishSetup({ installation: { ...baseInstallation, status: "paused" } }, {
        type: "setup_finished", leaseId: "lease-1", expectedGeneration: 3, errorCode: "invalid_config", now,
      });
      expect(stale.installationPatch).not.toHaveProperty("status");
      const current = transitionFinishSetup({ installation: { ...baseInstallation, status: "setting_up" } }, {
        type: "setup_finished", leaseId: "lease-1", expectedGeneration: 4, errorCode: "invalid_config", now,
      });
      expect(current.installationPatch).toMatchObject({ status: "setup_failed", generation: 5, controlBusy: false });
    });
  });

  describe("job completion", () => {
    const complete = (installation: InstallationState, job: JobState, result: "success" | "retry" | "failed" = "success", extra: { claimedRevision?: number; errorCode?: string; retryAt?: number } = {}) =>
      transitionFinishJob({ installation, job }, {
        type: "job_finished", leaseId: "lease-1", claimedRevision: extra.claimedRevision ?? 3, result, now,
        ...(extra.errorCode ? { errorCode: extra.errorCode } : {}), ...(extra.retryAt !== undefined ? { retryAt: extra.retryAt } : {}),
      });

    it.each([
      [{ ...baseInstallation, leaseId: "another" }, baseJob],
      [baseInstallation, { ...baseJob, leaseId: "another" }],
      [{ ...baseInstallation, leaseUntil: now }, baseJob],
      [baseInstallation, { ...baseJob, leaseUntil: now }],
    ] as const)("rejects a stale lease pair", (installation, job) => {
      expect(complete(installation, job).accepted).toBe(false);
    });

    it.each(["success", "retry", "failed"] as const)("keeps a newer webhook revision queued when the leased work finishes with %s", (result) => {
      const transition = complete({ ...baseInstallation, status: "active", controlBusy: false }, { ...baseJob, revision: 4 }, result, { errorCode: "missing_property" });
      expect(transition.facts.newerInputArrived).toBe(true);
      expect(transition.facts.structuralFailure).toBe(false);
      expect(transition.jobMutation).toMatchObject({ type: "patch", patch: { dueAt: now, leaseId: undefined } });
      expect(transition.installationPatch.pendingCount).toBe(1);
      expect(transition.installationPatch.status).toBeUndefined();
    });

    it.each([
      ["paused" as const, undefined],
      ["setting_up" as const, "resume" as const],
    ])("retains a lease invalidated by pause/resume (%s, action %s)", (status, controlAction) => {
      const result = complete({ ...baseInstallation, status, generation: 5, controlAction, controlBusy: status === "setting_up" }, baseJob);
      expect(result.facts.pausedReview).toBe(true);
      expect(result.jobMutation).toMatchObject({ type: "patch", patch: { leaseId: undefined, dueAt: now } });
      expect(result.installationPatch.pendingCount).toBe(1);
    });

    it("does not let an old failure demote reauthorization, disconnect, or region setup", () => {
      const pendingReauth = complete({ ...baseInstallation, status: "setting_up", controlAction: "setup", pendingCredentialEnvelope: "credential-v2" }, baseJob, "failed", { errorCode: "missing_property" });
      expect(pendingReauth.installationPatch).toMatchObject({ status: "setting_up", credentialEnvelope: "credential-v2", credentialRevision: 3 });
      expect(pendingReauth.installationPatch.generation).toBeUndefined();
      expect(pendingReauth.facts.structuralFailure).toBe(false);

      const disconnect = complete({ ...baseInstallation, status: "disconnecting", disconnectAfterDrain: true, controlAction: "disconnect" }, baseJob, "failed", { errorCode: "missing_property" });
      expect(disconnect.installationPatch).toMatchObject({ status: "disconnecting", controlAction: "disconnect" });
      expect(disconnect.installationPatch.generation).toBeUndefined();
      expect(disconnect.commands).toEqual([{ type: "disconnect", delayMs: 0 }]);

      const regionSetup = complete({ ...baseInstallation, status: "setting_up", controlAction: "setup", generation: 5 }, baseJob, "failed", { errorCode: "missing_property" });
      expect(regionSetup.installationPatch).toMatchObject({ status: "setting_up", controlAction: "setup" });
      expect(regionSetup.installationPatch.generation).toBeUndefined();
      expect(regionSetup.facts.structuralFailure).toBe(false);
    });

    it.each(["invalid_config", "missing_property"] as const)("retains the job and pauses on a current structural failure: %s", (errorCode) => {
      const result = complete({ ...baseInstallation, status: "active", controlBusy: false }, baseJob, "failed", { errorCode });
      expect(result.facts.structuralFailure).toBe(true);
      expect(result.jobMutation).toMatchObject({ type: "patch", patch: { leaseId: undefined } });
      expect(result.installationPatch).toMatchObject({ status: "setup_failed", generation: 5, controlBusy: false, pendingCount: 1 });
    });

    it("keeps the retry delay bounded and schedules the current queue", () => {
      const result = complete({ ...baseInstallation, status: "active", controlBusy: false }, baseJob, "retry", { retryAt: now - 1 });
      expect(result.jobMutation).toMatchObject({ type: "patch", patch: { dueAt: now + 1_000 } });
      expect(result.commands).toEqual([{ type: "run", delayMs: 0 }, { type: "run", delayMs: 1_000 }]);
      expect(result.installationPatch.pendingCount).toBe(1);
    });

    it("drains a region-invalidated result using the newer region setup control", () => {
      const result = complete({ ...baseInstallation, status: "setting_up", generation: 5, controlAction: "setup" }, baseJob);
      expect(result.jobMutation).toEqual({ type: "delete" });
      expect(result.installationPatch).toMatchObject({ status: "setting_up", pendingCount: 0 });
      expect(result.installationPatch.generation).toBeUndefined();
      expect(result.commands).toEqual([{ type: "setup", expectedGeneration: 5, delayMs: 0 }]);
    });
  });
});
