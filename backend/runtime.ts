import type { CloudflareBindings } from "./bindings";
import { Database, revision, type SqlDatabase } from "./database";
import { operations } from "./registry";
import type { ActionCtx, MutationCtx, OperationRef } from "./operations";
import { BackendError } from "./values";
import { readResponseJson } from "../src/lib/http/bounded-response";

export type OperationName = keyof typeof operations;
export type Storage = ActionCtx["storage"];
type Invoke = <A, R>(ref: OperationRef<A, R>, args: A) => Promise<R>;
export class Runtime {
  constructor(readonly sql: SqlDatabase, readonly storage: Storage, private readonly dispatch?: Invoke) {}
  async invoke<A, R>(ref: OperationRef<A, R>, args: A): Promise<R> {
    if (!Object.hasOwn(operations, ref.name)) throw new BackendError("Unknown operation");
    const operation = operations[ref.name as OperationName];
    const parsed = operation.validator.parse(args);
    for (let attempt = 0; attempt < 64; attempt += 1) {
      if (attempt > 1) await new Promise((resolve) => setTimeout(resolve, Math.min(100, attempt * 2) + Math.floor(Math.random() * 10)));
      const initial = await revision(this.sql);
      const db = new Database(this.sql, operation.kind === "mutation");
      const invoke: Invoke = this.dispatch ?? ((nested, input) => this.invoke(nested, input));
      const ctx: MutationCtx & ActionCtx = {
        db, runQuery: invoke, runMutation: invoke, runAction: invoke, storage: this.storage,
        scheduler: { runAfter: async (delay, nested, input) => {
          if (operation.kind === "query") throw new Error("Queries cannot schedule jobs");
          if (operation.kind === "mutation") return db.schedule(nested.name, input, delay);
          const scheduled = new Database(this.sql, true);
          const id = scheduled.schedule(nested.name, input, delay);
          await this.commitJobs(scheduled);
          return id;
        } },
      };
      let result: unknown;
      try { result = await operation.handler(ctx, parsed as never); }
      catch (error) {
        if (operation.kind !== "action" && initial !== await revision(this.sql)) continue;
        throw error;
      }
      if (operation.kind === "action") return result as R;
      if (operation.kind === "query") {
        if (initial === await revision(this.sql)) return result as R;
      } else {
        if (!db.changes.size && !db.jobs.length) {
          if (initial === await revision(this.sql)) return result as R;
          continue;
        }
        try { await db.commit(initial); return result as R; }
        catch (error) { if (initial === await revision(this.sql)) throw error; }
      }
    }
    throw new BackendError({ code: "CONCURRENT_UPDATE", message: "Please retry the operation." });
  }
  private async commitJobs(db: Database) {
    for (let attempt = 0; attempt < 64; attempt += 1) {
      if (attempt > 1) await new Promise((resolve) => setTimeout(resolve, Math.min(100, attempt * 2) + Math.floor(Math.random() * 10)));
      const initial = await revision(this.sql);
      try { await db.commit(initial); return; }
      catch (error) { if (initial === await revision(this.sql)) throw error; }
    }
    throw new Error("Job scheduling is temporarily busy");
  }
}

export function workerRuntime(env: CloudflareBindings) {
  return new Runtime(env.DB.withSession("first-primary"), {
    get: async (id) => {
      const object = await env.SNAPSHOTS.get(id);
      if (!object) return null;
      if (object.size > 20 * 1024 * 1024) throw new Error("Snapshot is too large");
      return new Blob([await object.arrayBuffer()], { type: "application/json" });
    },
    put: async (id, body) => { await env.SNAPSHOTS.put(id, body, { httpMetadata: { contentType: "application/json" } }); },
    delete: async (id) => { await env.SNAPSHOTS.delete(id); },
  }, async <A, R>(ref: OperationRef<A, R>, args: A): Promise<R> => {
    // Each nested operation gets its own bounded D1 invocation. Imports keep
    // their existing transactional batches instead of exhausting one event's
    // query budget across an entire source archive.
    const response = await env.SELF.fetch("https://backend.internal/internal/rpc", {
      method: "POST", headers: { Authorization: `Bearer ${env.BACKEND_ADMIN_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ operation: ref.name, args }),
    });
    const body = await readResponseJson<unknown>(response, 2 * 1024 * 1024);
    if (!body || typeof body !== "object") throw new Error("Invalid internal backend response");
    if ("error" in body) throw new BackendError(body.error);
    if (!response.ok || !("result" in body)) throw new Error("Internal backend operation failed");
    return body.result as R;
  });
}
