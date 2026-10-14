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
  writeFileSync(path.join(directory, ".env.example"), "BACKEND_SECRET=\nRATE_LIMIT_SALT=\nCRON_SECRET=\nALLOW_DEMO_DATA=true\n");
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
    const secrets = [env.BACKEND_SECRET, env.RATE_LIMIT_SALT, env.CRON_SECRET];
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
      BACKEND_SECRET: "existing-server", BACKEND_ADMIN_TOKEN: "existing-admin", FSIS_UPLOAD_TOKEN: "existing-upload", BACKEND_URL: "http://localhost:8787", RATE_LIMIT_SALT: "existing-salt", CRON_SECRET: "existing-cron",
      NEXT_PUBLIC_APP_URL: "http://localhost:4000",
    });
    expect(readFileSync(filename, "utf8")).toBe(contents);
  });

  it("defaults to local and allows explicit staging", () => {
    expect(developmentTarget({})).toBe("local");
    expect(developmentTarget({ BACKEND_ENV: "local" })).toBe("local");
    expect(developmentTarget({ BACKEND_ENV: "staging", BACKEND_URL: "https://staging.example.test" })).toBe("cloud");
  });

  it("rejects production or an insecure staging target before setup can mutate it", () => {
    expect(() => developmentTarget({ BACKEND_ENV: "production" })).toThrow(/development deployment/);
    expect(() => developmentTarget({ BACKEND_ENV: "staging", BACKEND_URL: "http://example.test" })).toThrow(/HTTPS/);
  });

  it("rejects remote or malformed URL overrides for a local backend", () => {
    for (const url of ["https://production.example.test", "http://localhost.evil.test:3210", "invalid"]) {
      expect(() => developmentTarget({ BACKEND_URL: url })).toThrow(/conflicting override/);
    }
    for (const url of ["http://localhost:3210", "http://127.0.0.1:3210", "http://[::1]:3210"]) {
      expect(developmentTarget({ BACKEND_URL: url })).toBe("local");
    }
  });
});
