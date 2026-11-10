import { createHmac } from "node:crypto";
import { build } from "esbuild";
import { createFetchMock, Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { migrationStatements } from "./migration-statements";

const monitorId = "00000000-0000-4000-8000-000000000010";
const webhookSecret = "private-monitor-hmac-fixture";
const uploader = "private-fda-uploader-fixture";
const prefix = "/safety/recalls-market-withdrawals-safety-alerts/";
let mf: Miniflare;
let paidCalls = 0;
const signature = (body: string) => `sha256=${createHmac("sha256", webhookSecret).update(body).digest("hex")}`;
function payload(path = "native-fixture") {
  const id = crypto.randomUUID();
  return { type: "monitor.page", id, data: [{ monitorId, checkId: id, url: `https://www.fda.gov${prefix}${path}`, status: "changed" }] };
}
async function send(body: string, signed = signature(body)) {
  return mf.dispatchFetch("https://backend.test/webhooks/firecrawl/fda", { method: "POST", headers: { "X-Firecrawl-Signature": signed, "Content-Type": "application/json" }, body });
}
beforeAll(async () => {
  const bundle = await build({ entryPoints: ["backend/worker.ts"], bundle: true, write: false, format: "esm", platform: "neutral", target: "es2022", external: ["node:*"], conditions: ["workerd", "worker", "browser"], tsconfig: "tsconfig.json" });
  const fetchMock = createFetchMock(); fetchMock.disableNetConnect();
  const vendor = fetchMock.get("https://api.firecrawl.dev");
  vendor.intercept({ path: "/v2/scrape", method: "POST" }).reply(200, () => {
    paidCalls++;
    const url = `https://www.fda.gov${prefix}native-flow`;
    const html = `<link rel="canonical" href="${url}"><h2 id="recall-announcement">Announcement</h2><p>Updated instructions: consumers should return the product.</p><h2>Contact</h2>`;
    return JSON.stringify({ success: true, data: { rawBase64: Buffer.from(html).toString("base64"), metadata: { sourceURL: url, url, statusCode: 200 } } });
  }).persist();
  vendor.intercept({ path: `/v2/monitor/${monitorId}`, method: "GET" }).reply(200, { success: true, data: { id: monitorId, name: "Eat or Yeet FDA native test", targets: [{ id: monitorId, type: "scrape", urls: [] }] } }).persist();
  vendor.intercept({ path: `/v2/monitor/${monitorId}`, method: "PATCH" }).reply(200, { success: true }).persist();
  mf = new Miniflare({ name: "fda-monitor-test", serviceBindings: { SELF: "fda-monitor-test" }, modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: "2026-07-01", compatibilityFlags: ["nodejs_compat"], fetchMock,
    d1Databases: { DB: "fda-monitor-native" }, r2Buckets: ["SNAPSHOTS"], queueProducers: { JOBS: "fda-monitor-native-jobs" },
    queueConsumers: { "fda-monitor-native-jobs": { maxBatchSize: 1, maxBatchTimeout: 0 } },
    bindings: { BACKEND_ADMIN_TOKEN: "private-admin-fixture", BACKEND_SECRET: "private-server-fixture", FDA_UPLOAD_TOKEN: uploader,
      FIRECRAWL_API_KEY: "private-firecrawl-fixture", FIRECRAWL_WEBHOOK_SECRET: webhookSecret, FDA_MONITOR_ENABLED: "true", FDA_MONITOR_ID: monitorId,
      FDA_MONITOR_DETAIL_LIMIT: "5", FDA_ANNOUNCEMENTS_FETCH_MODE: "firecrawl", ALLOW_DEMO_DATA: "false" },
  });
  const db = await mf.getD1Database("DB");
  for (const sql of migrationStatements()) await db.prepare(sql).run();
}, 30_000);
afterAll(async () => { await mf?.dispose(); });

describe("FDA Monitor signed HTTP → D1 → queue → original-byte parser", () => {
  it("rejects invalid signatures, changed raw bodies, unrelated monitor IDs, and off-domain URLs", async () => {
    const body = JSON.stringify(payload());
    expect((await send(body, "sha256=" + "0".repeat(64))).status).toBe(401);
    expect((await send(body + " ", signature(body))).status).toBe(401);
    const wrong = payload(); wrong.data[0].monitorId = crypto.randomUUID();
    expect((await send(JSON.stringify(wrong))).status).toBe(400);
    const external = payload(); external.data[0].url = "https://example.com/recall";
    expect((await send(JSON.stringify(external))).status).toBe(400);
    expect((await send("not JSON")).status).toBe(400);
    expect((await send(" ".repeat(256 * 1024 + 1))).status).toBe(413);
    expect(paidCalls).toBe(0);
  });

  it("acknowledges only durable deduplicated intent and protects the source uploader endpoint", async () => {
    const body = JSON.stringify(payload());
    expect((await send(body)).status).toBe(202);
    expect((await send(body)).status).toBe(202);
    const db = await mf.getD1Database("DB");
    expect(await db.prepare("SELECT count(*) AS n FROM records WHERE table_name='fdaMonitorReceipts'").first()).toEqual({ n: 1 });
    expect(await db.prepare("SELECT json_extract(payload,'$.pending') AS n FROM records WHERE table_name='fdaMonitorControl'").first()).toEqual({ n: 1 });
    expect((await mf.dispatchFetch("https://backend.test/admin/fda-monitor", { headers: { Authorization: "Bearer private-server-fixture" } })).status).toBe(401);
    expect(paidCalls).toBe(0);
  });

  it("imports only the changed notice after validated listing handoff, with no successful full-source ledger", async () => {
    const input = payload("native-flow");
    expect((await send(JSON.stringify(input))).status).toBe(202);
    const status = await mf.dispatchFetch("https://backend.test/admin/fda-monitor", { headers: { Authorization: `Bearer ${uploader}` } });
    const { result } = await status.json() as { result: { requestedVersion: number } };
    const listing = { path: prefix + "native-flow", publishedAt: Date.parse("2026-10-01"), brand: "Fixture", product: "Fixture food",
      company: "Fixture Foods", productType: "Food & Beverages", reason: "Undeclared milk", terminated: false, terminationStatus: "" };
    const response = await mf.dispatchFetch("https://backend.test/admin/fda-monitor", { method: "POST", headers: { Authorization: `Bearer ${uploader}`, "Content-Type": "application/json" },
      body: JSON.stringify({ version: result.requestedVersion, fetchedAt: Date.now(), payload: [listing] }) });
    expect(response.status).toBe(200);
    const db = await mf.getD1Database("DB");
    await vi.waitFor(async () => {
      const row = await db.prepare("SELECT payload FROM records WHERE table_name='incidents'").first<{ payload: string }>();
      expect(row && JSON.parse(row.payload)).toMatchObject({ sourceId: `announcement:${listing.path}`, summary: "Updated instructions: consumers should return the product." });
    }, { timeout: 10_000 });
    expect(paidCalls).toBe(1);
    expect(await db.prepare("SELECT count(*) AS n FROM records WHERE table_name='ingestionRuns'").first()).toEqual({ n: 0 });
    expect(await db.prepare("SELECT json_extract(payload,'$.pending') AS n FROM records WHERE table_name='fdaMonitorControl'").first()).toEqual({ n: 0 });
    expect((await send(JSON.stringify(input))).status).toBe(202);
    expect(paidCalls).toBe(1);
  }, 15_000);
});
