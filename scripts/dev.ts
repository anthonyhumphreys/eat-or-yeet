import { spawn } from "node:child_process";

import nextEnv from "@next/env";

import { developmentTarget, ensureLocalEnvironment, isLoopbackUrl, type DevelopmentEnv } from "./dev-env";

const { loadEnvConfig } = nextEnv;
const convexVariables = ["CONVEX_DEPLOYMENT", "NEXT_PUBLIC_CONVEX_URL", "NEXT_PUBLIC_CONVEX_SITE_URL"];
const appVariables = ["CONVEX_SERVER_SECRET", "RATE_LIMIT_SALT", "CRON_SECRET", "ALLOW_DEMO_DATA", "NEXT_PUBLIC_APP_URL"];

class DevelopmentInterrupted extends Error {
  constructor(readonly exitCode: number) { super("Development stopped."); }
}

async function runPnpm(args: string[], env: DevelopmentEnv, input?: string): Promise<void> {
  const pnpm = process.env.npm_execpath;
  if (!pnpm) throw new Error("Start this script with pnpm dev.");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [pnpm, ...args], {
      env: { ...env, NODE_ENV: "development" },
      stdio: [input === undefined ? "inherit" : "pipe", "inherit", "inherit"],
    });
    const interrupt = () => { child.kill("SIGINT"); };
    const terminate = () => { child.kill("SIGTERM"); };
    process.on("SIGINT", interrupt);
    process.on("SIGTERM", terminate);
    child.stdin?.on("error", () => { /* Child exit below reports a failed command. */ });
    if (input !== undefined) child.stdin?.end(input);
    const cleanup = () => {
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", terminate);
    };
    child.once("error", (error) => { cleanup(); reject(error); });
    child.once("exit", (code, signal) => {
      cleanup();
      if (signal) reject(new DevelopmentInterrupted(signal === "SIGINT" ? 130 : 143));
      else if (code === 130 || code === 143) reject(new DevelopmentInterrupted(code));
      else if (code === 0) resolve();
      else reject(new Error(`pnpm ${args.join(" ")} exited with code ${code}.`));
    });
  });
}

async function main(): Promise<void> {
  if (process.argv.includes("--app") && process.env.EOY_DEV_SHELL_CONVEX_ENV) {
    // Convex's subprocess can inherit stale file values from before its first configuration.
    // Reload those from disk while preserving overrides that originally came from the shell.
    const original: DevelopmentEnv = JSON.parse(process.env.EOY_DEV_SHELL_CONVEX_ENV);
    for (const name of convexVariables) delete process.env[name];
    Object.assign(process.env, original);
    delete process.env.EOY_DEV_SHELL_CONVEX_ENV;
  }
  // Do not pass pre-configuration URL values to --start: Convex writes the actual URL later.
  const inherited = { ...process.env };
  let env = loadEnvConfig(process.cwd(), true).combinedEnv;
  const target = developmentTarget(env);

  if (process.argv.includes("--app")) {
    if (!env.CONVEX_SERVER_SECRET) throw new Error("Set CONVEX_SERVER_SECRET for your development deployment before starting.");
    if (target === "local") {
      if (!env.CONVEX_DEPLOYMENT || !env.NEXT_PUBLIC_CONVEX_URL || !isLoopbackUrl(env.NEXT_PUBLIC_CONVEX_URL)) {
        throw new Error("Local Convex is not configured. Start the full stack with pnpm dev.");
      }
      await runPnpm(["exec", "convex", "env", "set", "CONVEX_SERVER_SECRET"], env, env.CONVEX_SERVER_SECRET);
      const demos = env.ALLOW_DEMO_DATA === "true";
      await runPnpm(["exec", "convex", "env", "set", "ALLOW_DEMO_DATA", String(demos)], env);
      if (demos) await runPnpm(["exec", "tsx", "scripts/seed.ts"], env);
      console.log("Local Convex ready. Demo data does not establish healthy official-source coverage.");
    }
    await runPnpm(["exec", "next", "dev", ...process.argv.slice(2).filter((arg) => arg !== "--app")], env);
    return;
  }

  if (process.argv.length > 2) throw new Error("For Next.js CLI options, use pnpm dev:web. pnpm dev starts the full stack on the default port.");
  if (target === "local") {
    ensureLocalEnvironment(process.cwd(), env);
    env = loadEnvConfig(process.cwd(), true, console, true).combinedEnv;
    console.log("Starting account-free local Convex and Next.js. First use downloads the Convex backend.");
  } else if (!env.CONVEX_SERVER_SECRET) {
    throw new Error("Set CONVEX_SERVER_SECRET to match your cloud dev deployment, or use the account-free local setup.");
  }
  await runPnpm(["exec", "convex", "dev", "--start", "pnpm dev:app"], {
    ...inherited,
    // Convex only loads .env.local; carry Next's resolved application overrides through it.
    ...Object.fromEntries(appVariables.filter((name) => env[name] !== undefined).map((name) => [name, env[name]])),
    EOY_DEV_SHELL_CONVEX_ENV: JSON.stringify(Object.fromEntries(convexVariables
      .filter((name) => inherited[name])
      .map((name) => [name, inherited[name]]))),
    ...(env.CONVEX_DEPLOYMENT ? { CONVEX_DEPLOYMENT: env.CONVEX_DEPLOYMENT } : {}),
    ...(target === "local" ? { CONVEX_AGENT_MODE: "anonymous" } : {}),
  });
}

main().catch((error: unknown) => {
  if (error instanceof DevelopmentInterrupted) {
    process.exitCode = error.exitCode;
    return;
  }
  console.error(error instanceof Error ? error.message : "Development startup failed.");
  process.exitCode = 1;
});
