import { spawn, type ChildProcess } from "node:child_process";
import nextEnv from "@next/env";
import { developmentTarget, ensureLocalEnvironment, type DevelopmentEnv } from "./dev-env";
import { fetchMutation } from "../backend/http-client";
import { api } from "../backend/api";

const children = new Set<ChildProcess>();
let stopping = false;
function stop() { stopping = true; for (const child of children) child.kill("SIGTERM"); }
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
function start(args: string[], env: DevelopmentEnv) {
  const pnpm = process.env.npm_execpath;
  if (!pnpm) throw new Error("Start this script through pnpm");
  const child = spawn(process.execPath, [pnpm, ...args], { env: { ...env, NODE_ENV: "development" }, stdio: "inherit" });
  children.add(child);
  const done = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      children.delete(child);
      if (stopping || code === 0) resolve(); else reject(new Error(`pnpm ${args.join(" ")} exited with code ${code}`));
    });
  });
  return { child, done };
}
async function main() {
  let env = nextEnv.loadEnvConfig(process.cwd(), true).combinedEnv;
  const target = developmentTarget(env);
  if (target === "local") {
    ensureLocalEnvironment(process.cwd(), env);
    env = nextEnv.loadEnvConfig(process.cwd(), true, console, true).combinedEnv;
  }
  if (!env.BACKEND_SECRET) throw new Error("Set BACKEND_SECRET for the selected backend");
  Object.assign(process.env, env);
  let worker: ReturnType<typeof start> | undefined;
  if (target === "local" && !process.argv.includes("--app")) {
    await start(["exec", "wrangler", "d1", "migrations", "apply", "DB", "--local"], env).done;
    const url = new URL(env.BACKEND_URL!);
    worker = start(["exec", "wrangler", "dev", "--local", "--ip", url.hostname, "--port", url.port || "8787"], env);
    const ready = async () => {
      for (let attempt = 0; attempt < 60 && !stopping; attempt++) {
        try { if ((await fetch(new URL("/health", url), { signal: AbortSignal.timeout(1_000) })).ok) return; } catch { /* Startup in progress. */ }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      throw new Error("Local Worker did not become ready");
    };
    await Promise.race([ready(), worker.done.then(() => { throw new Error("Local Worker stopped during startup"); })]);
    if (env.ALLOW_DEMO_DATA === "true") await fetchMutation(api.seed.demo, { secret: env.BACKEND_SECRET! }, { admin: true });
    console.log("Local Cloudflare backend ready. Demo data does not establish official-source coverage.");
  }
  const web = start(["exec", "next", "dev", ...process.argv.slice(2).filter((arg) => arg !== "--app")], env);
  await (worker ? Promise.race([web.done, worker.done]) : web.done);
}
main().catch((error: unknown) => {
  if (!stopping) { console.error(error instanceof Error ? error.message : "Development startup failed"); process.exitCode = 1; }
}).finally(stop);
