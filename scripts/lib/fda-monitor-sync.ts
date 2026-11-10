import { z } from "zod";
import { fetchFdaAnnouncementListings } from "../../src/lib/incidents/fda-announcements";
import { fdaListingSnapshotSchema } from "../../src/lib/incidents/fda-listing-snapshot";
import { readResponseJson } from "../../src/lib/http/bounded-response";

const statusSchema = z.object({ result: z.object({ enabled: z.boolean(), requestedVersion: z.number().int().nonnegative(), fulfilledVersion: z.number().int().nonnegative() }) });
function monitorUrl(env: NodeJS.ProcessEnv) {
  if (!env.BACKEND_URL || !env.FDA_UPLOAD_TOKEN) throw new Error("FDA monitor polling requires its backend URL and upload token");
  const url = new URL("/admin/fda-monitor", env.BACKEND_URL);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("FDA monitor polling requires HTTPS");
  return url;
}
export async function readFdaMonitorStatus(env: NodeJS.ProcessEnv) {
  const response = await fetch(monitorUrl(env), { headers: { Authorization: `Bearer ${env.FDA_UPLOAD_TOKEN}` }, redirect: "error", signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`FDA monitor status returned HTTP ${response.status}`);
  return statusSchema.parse(await readResponseJson(response, 64 * 1024)).result;
}
export async function pollFdaMonitor(env: NodeJS.ProcessEnv) {
  if (env.FDA_MONITOR_ENABLED !== "true" || env.FDA_ANNOUNCEMENTS_UPLOAD_MODE !== "listings") return;
  const status = await readFdaMonitorStatus(env);
  if (!status.enabled || status.requestedVersion <= status.fulfilledVersion) return;
  const payload = fdaListingSnapshotSchema.parse((await fetchFdaAnnouncementListings()).map(item => ({ ...item, publishedAt: item.publishedAt.getTime() })));
  let response: Response;
  try {
    response = await fetch(monitorUrl(env), { method: "POST", headers: { Authorization: `Bearer ${env.FDA_UPLOAD_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ payload, fetchedAt: Date.now(), version: status.requestedVersion }), redirect: "error", signal: AbortSignal.timeout(5 * 60_000) });
  } catch { throw new Error("FDA monitor listing upload failed"); }
  if (!response.ok) throw new Error(`FDA monitor listing upload returned HTTP ${response.status}`);
  z.object({ result: z.object({ accepted: z.literal(true) }) }).parse(await readResponseJson(response, 64 * 1024));
}
