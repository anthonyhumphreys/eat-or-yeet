import type { CloudflareBindings } from "./bindings";
import { internal } from "./api";
import { workerRuntime } from "./runtime";
type Job = { id: string; operation: string; args: string; attempts: number };

export async function publishDueJobs(env: CloudflareBindings) {
  const now = Date.now();
  await env.DB.prepare("UPDATE job_outbox SET status='failed' WHERE attempts>=10 AND status='running' AND lease_until<=?").bind(now).run();
  const { results } = await env.DB.prepare("SELECT id FROM job_outbox WHERE due_at <= ? AND attempts < 10 AND (status='pending' OR (status IN ('queued','running') AND lease_until <= ?)) ORDER BY due_at LIMIT 50").bind(now, now).all<{ id: string }>();
  for (const { id } of results) {
    const token = crypto.randomUUID();
    const claimed = await env.DB.prepare("UPDATE job_outbox SET status='queued', lease_until=?, lease_token=? WHERE id=? AND (status='pending' OR (status IN ('queued','running') AND lease_until<=?)) RETURNING id").bind(now + 600_000, token, id, now).first();
    if (!claimed) continue;
    try { await env.JOBS.send({ jobId: id, leaseToken: token }); }
    catch { await env.DB.prepare("UPDATE job_outbox SET status='pending', lease_until=0 WHERE id=? AND status='queued' AND lease_token=?").bind(id, token).run(); }
  }
}

export async function consumeJob(env: CloudflareBindings, jobId: string, leaseToken: string) {
  const now = Date.now();
  const job = await env.DB.prepare("UPDATE job_outbox SET status='running', attempts=attempts+1, lease_until=? WHERE id=? AND status='queued' AND due_at<=? AND lease_token=? RETURNING id, operation, args, attempts").bind(now + 600_000, jobId, now, leaseToken).first<Job>();
  if (!job) return;
  try {
    await workerRuntime(env).invoke({ name: job.operation }, JSON.parse(job.args));
    await env.DB.prepare("UPDATE job_outbox SET status='done', completed_at=?, lease_until=0 WHERE id=? AND status='running' AND lease_token=?").bind(Date.now(), jobId, leaseToken).run();
  } catch {
    const delay = Math.min(3_600_000, 5_000 * 2 ** Math.min(job.attempts, 10));
    await env.DB.prepare("UPDATE job_outbox SET status=?, due_at=?, lease_until=0 WHERE id=? AND status='running' AND lease_token=?").bind(job.attempts >= 10 ? "failed" : "pending", Date.now() + delay, jobId, leaseToken).run();
    console.error(JSON.stringify({ event: "job_failed", operation: job.operation, attempt: job.attempts }));
  }
}

export async function scheduleCron(env: CloudflareBindings, cron: string, scheduledTime: number) {
  const refs = {
    "17 4 * * *": internal.incidents.refreshScheduledInternal,
    "17 5 * * *": internal.incidents.cleanupExpired,
    "23 5 * * *": internal.notion.cleanupScheduled,
    "41 * * * *": internal.products.lookupProductCategories,
  };
  const ref = refs[cron as keyof typeof refs];
  if (ref) await env.DB.prepare("INSERT OR IGNORE INTO job_outbox(id, operation, args, due_at) VALUES (?, ?, '{}', ?)").bind(`cron:${cron}:${scheduledTime}`, ref.name, scheduledTime).run();
  await publishDueJobs(env);
  await env.DB.prepare("DELETE FROM job_outbox WHERE status='done' AND completed_at < ?").bind(Date.now() - 7 * 86_400_000).run();
}
