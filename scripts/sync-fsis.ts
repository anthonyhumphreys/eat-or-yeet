import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { FSIS_API, parseFsisRecords } from "../src/lib/incidents/fsis";
import { fetchOfficialJson } from "../src/lib/incidents/official-source-http";

const exec = promisify(execFile);
const args = process.argv.slice(2);
if (args.length && (args.length !== 1 || args[0] !== "--prod")) {
  throw new Error("Usage: pnpm data:sync:fsis [--prod]");
}

async function runFunction<T>(name: string, input: Record<string, unknown> = {}): Promise<T> {
  const { stdout } = await exec("pnpm", ["exec", "convex", "run", ...args, name, JSON.stringify(input)], {
    maxBuffer: 1024 * 1024,
    timeout: 5 * 60 * 1_000,
  });
  return JSON.parse(stdout) as T;
}

// Fetch and validate before creating an upload URL or writing any database rows.
const payload = await fetchOfficialJson(FSIS_API, {
  sourceName: "FSIS Recall API", headers: { Accept: "application/json" }, timeoutMs: 30_000, cache: "no-store",
});
const fetchedAt = Date.now();
const incidents = parseFsisRecords(payload);
console.log(`Validated ${incidents.length} English USDA notices, including ${incidents.filter((item) => item.status === "active").length} active notices.`);

const uploadUrl = await runFunction<string>("incidents:createFsisSnapshotUpload");
const upload = await fetch(uploadUrl, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify(incidents.map((item) => item.originalSourceData)),
  signal: AbortSignal.timeout(60_000),
});
if (!upload.ok) throw new Error(`Snapshot upload returned HTTP ${upload.status}`);
const { storageId } = await upload.json() as { storageId: string };

try {
  const result = await runFunction<{ status: string; found: number; created: number; updated: number; errors: string[] }>(
    "incidents:importFsisSnapshotInternal", { storageId, fetchedAt },
  );
  console.log(JSON.stringify(result));
  if (result.status !== "success") throw new Error("USDA import did not complete successfully; see the ingestion ledger");
} catch (error) {
  // The importer normally deletes the file itself. Also clean up if the action
  // request never reached Convex; upload URLs and source files stay out of logs.
  await runFunction("incidents:deleteFsisSnapshot", { storageId }).catch(() => undefined);
  throw error;
}
