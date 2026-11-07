import type { Doc, Id } from "../model";

type Installation = Doc<"notionInstallations">;
type Job = Doc<"notionJobs">;
type InstallationFields = keyof Installation;
type JobFields = keyof Job;
export type InstallationState = Pick<Installation,
  | "status" | "generation" | "region" | "databaseId" | "dataSourceId" | "leaseId" | "leaseUntil"
  | "pendingCredentialEnvelope" | "credentialEnvelope" | "credentialRevision" | "refreshLeaseUntil"
  | "refreshAttemptRevision" | "disconnectAfterDrain" | "controlBusy" | "controlAction" | "pendingCount"
  | "updatedAt" | "errorCode">;
export type JobState = Pick<Job, "leaseId" | "leaseUntil" | "leasedGeneration" | "revision" | "dueAt" | "touchedAt">;

export type InstallationPatch = Partial<Pick<Installation, Exclude<InstallationFields, "_id" | "_creationTime">>>;
export type JobPatch = Partial<Pick<Job, Exclude<JobFields, "_id" | "_creationTime">>>;
export type NotionScheduleCommand =
  | { type: "setup"; expectedGeneration: number; delayMs: number }
  | { type: "run"; delayMs: number }
  | { type: "disconnect"; delayMs: number };

export type ControlEvent = {
  type: "control";
  action: "pause" | "resume" | "retry" | "disconnect" | "region";
  region?: "UK" | "US";
  now: number;
};

export type ControlTransition = {
  accepted: boolean;
  installationPatch: InstallationPatch;
  commands: NotionScheduleCommand[];
};

export function transitionControl(installation: InstallationState, event: ControlEvent): ControlTransition {
  if (installation.status === "disconnecting") {
    return { accepted: false, installationPatch: {}, commands: [] };
  }

  const hasLease = installation.leaseUntil !== undefined && installation.leaseUntil > event.now;
  if (event.action === "pause") {
    return {
      accepted: true,
      installationPatch: {
        status: "paused", generation: installation.generation + 1,
        controlBusy: hasLease, controlAction: hasLease ? "pause" : undefined, updatedAt: event.now,
      },
      commands: [],
    };
  }

  if (event.action === "resume" || event.action === "retry") {
    const needsSetup = !installation.databaseId || !installation.dataSourceId || event.action === "retry";
    const status = needsSetup || hasLease ? "setting_up" : "active";
    return {
      accepted: true,
      installationPatch: {
        status, generation: installation.generation + 1,
        controlBusy: hasLease || needsSetup,
        controlAction: needsSetup ? "setup" : hasLease ? "resume" : undefined,
        updatedAt: event.now,
      },
      commands: hasLease ? [] : needsSetup
        ? [{ type: "setup", expectedGeneration: installation.generation + 1, delayMs: 0 }]
        : [{ type: "run", delayMs: 0 }],
    };
  }

  if (event.action === "region") {
    if (!event.region) throw new Error("A region is required.");
    return {
      accepted: true,
      installationPatch: {
        region: event.region, status: "setting_up", generation: installation.generation + 1,
        controlBusy: true, controlAction: "setup", updatedAt: event.now,
      },
      commands: hasLease ? [] : [{ type: "setup", expectedGeneration: installation.generation + 1, delayMs: 0 }],
    };
  }

  return {
    accepted: true,
    installationPatch: {
      status: "disconnecting", generation: installation.generation + 1, controlBusy: true,
      controlAction: "disconnect", disconnectAfterDrain: true, updatedAt: event.now,
    },
    commands: hasLease ? [] : [{ type: "disconnect", delayMs: 0 }],
  };
}

export type ExpiredLeaseEvent = { type: "lease_expired"; leaseId: string; now: number };
export type ExpiredLeaseInput = {
  installation: InstallationState | null;
  job: JobState | null;
  slot: { leaseId: string; jobId?: Id<"notionJobs"> } | null;
};
export type ExpiredLeaseTransition = {
  recoverInstallation: boolean;
  deleteSlot: boolean;
  jobPatch?: JobPatch;
  installationPatch?: InstallationPatch;
  commands: NotionScheduleCommand[];
};

