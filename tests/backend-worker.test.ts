import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const secret = "worker-test-server-secret";
const admin = "worker-test-admin-secret";
let mf: Miniflare;
async function rpc(operation: string, args: unknown, token = secret, path = "/rpc") {
  return mf.dispatchFetch(`https://backend.test${path}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ operation, args }) });
}
beforeAll(async () => {
  const bundle = await build({ entryPoints: ["backend/worker.ts"], bundle: true, write: false, format: "esm", platform: "neutral", target: "es2022", external: ["node:*"], conditions: ["workerd", "worker", "browser"], tsconfig: "tsconfig.json" });
  mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2026-07-01", compatibilityFlags: ["nodejs_compat"],
    d1Databases: { DB: "worker-test-db" }, r2Buckets: ["SNAPSHOTS"], queueProducers: { JOBS: "worker-test-jobs" }, queueConsumers: { "worker-test-jobs": { maxBatchSize: 1, maxBatchTimeout: 0 } },
    bindings: { BACKEND_SECRET: secret, BACKEND_ADMIN_TOKEN: admin, FSIS_UPLOAD_TOKEN: "uploader-only", ALLOW_DEMO_DATA: "true", BACKEND_RESTORE_ENABLED: "false", SCHEDULED_SOURCE_REFRESH: "false", PRODUCT_CATEGORY_LOOKUPS: "false", FSIS_FETCH_MODE: "snapshot" },
  });
  const db = await mf.getD1Database("DB");
  for (const statement of readFileSync("backend/migrations/0001_backend.sql", "utf8").split(";")) if (statement.trim()) await db.prepare(statement).run();
}, 30_000);
afterAll(async () => { await mf?.dispose(); });

describe("Cloudflare Worker with native D1 and R2", () => {
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
});
