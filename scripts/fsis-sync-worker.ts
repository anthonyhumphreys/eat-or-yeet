import { readFile } from "node:fs/promises";
import path from "node:path";

import { syncFsis } from "./lib/fsis-sync";
import { syncFdaAnnouncements } from "./lib/fda-sync";
import { fsisUploadEnvironment, fsisWorkerHealthy, runFsisWorker } from "./lib/fsis-worker";

async function main() {
  const args = process.argv.slice(2);
  const stateFile = path.join(process.env.FSIS_STATE_DIR ?? "/var/lib/fsis-sync", "status.json");
  if (args.length === 1 && args[0] === "--healthcheck") {
    process.exitCode = await fsisWorkerHealthy(stateFile) ? 0 : 1;
    return;
  }
  if (args.length && (args.length !== 1 || args[0] !== "--once")) throw new Error("Usage: fsis-sync-worker [--once | --healthcheck]");

  const keyFile = process.env.FSIS_UPLOAD_TOKEN_FILE ?? "/run/secrets/fsis_upload_token";
  const deployment = process.env.FSIS_BACKEND_URL;
  if (!deployment) throw new Error("Set FSIS_BACKEND_URL and mount its FSIS upload token before starting the USDA worker");
  const env = fsisUploadEnvironment(await readFile(keyFile, "utf8"), deployment, process.env);
  const syncFDA = process.env.FDA_ANNOUNCEMENTS_SYNC_ENABLED === "true";
  if (syncFDA) {
    const key = (await readFile(process.env.FDA_UPLOAD_TOKEN_FILE ?? "/run/secrets/fda_upload_token", "utf8")).trim();
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("Mount a valid FDA upload token before starting the announcement sync");
    env.FDA_UPLOAD_TOKEN = key;
  }
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  console.log(`Starting food source sync for ${deployment}; fetching immediately, then daily.`);
  try {
    const ok = await runFsisWorker({
      stateFile, signal: controller.signal, once: args[0] === "--once",
      sync: async () => {
        const fsis = await syncFsis({ env });
        return syncFDA ? { fsis, fda: await syncFdaAnnouncements(env) } : fsis;
      },
    });
    if (args[0] === "--once" && !ok) process.exitCode = 1;
  } finally {
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "USDA worker failed");
  process.exitCode = 1;
});
