import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000", trace: "on-first-retry" },
  webServer: process.env.PLAYWRIGHT_BASE_URL ? undefined : { command: "pnpm dev", url: "http://localhost:3000", reuseExistingServer: true, timeout: 120_000 },
  projects: [{ name: "mobile-chrome", use: { ...devices["Pixel 7"] } }, { name: "desktop-chrome", use: { ...devices["Desktop Chrome"] } }],
});
