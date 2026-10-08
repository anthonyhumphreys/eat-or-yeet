import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as pause } from "node:timers/promises";

import { z } from "zod";

export const FSIS_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1_000;
export const FSIS_RETRY_INTERVAL_MS = 60 * 60 * 1_000;
export const FSIS_HEALTH_MAX_AGE_MS = 36 * 60 * 60 * 1_000;

const stateSchema = z.object({
  lastAttemptAt: z.number().int().nonnegative(),
  lastSuccessAt: z.number().int().nonnegative().nullable(),
  failed: z.boolean(),
});
type WorkerState = z.infer<typeof stateSchema>;

export function fsisDeployKeyEnvironment(key: string, deployment: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const trimmed = key.trim();
  const expected = /^(prod|dev):[a-z0-9-]+$/.test(deployment);
  if (!expected || !trimmed.startsWith(`${deployment}|`) || /\s/.test(trimmed) || trimmed.length <= deployment.length + 1) {
    throw new Error("The mounted Convex deployment key does not match FSIS_DEPLOYMENT");
  }
  return { ...env, CONVEX_DEPLOY_KEY: trimmed };
}

export async function readFsisWorkerState(stateFile: string): Promise<WorkerState | null> {
  try {
    return stateSchema.parse(JSON.parse(await readFile(stateFile, "utf8")));
  } catch {
    return null;
  }
}

export async function fsisWorkerHealthy(stateFile: string, now = Date.now()): Promise<boolean> {
  const state = await readFsisWorkerState(stateFile);
  return Boolean(state && !state.failed && state.lastSuccessAt !== null
    && state.lastSuccessAt <= now && now - state.lastSuccessAt < FSIS_HEALTH_MAX_AGE_MS);
}

export async function runFsisWorker(options: {
  stateFile: string;
  sync: () => Promise<unknown>;
  signal: AbortSignal;
  once?: boolean;
  log?: (message: string) => void;
}): Promise<boolean> {
  const log = options.log ?? console.log;
  let state = await readFsisWorkerState(options.stateFile);
  await mkdir(path.dirname(options.stateFile), { recursive: true });

  while (!options.signal.aborted) {
    const lastAttemptAt = Date.now();
    try {
      const result = await options.sync();
      state = { lastAttemptAt, lastSuccessAt: Date.now(), failed: false };
      log(JSON.stringify({ time: new Date().toISOString(), status: "success", result }));
    } catch (error) {
      state = { lastAttemptAt, lastSuccessAt: state?.lastSuccessAt ?? null, failed: true };
      log(JSON.stringify({ time: new Date().toISOString(), status: "failed", error: error instanceof Error ? error.message : "Unknown sync error" }));
    }
    await writeFile(`${options.stateFile}.tmp`, JSON.stringify(state), { mode: 0o600 });
    await rename(`${options.stateFile}.tmp`, options.stateFile);
    if (options.once || options.signal.aborted) return !state.failed;

    const delay = state.failed ? FSIS_RETRY_INTERVAL_MS : FSIS_SYNC_INTERVAL_MS;
    log(`Next USDA sync in ${delay / (60 * 60 * 1_000)} hour(s).`);
    try {
      await pause(delay, undefined, { signal: options.signal });
    } catch (error) {
      if (!options.signal.aborted) throw error;
    }
  }
  return !state?.failed;
}
