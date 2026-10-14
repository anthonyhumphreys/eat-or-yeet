import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as pause } from "node:timers/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:timers/promises", () => ({ setTimeout: vi.fn() }));

import {
  FSIS_HEALTH_MAX_AGE_MS, FSIS_RETRY_INTERVAL_MS, FSIS_SYNC_INTERVAL_MS,
  fsisUploadEnvironment, fsisWorkerHealthy, readFsisWorkerState, runFsisWorker,
} from "../scripts/lib/fsis-worker";

describe("NAS USDA worker", () => {
  let directory: string;
  let stateFile: string;
  let controller: AbortController;
  let sleeps: { milliseconds: number; resume: () => void }[];

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "fsis-worker-test-"));
    stateFile = path.join(directory, "status.json");
    controller = new AbortController();
    sleeps = [];
    vi.mocked(pause).mockImplementation((milliseconds, _value, options) => new Promise<void>((resolve) => {
      sleeps.push({ milliseconds: milliseconds!, resume: resolve });
      options?.signal?.addEventListener("abort", () => resolve(), { once: true });
    }));
  });

  afterEach(async () => {
    controller.abort();
    vi.clearAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  it("imports immediately, persists success and waits a day before the next run", async () => {
    const sync = vi.fn().mockResolvedValue({ status: "success", found: 101 });
    const worker = runFsisWorker({ stateFile, sync, signal: controller.signal, log: vi.fn() });
    await vi.waitFor(() => expect(sleeps).toHaveLength(1));
    expect(sync).toHaveBeenCalledTimes(1);
    expect(sleeps[0].milliseconds).toBe(FSIS_SYNC_INTERVAL_MS);
    expect(await fsisWorkerHealthy(stateFile)).toBe(true);

    sleeps[0].resume();
    await vi.waitFor(() => expect(sleeps).toHaveLength(2));
    expect(sync).toHaveBeenCalledTimes(2);
    controller.abort();
    await expect(worker).resolves.toBe(true);
  });

  it("retries a failed import hourly, preserving the last success, then recovers", async () => {
    const lastSuccessAt = Date.now() - 1_000;
    await writeFile(stateFile, JSON.stringify({ lastSuccessAt, lastAttemptAt: lastSuccessAt, failed: false }));
    const sync = vi.fn().mockRejectedValueOnce(new Error("USDA returned HTTP 403")).mockResolvedValue({ status: "success" });
    const worker = runFsisWorker({ stateFile, sync, signal: controller.signal, log: vi.fn() });
    await vi.waitFor(() => expect(sleeps).toHaveLength(1));
    expect(sleeps[0].milliseconds).toBe(FSIS_RETRY_INTERVAL_MS);
    expect(await readFsisWorkerState(stateFile)).toMatchObject({ lastSuccessAt, failed: true });
    expect(await fsisWorkerHealthy(stateFile)).toBe(false);

    sleeps[0].resume();
    await vi.waitFor(() => expect(sleeps).toHaveLength(2));
    expect(sleeps[1].milliseconds).toBe(FSIS_SYNC_INTERVAL_MS);
    expect(await fsisWorkerHealthy(stateFile)).toBe(true);
    controller.abort();
    await worker;
  });

  it("does not overlap imports and finishes a running import when stopped", async () => {
    let finish!: () => void;
    const sync = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const worker = runFsisWorker({ stateFile, sync, signal: controller.signal, log: vi.fn() });
    await vi.waitFor(() => expect(sync).toHaveBeenCalledTimes(1));
    expect(sleeps).toHaveLength(0);
    controller.abort();
    finish();
    await worker;
    expect(sync).toHaveBeenCalledTimes(1);
    expect(await fsisWorkerHealthy(stateFile)).toBe(true);
  });

  it("returns failure for a one-off import and persists failure without credentials or source records", async () => {
    const ok = await runFsisWorker({
      stateFile, signal: controller.signal, once: true, log: vi.fn(),
      sync: async () => { throw new Error("Import failed"); },
    });
    expect(ok).toBe(false);
    expect(JSON.parse(await readFile(stateFile, "utf8"))).toEqual({ lastAttemptAt: expect.any(Number), lastSuccessAt: null, failed: true });
    expect(sleeps).toHaveLength(0);
  });

  it("treats missing, malformed, future, stale and failed status as unhealthy", async () => {
    const now = Date.now();
    expect(await fsisWorkerHealthy(stateFile, now)).toBe(false);
    await writeFile(stateFile, "not JSON");
    expect(await fsisWorkerHealthy(stateFile, now)).toBe(false);
    for (const lastSuccessAt of [null, now + 1, now - FSIS_HEALTH_MAX_AGE_MS]) {
      await writeFile(stateFile, JSON.stringify({ lastAttemptAt: now, lastSuccessAt, failed: false }));
      expect(await fsisWorkerHealthy(stateFile, now)).toBe(false);
    }
    await writeFile(stateFile, JSON.stringify({ lastAttemptAt: now, lastSuccessAt: now, failed: true }));
    expect(await fsisWorkerHealthy(stateFile, now)).toBe(false);
  });

  it("requires a dedicated upload token and HTTPS target", () => {
    const key = "a".repeat(64);
    expect(fsisUploadEnvironment(`${key}\n`, "https://backend.example.test", { NODE_ENV: "production" }))
      .toEqual({ NODE_ENV: "production", BACKEND_URL: "https://backend.example.test", FSIS_UPLOAD_TOKEN: key });
    for (const invalid of ["", "too-short", `${key}\nextra`]) {
      expect(() => fsisUploadEnvironment(invalid, "https://backend.example.test", { NODE_ENV: "test" })).toThrow(/upload token/);
    }
    expect(() => fsisUploadEnvironment(key, "http://example.test", { NODE_ENV: "test" })).toThrow(/HTTPS/);
  });
});
