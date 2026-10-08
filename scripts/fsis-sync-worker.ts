import { readFile } from "node:fs/promises";
import path from "node:path";

import { syncFsis } from "./lib/fsis-sync";
import { fsisDeployKeyEnvironment, fsisWorkerHealthy, runFsisWorker } from "./lib/fsis-worker";

async function main() {
  const args = process.argv.slice(2);
  const stateFile = path.join(process.env.FSIS_STATE_DIR ?? "/var/lib/fsis-sync", "status.json");
  if (args.length === 1 && args[0] === "--healthcheck") {
    process.exitCode = await fsisWorkerHealthy(stateFile) ? 0 : 1;
    return;
  }
  if (args.length && (args.length !== 1 || args[0] !== "--once")) throw new Error("Usage: fsis-sync-worker [--once | --healthcheck]");

  const keyFile = process.env.CONVEX_DEPLOY_KEY_FILE ?? "/run/secrets/convex_deploy_key";
  const deployment = process.env.FSIS_DEPLOYMENT;
  if (!deployment) throw new Error("Set FSIS_DEPLOYMENT and mount its Convex deployment key before starting the USDA worker");
  const env = fsisDeployKeyEnvironment(await readFile(keyFile, "utf8"), deployment, process.env);
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  console.log(`Starting USDA sync for ${deployment}; fetching immediately, then daily.`);
  try {
    const ok = await runFsisWorker({
      stateFile, signal: controller.signal, once: args[0] === "--once",
      sync: () => syncFsis({ env }),
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
