import type { ExecutionContext, ScheduledController, MessageBatch } from "@cloudflare/workers-types";
import type { CloudflareBindings } from "./bindings";
import { z } from "zod";
import { readResponseJson } from "../src/lib/http/bounded-response";
import { operations } from "./registry";
import { workerRuntime, type OperationName } from "./runtime";
import { equalSecrets } from "./security";
import { BackendError } from "./values";
import { consumeJob, publishDueJobs, scheduleCron } from "./jobs";
import { internal } from "./api";

const requestSchema = z.strictObject({ operation: z.string().max(100), args: z.record(z.string(), z.unknown()) });
const queueMessage = z.strictObject({ jobId: z.string().min(1).max(100), leaseToken: z.string().uuid() });
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });

const worker = {
  async fetch(request: Request, env: CloudflareBindings, ctx: Pick<ExecutionContext, "waitUntil">) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      await env.DB.prepare("SELECT revision FROM transaction_state WHERE id=1").first();
      return json({ service: "eat-or-yeet-backend", status: "ok" });
    }
    const nested = url.pathname === "/internal/rpc";
    const admin = nested || url.pathname.startsWith("/admin/");
    const fdaListingUpload = url.pathname === "/admin/fda-announcement-listings";
    const snapshotSource = url.pathname === "/admin/fsis" ? "fsis" : url.pathname === "/admin/fda-announcements" || fdaListingUpload ? "fda-announcements" : null;
    const secret = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
    const credential = snapshotSource === "fsis" ? env.FSIS_UPLOAD_TOKEN : snapshotSource === "fda-announcements" ? env.FDA_UPLOAD_TOKEN : admin ? env.BACKEND_ADMIN_TOKEN : env.BACKEND_SECRET;
    if (!equalSecrets(secret, credential)) return json({ error: "Unauthorized" }, 401);
    try {
      if (snapshotSource && request.method === "GET") {
        const runId = z.string().min(1).max(200).safeParse(url.searchParams.get("runId"));
        if (!runId.success) return json({ error: "Invalid run identifier" }, 400);
        const result = await workerRuntime(env).invoke(internal.incidents.getImportResult, { runId: runId.data as import("./values").Id<"ingestionRuns"> });
        return result?.source === snapshotSource ? json({ result }) : json({ error: "Not found" }, 404);
      }
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
      const body = await readResponseJson(new Response(request.body, { headers: request.headers }), admin ? 20 * 1024 * 1024 : 1024 * 1024);
      if (snapshotSource) {
        const cloudFda = process.env.FDA_ANNOUNCEMENTS_FETCH_MODE === "firecrawl";
        if (fdaListingUpload && !cloudFda) return json({ error: "Cloudflare FDA Firecrawl mode is not enabled" }, 409);
        if (snapshotSource === "fda-announcements" && !fdaListingUpload && cloudFda) {
          return json({ error: "FDA announcement imports are owned by the Cloudflare Worker" }, 409);
        }
        const snapshot = z.strictObject({ fetchedAt: z.number().nonnegative(), payload: z.array(z.unknown()).max(20_000) }).parse(body);
        const key = `${snapshotSource}/${crypto.randomUUID()}.json`;
        await env.SNAPSHOTS.put(key, JSON.stringify(snapshot.payload), { httpMetadata: { contentType: "application/json" } });
        try {
          const result = await workerRuntime(env).invoke(snapshotSource === "fsis" ? internal.incidents.importFsisSnapshotInternal : fdaListingUpload ? internal.incidents.importFdaListingSnapshotInternal : internal.incidents.importFdaSnapshotInternal, { storageId: key, fetchedAt: snapshot.fetchedAt });
          ctx.waitUntil(publishDueJobs(env));
          return json({ result }, result.status === "queued" ? 202 : 200);
        } finally { await env.SNAPSHOTS.delete(key); }
      }
      const input = requestSchema.parse(body);
      if (!Object.hasOwn(operations, input.operation)) return json({ error: "Unknown operation" }, 404);
      const operation = operations[input.operation as OperationName];
      if (!admin && (operation.internal || input.operation.startsWith("seed."))) return json({ error: "Unauthorized" }, 403);
      if (url.pathname !== "/rpc" && url.pathname !== "/admin/rpc" && !nested) return json({ error: "Not found" }, 404);
      const result = await workerRuntime(env).invoke({ name: input.operation }, input.args);
      if (!nested) ctx.waitUntil(publishDueJobs(env));
      return json({ result: result ?? null });
    } catch (error) {
      if (error instanceof z.ZodError) return json({ error: "Invalid arguments" }, 400);
      if (error instanceof BackendError) return json({ error: error.data }, 409);
      console.error(JSON.stringify({ event: "backend_error", kind: error instanceof Error ? error.name : "Unknown" }));
      return json({ error: "Backend operation failed" }, 503);
    }
  },
  async scheduled(event: ScheduledController, env: CloudflareBindings) { await scheduleCron(env, event.cron, event.scheduledTime); },
  async queue(batch: MessageBatch<unknown>, env: CloudflareBindings) {
    for (const message of batch.messages) {
      const input = queueMessage.safeParse(message.body);
      if (input.success) await consumeJob(env, input.data.jobId, input.data.leaseToken);
      message.ack();
    }
    await publishDueJobs(env);
  },
};

export default worker;
