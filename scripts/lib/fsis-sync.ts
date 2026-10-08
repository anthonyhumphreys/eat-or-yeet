import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";

import { z } from "zod";

import { FSIS_API, parseFsisRecords } from "../../src/lib/incidents/fsis";
import { fetchOfficialJson } from "../../src/lib/incidents/official-source-http";

const exec = promisify(execFile);
const require = createRequire(import.meta.url);
const convexCli = path.join(path.dirname(require.resolve("convex/package.json")), "bin/main.js");
const importResultSchema = z.object({
  status: z.string(), found: z.number(), created: z.number(), updated: z.number(), errors: z.array(z.string()),
});

type SyncOptions = { prod?: boolean; env?: NodeJS.ProcessEnv };

async function runFunction(name: string, input: Record<string, unknown>, options: SyncOptions): Promise<unknown> {
  try {
    const { stdout } = await exec(process.execPath, [
      convexCli, "run", ...(options.prod ? ["--prod"] : []), name, JSON.stringify(input),
    ], { env: options.env, maxBuffer: 1024 * 1024, timeout: 5 * 60 * 1_000 });
    return JSON.parse(stdout);
  } catch {
    // CLI errors can include request details. Keep credentials, upload URLs and
    // source records out of unattended container logs.
    throw new Error(`Convex function ${name} failed; check deployment access and the ingestion ledger`);
  }
}

export async function syncFsis(options: SyncOptions = {}) {
  // Fetch and validate before creating an upload URL or writing database rows.
  const payload = await fetchOfficialJson(FSIS_API, {
    sourceName: "FSIS Recall API", headers: { Accept: "application/json" }, timeoutMs: 30_000, cache: "no-store",
  });
  const fetchedAt = Date.now();
  const incidents = parseFsisRecords(payload);
  console.log(`Validated ${incidents.length} English USDA notices, including ${incidents.filter((item) => item.status === "active").length} active notices.`);

  const uploadUrl = z.string().url().parse(await runFunction("incidents:createFsisSnapshotUpload", {}, options));
  const upload = await fetch(uploadUrl, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(incidents.map((item) => item.originalSourceData)),
    signal: AbortSignal.timeout(60_000),
  });
  if (!upload.ok) throw new Error(`Snapshot upload returned HTTP ${upload.status}`);
  const { storageId } = z.object({ storageId: z.string().min(1) }).parse(await upload.json());

  try {
    const result = importResultSchema.parse(await runFunction(
      "incidents:importFsisSnapshotInternal", { storageId, fetchedAt }, options,
    ));
    if (result.status !== "success") throw new Error("USDA import did not complete successfully; see the ingestion ledger");
    return result;
  } catch (error) {
    // The importer normally deletes the file. Also clean up if its request never
    // reached Convex. Cleanup failure must not hide the original import failure.
    await runFunction("incidents:deleteFsisSnapshot", { storageId }, options).catch(() => undefined);
    throw error;
  }
}
