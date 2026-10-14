import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";
import path from "node:path";

export type DevelopmentEnv = Record<string, string | undefined>;
export function isLoopbackUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch { return false; }
}
export function developmentTarget(env: DevelopmentEnv): "local" | "cloud" {
  const stage = env.BACKEND_ENV?.trim() || "local";
  if (stage === "staging") {
    if (!env.BACKEND_URL || new URL(env.BACKEND_URL).protocol !== "https:") throw new Error("Staging requires an HTTPS BACKEND_URL");
    return "cloud";
  }
  if (stage !== "local") throw new Error("pnpm dev requires a local or staging development deployment");
  if (env.BACKEND_URL && !isLoopbackUrl(env.BACKEND_URL)) throw new Error("The local backend has a remote or invalid BACKEND_URL conflicting override");
  return "local";
}

/** Add missing values while preserving contributor configuration and credentials. */
export function ensureLocalEnvironment(directory: string, env: DevelopmentEnv): void {
  const filename = path.join(directory, ".env.local");
  if (!existsSync(filename)) writeFileSync(filename, readFileSync(path.join(directory, ".env.example")), { mode: 0o600, flag: "wx" });
  const resolved = { ...parseEnv(readFileSync(filename, "utf8")), ...env };
  const additions: string[] = [];
  for (const name of ["BACKEND_SECRET", "BACKEND_ADMIN_TOKEN", "FSIS_UPLOAD_TOKEN", "FDA_UPLOAD_TOKEN", "RATE_LIMIT_SALT", "CRON_SECRET"]) {
    if (!resolved[name]) {
      resolved[name] = randomBytes(32).toString("hex");
      additions.push(`${name}=${resolved[name]}`);
    }
  }
  for (const [name, value] of Object.entries({ BACKEND_URL: "http://127.0.0.1:8787", NEXT_PUBLIC_APP_URL: "http://localhost:3000" })) {
    if (!resolved[name]) { resolved[name] = value; additions.push(`${name}=${value}`); }
  }
  if (additions.length) appendFileSync(filename, `\n# Generated local development values.\n${additions.join("\n")}\n`);
  const workerFile = path.join(directory, ".dev.vars");
  const names = ["BACKEND_SECRET", "BACKEND_ADMIN_TOKEN", "FSIS_UPLOAD_TOKEN", "FDA_UPLOAD_TOKEN", "NOTION_CREDENTIAL_KEY", "NOTION_CLIENT_ID", "NOTION_CLIENT_SECRET", "NOTION_REVIEW_CONNECTION_KEY", "OPENFDA_API_KEY"];
  if (!existsSync(workerFile)) {
    writeFileSync(workerFile, names.filter((name) => resolved[name]).map((name) => `${name}=${JSON.stringify(resolved[name])}`).join("\n") + "\n", { mode: 0o600, flag: "wx" });
  } else {
    const workerEnv = parseEnv(readFileSync(workerFile, "utf8"));
    for (const name of names.slice(0, 4)) {
      if (!workerEnv[name] && resolved[name]) appendFileSync(workerFile, `${name}=${JSON.stringify(resolved[name])}\n`);
      else if (workerEnv[name] !== resolved[name]) throw new Error(`${name} differs between .dev.vars and the Next.js environment. Align the local credentials before starting.`);
    }
  }
}
