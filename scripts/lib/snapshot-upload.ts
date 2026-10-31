import { setTimeout as pause } from "node:timers/promises";
import { z } from "zod";
import { readResponseJson } from "../../src/lib/http/bounded-response";
const importResultSchema = z.object({ status: z.string(), runId: z.string().optional(), found: z.number(), created: z.number(), updated: z.number(), errors: z.array(z.string()) });
export async function uploadSnapshot(url: URL, token: string, label: string, payload: unknown[], fetchedAt: number, completionMinutes = 15) {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ fetchedAt, payload }),
      redirect: "error", signal: AbortSignal.timeout(5 * 60 * 1_000),
    });
  } catch { throw new Error(`${label} upload request failed; check backend access and the ingestion ledger`); }
  if (!response.ok) throw new Error(`${label} upload returned HTTP ${response.status}`);
  let result = z.object({ result: importResultSchema }).parse(await readResponseJson(response, 1024 * 1024)).result;
  const deadline = Date.now() + completionMinutes * 60 * 1_000;
  while (result.status === "queued" || result.status === "running") {
    if (!result.runId || Date.now() >= deadline) throw new Error(`${label} import did not finish within ${completionMinutes} minutes; see the ingestion ledger`);
    await pause(2_000);
    const statusUrl = new URL(url);
    statusUrl.searchParams.set("runId", result.runId);
    let status: Response;
    try { status = await fetch(statusUrl, { headers: { Authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(30_000) }); }
    catch { continue; }
    if (status.status >= 500 || status.status === 408 || status.status === 429) continue;
    if (!status.ok) throw new Error(`${label} import status returned HTTP ${status.status}`);
    result = z.object({ result: importResultSchema }).parse(await readResponseJson(status, 1024 * 1024)).result;
  }
  if (result.status !== "success") throw new Error(`${label} import did not complete successfully; see the ingestion ledger`);
  return result;
}
