import { migrationStatements } from "./migration-statements";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parseFdaAnnouncementDetail, parseFdaAnnouncementRows } from "../src/lib/incidents/fda-announcements";
import { serialiseSourceIncident } from "../src/lib/incidents/serialise";

const secret = "worker-test-server-secret";
const admin = "worker-test-admin-secret";
let mf: Miniflare;
async function rpc(operation: string, args: unknown, token = secret, path = "/rpc") {
  return mf.dispatchFetch(`https://backend.test${path}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ operation, args }) });
}
beforeAll(async () => {
  const bundle = await build({ entryPoints: ["backend/worker.ts"], bundle: true, write: false, format: "esm", platform: "neutral", target: "es2022", external: ["node:*"], conditions: ["workerd", "worker", "browser"], tsconfig: "tsconfig.json" });
  mf = new Miniflare({ name: "backend-test", serviceBindings: { SELF: "backend-test" }, modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2026-07-01", compatibilityFlags: ["nodejs_compat"],
    d1Databases: { DB: "worker-test-db" }, r2Buckets: ["SNAPSHOTS"], queueProducers: { JOBS: "worker-test-jobs" }, queueConsumers: { "worker-test-jobs": { maxBatchSize: 1, maxBatchTimeout: 0 } },
    bindings: { BACKEND_SECRET: secret, BACKEND_ADMIN_TOKEN: admin, FSIS_UPLOAD_TOKEN: "uploader-only", FDA_UPLOAD_TOKEN: "fda-uploader-only", ALLOW_DEMO_DATA: "true", BACKEND_RESTORE_ENABLED: "false", SCHEDULED_SOURCE_REFRESH: "false", PRODUCT_CATEGORY_LOOKUPS: "false", FSIS_FETCH_MODE: "snapshot", FDA_ANNOUNCEMENTS_FETCH_MODE: "snapshot" },
  });
  const db = await mf.getD1Database("DB");
  for (const statement of migrationStatements()) if (statement.trim()) await db.prepare(statement).run();
}, 30_000);
afterAll(async () => { await mf?.dispose(); });

describe("Cloudflare Worker with native D1 and R2", () => {
  it("reconciles USDA URL changes through snapshot upload, D1 and durable batches", async () => {
    const record = {
      field_title: "Example Foods Recalls Beef Stew", field_recall_number: "001-2026", field_recall_number_export: "001-2026",
      field_recall_url: "https://www.fsis.usda.gov/recalls-alerts/original-url", field_recall_date: "2026-10-01",
      field_active_notice: "True", field_summary: "<p>Return the product.</p>", langcode: "English",
    };
    async function upload(payload: unknown[]) {
      const response = await mf.dispatchFetch("https://backend.test/admin/fsis", {
        method: "POST", headers: { Authorization: "Bearer uploader-only", "Content-Type": "application/json" },
        body: JSON.stringify({ fetchedAt: Date.now(), payload }),
      });
      const body = await response.json() as { result: { runId: string; status: string } };
      if (body.result.status === "failed") return body.result;
      let completed: unknown;
      await vi.waitFor(async () => {
        const status = await mf.dispatchFetch(`https://backend.test/admin/fsis?runId=${encodeURIComponent(body.result.runId)}`, { headers: { Authorization: "Bearer uploader-only" } });
        const value = await status.json() as { result: { status: string } };
        expect(value.result.status).toBe("success");
        completed = value.result;
      });
      return completed;
    }
    const db = await mf.getD1Database("DB");
    const rows = () => db.prepare("SELECT id,payload FROM records WHERE table_name='incidents' AND json_extract(payload,'$.sourceKey')='fsis'").all<{ id: string; payload: string }>();
    expect(await upload([record])).toMatchObject({ created: 1 });
    const original = (await rows()).results[0];
    const renamed = { ...record, field_recall_url: "https://www.fsis.usda.gov/recalls-alerts/new-url" };
    expect(await upload([renamed])).toMatchObject({ created: 0, updated: 1 });
    expect(await upload([renamed])).toMatchObject({ created: 0, updated: 0 });
    const after = (await rows()).results;
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(original.id);
    expect(JSON.parse(after[0].payload)).toMatchObject({ sourceId: "/recalls-alerts/original-url", slug: JSON.parse(original.payload).slug, authorityUrl: renamed.field_recall_url });
    expect(await upload([{ ...renamed, field_recall_number: "002-2026", field_recall_number_export: "002-2026" }])).toMatchObject({ status: "failed" });
    expect(await upload([{ ...renamed, field_active_notice: "False" }])).toMatchObject({ created: 0, updated: 1 });
    expect(JSON.parse((await rows()).results[0].payload).status).toBe("resolved");
  });

  it("maintains and queries the trigram browse index through native D1", async () => {
    await rpc("seed.demo", { secret }, admin, "/admin/rpc");
    const response = await rpc("incidents.getBySlug", { slug: "demo-northstar-peanut-bites", includeDemo: true });
    const { result } = await response.json() as {result:Record<string,unknown>};
    const { _id, _creationTime, superCategories: _categories, ...record } = result; void _id; void _creationTime; void _categories;
    expect((await rpc("incidents.upsertBatch",{items:[{...record,originalSourceData:{},retrievedAt:Date.now(),isDemo:false,slug:"native-browse-fixture",sourceId:"native-browse-fixture"}]},admin,"/admin/rpc")).status).toBe(200);
    const page = await rpc("browse.list",{region:"UK",filters:{q:"northstar"}});
    expect(page.status).toBe(200);
    expect(await page.json()).toMatchObject({result:{total:1,rows:[{slug:"native-browse-fixture"}]}});
    await rpc("incidents.upsertBatch",{items:[{...record,originalSourceData:{},retrievedAt:Date.now(),isDemo:false,status:"resolved",slug:"native-browse-fixture",sourceId:"native-browse-fixture"}]},admin,"/admin/rpc");
  });

  it("restricts operator operations and rejects undeclared or prototype operation names", async () => {
    expect((await rpc("incidents.getDatasetVersion", {}, "wrong")).status).toBe(401);
    expect((await rpc("seed.demo", { secret })).status).toBe(403);
    expect((await rpc("migration.restore", { table: "products", rows: [] })).status).toBe(403);
    expect((await rpc("toString", {})).status).toBe(404);
    expect((await rpc("seed.demo", { secret }, "uploader-only", "/admin/rpc")).status).toBe(401);
    expect((await rpc("migration.restore", { table: "products", rows: [] }, admin, "/admin/rpc")).status).toBe(503);
  });
  it("runs real domain writes and indexed reads through the authenticated HTTP client", async () => {
    const seeded = await rpc("seed.demo", { secret }, admin, "/admin/rpc");
    expect(seeded.status).toBe(200);
    expect(await seeded.json()).toEqual({ result: 3 });
    const result = await rpc("incidents.getBySlug", { slug: "demo-northstar-peanut-bites", includeDemo: true });
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ result: { slug: "demo-northstar-peanut-bites" } });
  });
  it("rolls back stale D1 commits without modifying records or publishing jobs", async () => {
    const db = await mf.getD1Database("DB");
    const before = await db.prepare("SELECT revision FROM transaction_state WHERE id=1").first<{ revision: number }>();
    await expect(db.batch([
      db.prepare("UPDATE transaction_state SET revision=revision+1, token='new' WHERE id=1 AND revision=?").bind(before!.revision - 1),
      db.prepare("INSERT OR REPLACE INTO transaction_assertion(id,valid) VALUES(1,(SELECT token='new' FROM transaction_state WHERE id=1))"),
      db.prepare("INSERT INTO job_outbox(id,operation,args,due_at) VALUES('must-rollback','seed.demo','{}',0)"),
    ])).rejects.toThrow();
    expect(await db.prepare("SELECT id FROM job_outbox WHERE id='must-rollback'").first()).toBeNull();
    expect(await db.prepare("SELECT revision FROM transaction_state WHERE id=1").first()).toEqual(before);
  });
  it("publishes durable jobs and ignores duplicate deliveries after completion", async () => {
    const db = await mf.getD1Database("DB");
    await db.prepare("INSERT INTO job_outbox(id,operation,args,due_at) VALUES('cleanup-test','incidents.cleanupExpired','{}',0)").run();
    await rpc("incidents.getDatasetVersion", {});
    await vi.waitFor(async () => expect(await db.prepare("SELECT status,attempts FROM job_outbox WHERE id='cleanup-test'").first()).toEqual({ status: "done", attempts: 1 }));
    const row = await db.prepare("SELECT lease_token FROM job_outbox WHERE id='cleanup-test'").first<{ lease_token: string }>();
    const queue = await mf.getQueueProducer("JOBS");
    await queue.send({ jobId: "cleanup-test", leaseToken: row!.lease_token });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await db.prepare("SELECT status,attempts FROM job_outbox WHERE id='cleanup-test'").first()).toEqual({ status: "done", attempts: 1 });
  });
  it("removes temporary R2 uploads and records failed USDA validation", async () => {
    const result = await mf.dispatchFetch("https://backend.test/admin/fsis", {
      method: "POST", headers: { Authorization: "Bearer uploader-only", "Content-Type": "application/json" },
      body: JSON.stringify({ fetchedAt: Date.now(), payload: [{ malformed: true }] }),
    });
    expect(await result.json()).toMatchObject({ result: { status: "failed" } });
    expect((await (await mf.getR2Bucket("SNAPSHOTS")).list()).objects).toEqual([]);
    const status = await rpc("incidents.getDatasetStatus", { region: "US" });
    expect(await status.json()).toMatchObject({ result: { healthy: false } });
  });
  it("imports USDA across durable batches and reports completion through the upload credential", async () => {
    const payload = Array.from({ length: 26 }, (_, index) => ({
      field_title: `Native USDA test ${index}`, field_recall_number: `test-${index}-2026`, field_recall_number_export: `test-${index}-2026`,
      field_recall_url: `https://www.fsis.usda.gov/recalls-alerts/native-test-${index}`, field_recall_date: "2026-10-01",
      field_active_notice: "TRUE", field_summary: "Do not eat this food.", langcode: "English",
    }));
    const response = await mf.dispatchFetch("https://backend.test/admin/fsis", {
      method: "POST", headers: { Authorization: "Bearer uploader-only", "Content-Type": "application/json" },
      body: JSON.stringify({ fetchedAt: Date.now(), payload }),
    });
    expect(response.status).toBe(202);
    const { result } = await response.json() as { result: { runId: string } };
    const statusUrl = `https://backend.test/admin/fsis?runId=${encodeURIComponent(result.runId)}`;
    expect((await mf.dispatchFetch(statusUrl, { headers: { Authorization: `Bearer ${secret}` } })).status).toBe(401);
    await vi.waitFor(async () => {
      const status = await mf.dispatchFetch(statusUrl, { headers: { Authorization: "Bearer uploader-only" } });
      expect(await status.json()).toMatchObject({ result: { status: "success", found: 26, created: 26, updated: 0 } });
    }, { timeout: 10_000 });
    const db = await mf.getD1Database("DB");
    const run = await db.prepare("SELECT payload FROM records WHERE id=?").bind(result.runId).first<{ payload: string }>();
    const pipeline = JSON.parse(run!.payload).pipeline;
    expect(pipeline.nextBatch).toBe(2);
    // A redelivered committed batch must not change counters or versions.
    const version = await rpc("incidents.getDatasetVersion", { region: "US" });
    const before = await version.json();
    expect(await (await rpc("incidents.applyImportBatch", { runId: result.runId, index: 1, items: payload }, admin, "/admin/rpc")).json()).toMatchObject({ error: "Invalid arguments" });
    expect(await (await rpc("incidents.applyImportBatch", { runId: result.runId, index: 1, items: [] }, admin, "/admin/rpc")).json()).toEqual({ result: { applied: false } });
    expect(await (await rpc("incidents.getDatasetVersion", { region: "US" })).json()).toEqual(before);
    await vi.waitFor(async () => expect((await (await mf.getR2Bucket("SNAPSHOTS")).list()).objects).toEqual([]));
  });
  it("restricts FDA snapshots to their own credential and canonical food announcement records", async () => {
    const [listing] = parseFdaAnnouncementRows({ data: [[ '<time datetime="2026-10-01T00:00:00Z">10/01/2026</time>',
      '<a href="/safety/recalls-market-withdrawals-safety-alerts/native-test">Brand</a>', "Sprouts", "Food &amp; Beverages", "Salmonella", "Example Foods", "", "" ]] });
    const item = serialiseSourceIncident(parseFdaAnnouncementDetail(listing, '<h2 id="recall-announcement">Company Announcement</h2><p>Consumers should return this product.</p>'));
    const upload = (payload: unknown[], token: string) => mf.dispatchFetch("https://backend.test/admin/fda-announcements", {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ fetchedAt: Date.now(), payload }),
    });
    expect((await upload([item], "uploader-only")).status).toBe(401);
    expect((await rpc("incidents.getDatasetVersion", {}, "fda-uploader-only", "/admin/rpc")).status).toBe(401);
    expect(await (await upload([{ ...item, authorityUrl: "https://example.test/fake" }], "fda-uploader-only")).json()).toMatchObject({ result: { status: "failed" } });
    const response = await upload([item], "fda-uploader-only");
    expect(response.status).toBe(202);
    const { result } = await response.json() as { result: { runId: string } };
    await vi.waitFor(async () => {
      const status = await mf.dispatchFetch(`https://backend.test/admin/fda-announcements?runId=${encodeURIComponent(result.runId)}`, { headers: { Authorization: "Bearer fda-uploader-only" } });
      expect(await status.json()).toMatchObject({ result: { status: "success", found: 1, created: 1 } });
    });
    expect((await mf.dispatchFetch(`https://backend.test/admin/fsis?runId=${encodeURIComponent(result.runId)}`, { headers: { Authorization: "Bearer uploader-only" } })).status).toBe(404);
    await vi.waitFor(async () => expect((await (await mf.getR2Bucket("SNAPSHOTS")).list()).objects).toEqual([]));
  });
});
