import { FSIS_API, parseFsisRecords } from "../../src/lib/incidents/fsis";
import { fetchOfficialJson } from "../../src/lib/incidents/official-source-http";
import { uploadSnapshot } from "./snapshot-upload";

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
  return uploadSnapshot(url, env.FSIS_UPLOAD_TOKEN, "USDA", incidents.map(item => item.originalSourceData), fetchedAt);
}
