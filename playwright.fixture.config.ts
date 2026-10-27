import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e/fixtures",
  testMatch: "*.spec.ts",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:9160", trace: "retain-on-failure" },
  webServer: [
    { command: "pnpm exec tsx e2e/fixtures/backend-server.ts", url: "http://127.0.0.1:9161/health", timeout: 30_000 },
    { command: "pnpm exec next dev --hostname 127.0.0.1 --port 9160", url: "http://127.0.0.1:9160", timeout: 120_000,
      env: { BACKEND_URL: "http://127.0.0.1:9161", BACKEND_SECRET: "fixture-backend-secret", RATE_LIMIT_SALT: "fixture-browser-tests", NODE_OPTIONS: "--import=./e2e/fixtures/news-fetch.mjs" } },
  ],
  projects: [
    { name: "mobile-chrome", use: { ...devices["Pixel 7"] } },
    { name: "desktop-chrome", use: { ...devices["Desktop Chrome"] } },
  ],
});
