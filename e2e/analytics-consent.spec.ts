import { expect, test } from "@playwright/test";
import { mountMcpApp, toolResult, checkResult } from "./fixtures/mcp-host";

// Run with a fixture PostHog token; interception ensures no browser test submits to production.
test("website consent can be declined, accepted and withdrawn without exposing inputs", async ({ page, context }) => {
  await context.addCookies([{ name: "eat-or-yeet-region", value: "UK", url: "http://localhost:3000" }]);
  const events: unknown[] = [];
  await page.route("**/api/analytics", async (route) => { events.push(route.request().postDataJSON()); await route.fulfill({ status: 204 }); });
  await page.goto("/search?private=not-for-analytics");
  const consent = page.getByRole("region", { name: "Help us improve Eat or Yeet?" });
  await expect(consent).toBeVisible();
  expect(events).toEqual([]);
  await consent.getByRole("button", { name: "No analytics", exact: true }).click();
  await page.goto("/privacy");
  expect(events).toEqual([]);
  await page.getByRole("button", { name: "Analytics preferences" }).click();
  await page.getByRole("button", { name: "Allow analytics", exact: true }).click();
  await expect.poll(() => events.length).toBe(1);
  expect(events[0]).toEqual({ data: { event: "website_page_viewed", page: "privacy" } });
  await page.getByRole("button", { name: "Analytics preferences" }).click();
  await page.getByRole("button", { name: "No analytics", exact: true }).click();
  await page.goto("/search?private=not-for-analytics");
  expect(events).toHaveLength(1);
  expect(JSON.stringify(events)).not.toContain("private");
  expect((await context.cookies()).find((cookie) => cookie.name === "eat-or-yeet-analytics")?.value).toBe("v1.declined");
});

test("browser privacy signals keep optional website analytics off", async ({ page, context }) => {
  await context.addCookies([{ name: "eat-or-yeet-region", value: "UK", url: "http://localhost:3000" }, { name: "eat-or-yeet-analytics", value: "v1.accepted", url: "http://localhost:3000" }]);
  await page.addInitScript(() => Object.defineProperty(navigator, "globalPrivacyControl", { value: true }));
  const events: unknown[] = [];
  await page.route("**/api/analytics", async (route) => { events.push(route.request().postDataJSON()); await route.fulfill({ status: 204 }); });
  await page.goto("/privacy");
  await page.getByRole("button", { name: "Analytics preferences" }).click();
  await expect(page.getByText("Analytics is off because your browser sends a privacy preference.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Allow analytics", exact: true })).toHaveCount(0);
  expect(events).toEqual([]);
});

test("app usage is opt-in, excludes product inputs and can be stopped during a check", async ({ page }) => {
  const host = await mountMcpApp(page);
  const app = page.frameLocator('iframe[title="MCP app test frame"]');
  await expect(app.getByRole("button", { name: "Allow analytics" })).toBeVisible();
  expect(await host.readCalls()).toEqual([]);
  await app.getByRole("button", { name: "No analytics", exact: true }).click();
  expect(await host.readCalls()).toEqual([]);
  await app.getByRole("button", { name: "Allow analytics" }).click();
  await expect.poll(async () => (await host.readCalls()).length).toBe(1);
  expect((await host.readCalls())[0].name).toBe("record_app_event");
  expect((await host.readCalls())[0].arguments).toEqual({ consent: true, host: "other", event: "app_opened" });
  await host.resolveCall(0, toolResult({ recorded: true }));
  await app.getByLabel("Product name").fill("Synthetic private product");
  await app.getByLabel("Warning region").selectOption("UK");
  await app.locator("form.check-form").getByRole("button", { name: "Check product" }).click();
  await expect.poll(async () => (await host.readCalls()).length).toBe(3);
  expect((await host.readCalls())[1].name).toBe("record_app_event");
  expect((await host.readCalls())[1].arguments).toEqual({ consent: true, host: "other", event: "app_tool_requested", tool: "check_product" });
  await app.getByRole("button", { name: "No analytics", exact: true }).click();
  await host.resolveCall(1, toolResult({ recorded: true }));
  await host.resolveCall(2, toolResult(checkResult("UK")));
  await app.locator("form.check-form").getByRole("button", { name: "Check product" }).click();
  await expect.poll(async () => (await host.readCalls()).length).toBe(4);
  expect((await host.readCalls())[3].name).toBe("check_product");
  expect((await host.readCalls()).filter((call) => call.name === "record_app_event")).toHaveLength(2);
});
