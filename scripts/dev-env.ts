import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export type DevelopmentEnv = Record<string, string | undefined>;

export function developmentTarget(env: DevelopmentEnv): "local" | "cloud" {
  if (env.CONVEX_DEPLOY_KEY || env.CONVEX_SELF_HOSTED_URL || env.CONVEX_SELF_HOSTED_ADMIN_KEY) {
    throw new Error("pnpm dev does not use deploy keys or self-hosted credentials. Use pnpm dev:web with your separately managed backend.");
  }
  const selector = env.CONVEX_DEPLOYMENT?.trim() ?? "";
  const local = !selector || selector === "local" || selector.endsWith(":local") || /^(anonymous|local):/.test(selector);
  if (!local && selector !== "dev" && !/^dev:/.test(selector) && !/(^|:)dev\//.test(selector)) {
    throw new Error("pnpm dev requires a local or personal dev deployment. Select a development deployment before starting.");
  }
  if (local && env.NEXT_PUBLIC_CONVEX_URL && !isLoopbackUrl(env.NEXT_PUBLIC_CONVEX_URL)) {
    throw new Error("The local deployment has a remote NEXT_PUBLIC_CONVEX_URL. Remove the conflicting override before starting.");
  }
  return local ? "local" : "cloud";
}

export function isLoopbackUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

/** Add only missing local values; existing files and secrets belong to the contributor. */
export function ensureLocalEnvironment(directory: string, env: DevelopmentEnv): void {
  const filename = path.join(directory, ".env.local");
  if (!existsSync(filename)) {
    writeFileSync(filename, readFileSync(path.join(directory, ".env.example")), { mode: 0o600, flag: "wx" });
  }
  const additions: string[] = [];
  for (const name of ["CONVEX_SERVER_SECRET", "RATE_LIMIT_SALT", "CRON_SECRET"]) {
    if (!env[name]) additions.push(`${name}=${randomBytes(32).toString("hex")}`);
  }
  if (!env.NEXT_PUBLIC_APP_URL) additions.push("NEXT_PUBLIC_APP_URL=http://localhost:3000");
  if (additions.length) appendFileSync(filename, `\n# Generated local development values.\n${additions.join("\n")}\n`);
}
