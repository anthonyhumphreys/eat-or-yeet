import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  testIgnore: "**/fixtures/**",
  use: {
    baseURL,
    trace: "on-first-retry",
    // Consent behavior has its own tests; ordinary flows should have a stable, tracking-free viewport.
    storageState: { cookies: [{ name: "eat-or-yeet-analytics", value: "v1.declined", domain: new URL(baseURL).hostname, path: "/", expires: -1, httpOnly: false, secure: baseURL.startsWith("https:"), sameSite: "Lax" }], origins: [] },
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL ? undefined : {
    command: "pnpm dev:web", url: baseURL, reuseExistingServer: !process.env.CI, timeout: 120_000,
    env: { POSTHOG_ENABLED: "true", POSTHOG_HOST: "https://eu.i.posthog.com", POSTHOG_PROJECT_TOKEN: "fixture", VERCEL_ENV: "production" },
  },
  projects: [{ name: "mobile-chrome", use: { ...devices["Pixel 7"] } }, { name: "desktop-chrome", use: { ...devices["Desktop Chrome"] } }],
});
