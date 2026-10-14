import { setTimeout as pause } from "node:timers/promises";
import { z } from "zod";
import { FSIS_API, parseFsisRecords } from "../../src/lib/incidents/fsis";
import { fetchOfficialJson } from "../../src/lib/incidents/official-source-http";
import { readResponseJson } from "../../src/lib/http/bounded-response";

const importResultSchema = z.object({
  status: z.string(), runId: z.string().optional(), found: z.number(), created: z.number(), updated: z.number(), errors: z.array(z.string()),
});
type SyncOptions = { prod?: boolean; env?: NodeJS.ProcessEnv };

export async function syncFsis(options: SyncOptions = {}) {
  const env = options.env ?? process.env;
  if (options.prod && env.BACKEND_ENV !== "production") throw new Error("--prod requires BACKEND_ENV=production and an explicit BACKEND_URL");
  if (!env.BACKEND_URL || !env.FSIS_UPLOAD_TOKEN) throw new Error("BACKEND_URL and FSIS_UPLOAD_TOKEN are required");
  const url = new URL("/admin/fsis", env.BACKEND_URL);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) throw new Error("The backend requires HTTPS");
  const payload = await fetchOfficialJson(FSIS_API, {
    sourceName: "FSIS Recall API", headers: { Accept: "application/json" }, timeoutMs: 30_000, cache: "no-store",
  });
  const fetchedAt = Date.now();
  const incidents = parseFsisRecords(payload);
  console.log(`Validated ${incidents.length} English USDA notices, including ${incidents.filter((item) => item.status === "active").length} active notices.`);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.FSIS_UPLOAD_TOKEN}` },
      body: JSON.stringify({ fetchedAt, payload: incidents.map((item) => item.originalSourceData) }),
      redirect: "error", signal: AbortSignal.timeout(5 * 60 * 1_000),
    });
  } catch { throw new Error("USDA upload request failed; check backend access and the ingestion ledger"); }
  if (!response.ok) throw new Error(`USDA upload returned HTTP ${response.status}`);
  let result = z.object({ result: importResultSchema }).parse(await readResponseJson(response, 1024 * 1024)).result;
  const deadline = Date.now() + 15 * 60 * 1_000;
  while (result.status === "queued" || result.status === "running") {
    if (!result.runId || Date.now() >= deadline) throw new Error("USDA import did not finish within 15 minutes; see the ingestion ledger");
    await pause(2_000);
    const statusUrl = new URL(url);
    statusUrl.searchParams.set("runId", result.runId);
    const status = await fetch(statusUrl, { headers: { Authorization: `Bearer ${env.FSIS_UPLOAD_TOKEN}` }, redirect: "error", signal: AbortSignal.timeout(30_000) });
    if (!status.ok) throw new Error(`USDA import status returned HTTP ${status.status}`);
    result = z.object({ result: importResultSchema }).parse(await readResponseJson(status, 1024 * 1024)).result;
  }
  if (result.status !== "success") throw new Error("USDA import did not complete successfully; see the ingestion ledger");
  return result;
}
