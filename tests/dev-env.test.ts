import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { developmentTarget, ensureLocalEnvironment } from "../scripts/dev-env";

const directories: string[] = [];
function workspace(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "eat-or-yeet-dev-test-"));
  directories.push(directory);
  writeFileSync(path.join(directory, ".env.example"), "CONVEX_SERVER_SECRET=\nRATE_LIMIT_SALT=\nCRON_SECRET=\nALLOW_DEMO_DATA=true\n");
  return directory;
}

afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe("contributor development setup", () => {
  it("creates separate persistent secrets and keeps them stable across restarts", () => {
    const directory = workspace();
    const filename = path.join(directory, ".env.local");
    ensureLocalEnvironment(directory, {});
    const contents = readFileSync(filename, "utf8");
    const env = parseEnv(contents);
    const secrets = [env.CONVEX_SERVER_SECRET, env.RATE_LIMIT_SALT, env.CRON_SECRET];
    for (const secret of secrets) expect(secret).toMatch(/^[a-f0-9]{64}$/);
    expect(new Set(secrets).size).toBe(3);
    expect(env.ALLOW_DEMO_DATA).toBe("true");
    expect(env.NEXT_PUBLIC_APP_URL).toBe("http://localhost:3000");
    ensureLocalEnvironment(directory, env);
    expect(readFileSync(filename, "utf8")).toBe(contents);
  });

  it("preserves existing files, disabled demos and secrets supplied by higher-priority overrides", () => {
    const directory = workspace();
    const filename = path.join(directory, ".env.local");
    const contents = "# Keep my configuration\nALLOW_DEMO_DATA=false\nUNRELATED=value\n";
    writeFileSync(filename, contents);
    ensureLocalEnvironment(directory, {
      CONVEX_SERVER_SECRET: "existing-server", RATE_LIMIT_SALT: "existing-salt", CRON_SECRET: "existing-cron",
      NEXT_PUBLIC_APP_URL: "http://localhost:4000",
    });
    expect(readFileSync(filename, "utf8")).toBe(contents);
  });

  it("defaults to local and recognises local selectors", () => {
    for (const selector of [undefined, "", "anonymous:anonymous-agent", "local:sample", "local", "team:project:local"]) {
      expect(developmentTarget({ CONVEX_DEPLOYMENT: selector })).toBe("local");
    }
  });

  it("preserves personal cloud development selectors", () => {
    for (const selector of ["dev", "dev:sample", "team:project:dev/contributor"]) {
      expect(developmentTarget({ CONVEX_DEPLOYMENT: selector, NEXT_PUBLIC_CONVEX_URL: "https://sample.convex.cloud" })).toBe("cloud");
    }
  });

  it("rejects production, preview and deploy-key configurations before setup can mutate them", () => {
    for (const selector of ["prod", "prod:sample", "team:project:prod", "preview:sample", "staging"]) {
      expect(() => developmentTarget({ CONVEX_DEPLOYMENT: selector })).toThrow(/development deployment/);
    }
    expect(() => developmentTarget({ CONVEX_DEPLOY_KEY: "test-key" })).toThrow(/deploy keys/);
    expect(() => developmentTarget({ CONVEX_SELF_HOSTED_URL: "http://localhost:3210" })).toThrow(/self-hosted/);
  });

  it("rejects remote or malformed URL overrides for a local backend", () => {
    for (const url of ["https://production.convex.cloud", "http://localhost.evil.test:3210", "invalid"]) {
      expect(() => developmentTarget({ NEXT_PUBLIC_CONVEX_URL: url })).toThrow(/conflicting override/);
    }
    for (const url of ["http://localhost:3210", "http://127.0.0.1:3210", "http://[::1]:3210"]) {
      expect(developmentTarget({ NEXT_PUBLIC_CONVEX_URL: url })).toBe("local");
    }
  });
});