export function transitionExpiredLease(input: ExpiredLeaseInput, event: ExpiredLeaseEvent): ExpiredLeaseTransition {
  const { installation, job, slot } = input;
  const expiredOrSuperseded = !installation || installation.leaseId !== event.leaseId || (installation.leaseUntil ?? 0) <= event.now;
  const deleteSlot = Boolean(slot && slot.leaseId === event.leaseId && expiredOrSuperseded);
  const jobPatch = deleteSlot && slot?.jobId && job?.leaseId === event.leaseId
    ? { leaseId: undefined, leaseUntil: undefined, leasedGeneration: undefined, dueAt: Math.min(job.dueAt, event.now), touchedAt: event.now }
    : undefined;

  if (!installation || installation.leaseId !== event.leaseId || (installation.leaseUntil ?? 0) > event.now) {
    return { recoverInstallation: false, deleteSlot, ...(jobPatch ? { jobPatch } : {}), commands: [] };
  }

  const pendingCredentials = installation.pendingCredentialEnvelope;
  const disconnecting = installation.status === "disconnecting" || installation.disconnectAfterDrain;
  const refreshAmbiguous = installation.refreshLeaseUntil !== undefined && installation.refreshLeaseUntil <= event.now &&
    installation.refreshAttemptRevision === installation.credentialRevision && !pendingCredentials && !disconnecting;
  const status = disconnecting ? "disconnecting" : refreshAmbiguous ? "needs_reconnect" : pendingCredentials ? "setting_up" : installation.status;
  const installationPatch: InstallationPatch = {
    leaseId: undefined,
    leaseUntil: undefined,
    ...(pendingCredentials ? {
      credentialEnvelope: pendingCredentials,
      credentialRevision: installation.credentialRevision + 1,
      pendingCredentialEnvelope: undefined,
      refreshLeaseUntil: undefined,
      refreshAttemptRevision: undefined,
    } : {}),
    ...(refreshAmbiguous ? { generation: installation.generation + 1, errorCode: "access_revoked", refreshLeaseUntil: undefined } : {}),
    status,
    controlBusy: status === "setting_up" || status === "disconnecting",
    controlAction: status === "setting_up" ? "setup" : status === "disconnecting" ? "disconnect" : undefined,
    updatedAt: event.now,
  };
  const commands: NotionScheduleCommand[] = status === "disconnecting"
    ? [{ type: "disconnect", delayMs: 0 }]
    : status === "setting_up"
      ? [{ type: "setup", expectedGeneration: installation.generation, delayMs: 0 }]
      : status === "active" ? [{ type: "run", delayMs: 0 }] : [];
  return { recoverInstallation: true, deleteSlot, ...(jobPatch ? { jobPatch } : {}), installationPatch, commands };
}

export type FinishSetupEvent = {
  type: "setup_finished";
  expectedGeneration: number;
  leaseId: string;
  now: number;
  errorCode?: string;
};
export type FinishSetupInput = { installation: InstallationState | null };
export type FinishSetupTransition = {
  accepted: boolean;
  installationPatch: InstallationPatch;
  deleteLeaseSlot: boolean;
  commands: NotionScheduleCommand[];
};

export function transitionFinishSetup(input: FinishSetupInput, event: FinishSetupEvent): FinishSetupTransition {
  const { installation } = input;
  if (!installation || installation.leaseId !== event.leaseId || installation.leaseUntil === undefined || installation.leaseUntil <= event.now) {
    return { accepted: false, installationPatch: {}, deleteLeaseSlot: false, commands: [] };
  }

  const pendingCredentials = installation.pendingCredentialEnvelope;
  const stillCurrent = installation.generation === event.expectedGeneration && installation.status === "setting_up";
  const setupFailed = Boolean(event.errorCode && stillCurrent);
  const retrySetup = installation.status === "setting_up" && !setupFailed;
  const installationPatch: InstallationPatch = {
    leaseId: undefined,
    leaseUntil: undefined,
    controlBusy: installation.status === "disconnecting" || retrySetup,
    controlAction: installation.status === "disconnecting" ? "disconnect" : retrySetup ? "setup" : undefined,
    ...(pendingCredentials ? {
      credentialEnvelope: pendingCredentials,
      credentialRevision: installation.credentialRevision + 1,
      pendingCredentialEnvelope: undefined,
    } : {}),
    ...(setupFailed ? { status: "setup_failed", generation: installation.generation + 1, errorCode: event.errorCode } : {}),
    updatedAt: event.now,
  };
  const commands: NotionScheduleCommand[] = installation.status === "disconnecting"
    ? [{ type: "disconnect", delayMs: 0 }]
    : pendingCredentials || retrySetup
      ? [{ type: "setup", expectedGeneration: installation.generation, delayMs: 0 }]
      : installation.status === "active" ? [{ type: "run", delayMs: 0 }] : [];
  return { accepted: true, installationPatch, deleteLeaseSlot: true, commands };
}

export type JobResult = "success" | "retry" | "failed";
export type FinishJobEvent = {
  type: "job_finished";
  leaseId: string;
  claimedRevision: number;
  result: JobResult;
  now: number;
  retryAt?: number;
  errorCode?: string;
};
export type FinishJobInput = { installation: InstallationState | null; job: JobState | null };
export type FinishJobTransition = {
  accepted: boolean;
  installationPatch: InstallationPatch;
  jobMutation?: { type: "patch"; patch: JobPatch } | { type: "delete" };
  deleteLeaseSlot: boolean;
  commands: NotionScheduleCommand[];
  facts: { newerInputArrived: boolean; pausedReview: boolean; structuralFailure: boolean; retryJob: boolean };
};

