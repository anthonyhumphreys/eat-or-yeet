import { readFileSync } from "node:fs";
import { Database, revision } from "../backend/database";
import { Runtime } from "../backend/runtime";
import type { MutationCtx } from "../backend/operations";
import { sqliteD1 } from "./sqlite-d1";

export function createBackend() {
  const sql = sqliteD1();
  const migrations = readFileSync(new URL("../backend/migrations/0001_backend.sql", import.meta.url), "utf8");
  const ready = sql.batch(migrations.split(";\n").filter((statement) => statement.trim()).map((statement) => sql.prepare(statement)));
  const runtime = new Runtime(sql, { get: async () => null, put: async () => undefined, delete: async () => undefined });
  const invoke: Runtime["invoke"] = async (ref, args) => { await ready; return runtime.invoke(ref, args); };
  return {
    query: invoke, mutation: invoke, action: invoke,
    async run<T>(callback: (ctx: MutationCtx) => Promise<T>) {
      await ready;
      const db = new Database(sql, true);
      const initial = await revision(sql);
      const result = await callback({ db, scheduler: { runAfter: async (delay, ref, args) => db.schedule(ref.name, args, delay) } });
      await db.commit(initial);
      return result;
    },
    async scheduledJobs() { await ready; return (await sql.prepare("SELECT * FROM job_outbox ORDER BY due_at, id").all()).results; },
    async finishAllScheduledFunctions(advanceTimers?: () => unknown) {
      await ready;
      for (let iteration = 0; iteration < 100; iteration += 1) {
        await advanceTimers?.();
        const jobs = await sql.prepare("SELECT id, operation, args FROM job_outbox WHERE status='pending' ORDER BY due_at LIMIT 10").all<{ id: string; operation: string; args: string }>();
        if (!jobs.results.length) return;
        for (const job of jobs.results) {
          await runtime.invoke({ name: job.operation }, JSON.parse(job.args));
          await sql.prepare("UPDATE job_outbox SET status='done' WHERE id=?").bind(job.id).run();
        }
      }
      throw new Error("Scheduled test work did not finish");
    },
  };
}