export function transitionFinishJob(input: FinishJobInput, event: FinishJobEvent): FinishJobTransition {
  const { installation, job } = input;
  const emptyFacts = { newerInputArrived: false, pausedReview: false, structuralFailure: false, retryJob: false };
  if (!installation || !job || job.leaseId !== event.leaseId || installation.leaseId !== event.leaseId ||
    (installation.leaseUntil ?? 0) <= event.now || (job.leaseUntil ?? 0) <= event.now) {
    return { accepted: false, installationPatch: {}, deleteLeaseSlot: false, commands: [], facts: emptyFacts };
  }

  const newerInputArrived = job.revision > event.claimedRevision;
  // A pause invalidates the lease, but a resume can arrive before that lease drains.
  const pausedReview = installation.generation !== job.leasedGeneration &&
    (installation.status === "paused" || installation.controlAction === "resume") && !installation.disconnectAfterDrain;
  const structuralFailure = !newerInputArrived && event.result === "failed" &&
    (event.errorCode === "invalid_config" || event.errorCode === "missing_property") &&
    installation.status === "active" && !installation.controlBusy && installation.generation === job.leasedGeneration &&
    !installation.pendingCredentialEnvelope && !installation.disconnectAfterDrain;
  const retryJob = event.result === "retry" && installation.status === "active";
  let jobMutation: FinishJobTransition["jobMutation"];
  if (newerInputArrived || pausedReview) {
    jobMutation = { type: "patch", patch: { dueAt: Math.min(job.dueAt, event.now), leaseId: undefined, leaseUntil: undefined, leasedGeneration: undefined, touchedAt: event.now } };
  } else if (structuralFailure) {
    jobMutation = { type: "patch", patch: { leaseId: undefined, leaseUntil: undefined, leasedGeneration: undefined, touchedAt: event.now } };
  } else if (retryJob) {
    jobMutation = { type: "patch", patch: { dueAt: Math.max(event.retryAt ?? event.now + 5_000, event.now + 1_000), leaseId: undefined, leaseUntil: undefined, leasedGeneration: undefined, touchedAt: event.now } };
  } else {
    jobMutation = { type: "delete" };
  }

  const pendingCredentials = installation.pendingCredentialEnvelope;
  const disconnecting = installation.disconnectAfterDrain || installation.status === "disconnecting";
  const status = disconnecting ? "disconnecting" : structuralFailure ? "setup_failed" : pendingCredentials || installation.controlAction === "setup" ? "setting_up" : installation.controlAction === "resume" ? "active" : installation.status;
  const installationPatch: InstallationPatch = {
    leaseId: undefined,
    leaseUntil: undefined,
    controlBusy: status === "setting_up" || disconnecting,
    controlAction: disconnecting ? "disconnect" : status === "setting_up" ? "setup" : undefined,
    pendingCount: Math.max(0, installation.pendingCount - (newerInputArrived || pausedReview || structuralFailure || retryJob ? 0 : 1)),
    ...(pendingCredentials ? {
      credentialEnvelope: pendingCredentials,
      credentialRevision: installation.credentialRevision + 1,
      pendingCredentialEnvelope: undefined,
      status,
    } : {}),
    ...(!pendingCredentials && installation.controlAction ? { status } : {}),
    ...(event.result === "failed" && event.errorCode ? { errorCode: event.errorCode } : {}),
    updatedAt: event.now,
    ...(structuralFailure ? { status: "setup_failed", generation: installation.generation + 1, controlBusy: false, controlAction: undefined } : {}),
  };

  const commands: NotionScheduleCommand[] = [];
  if (disconnecting) commands.push({ type: "disconnect", delayMs: 0 });
  else if (pendingCredentials) commands.push({ type: "setup", expectedGeneration: installation.generation, delayMs: 0 });
  else if (installation.controlAction === "setup") commands.push({ type: "setup", expectedGeneration: installation.generation, delayMs: 0 });
  else if (installation.status === "active" || installation.controlAction === "resume") commands.push({ type: "run", delayMs: 0 });
  if (event.result === "retry" && installation.status === "active") {
    commands.push({ type: "run", delayMs: Math.max(1_000, (event.retryAt ?? event.now + 5_000) - event.now) });
  }

  return {
    accepted: true,
    installationPatch,
    jobMutation,
    deleteLeaseSlot: true,
    commands,
    facts: { newerInputArrived, pausedReview, structuralFailure, retryJob },
  };
}
