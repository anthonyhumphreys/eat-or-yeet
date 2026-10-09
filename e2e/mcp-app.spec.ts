import { expect, test } from "@playwright/test";
import { checkResult, mountMcpApp, toolResult } from "./fixtures/mcp-host";

const frame = (page: import("@playwright/test").Page) => page.frameLocator('iframe[title="MCP app test frame"]');

async function submitHostCheck(page: import("@playwright/test").Page, region: "UK" | "US", overrides: Record<string, unknown> = {}) {
  const host = await mountMcpApp(page);
  await host.sendInput({ region, observation: { productName: "Sample milk", brand: "Sample Dairy", producer: "Submitted producer", countryOfOrigin: region === "US" ? "United States" : "United Kingdom", dates: { productionDate: "2026-10-01" } } });
  await expect(frame(page).getByRole("status")).toContainText("Checking the official warning records");
  await host.sendResult(toolResult(checkResult(region, overrides)));
  return host;
}

test("the embedded checker waits for explicit input and sends only a deliberate product check", async ({ page }) => {
  const browserErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  const host = await mountMcpApp(page);
  const app = frame(page);

  await expect(app.getByLabel("Warning region")).toHaveValue("");
  await expect(app.getByText("No product check has completed in this view.")).toBeVisible();
  await app.getByLabel("Product name").fill("Sample milk");
  await app.getByLabel("Brand").fill("Sample Dairy");
  await app.getByLabel("Warning region").selectOption("UK");
  await expect.poll(() => host.readCalls()).toEqual([]);
  await expect.poll(() => host.readModelContexts()).toEqual([]);

  await app.locator("form.check-form").getByRole("button", { name: "Check product" }).click();
  await expect.poll(async () => (await host.readCalls()).length).toBe(1);
  const [call] = await host.readCalls();
  expect(call).toMatchObject({ name: "check_product", arguments: { region: "UK", observation: { productName: "Sample milk", brand: "Sample Dairy" } } });
  await host.resolveCall(0, toolResult(checkResult("UK")));

  await expect(app.getByRole("heading", { name: "UK warning match" })).toBeVisible();
  await expect.poll(async () => (await host.readModelContexts()).length).toBe(1);
  expect((await host.readModelContexts())[0]?.content?.[0]?.text).toContain("Sample milk check: UK warning match");
  expect(browserErrors.filter((error) => error.includes("Content Security Policy"))).toEqual([]);
});

test("submitted facts remain separate from enrichment and a failed UK recheck keeps the committed US result", async ({ page }) => {
  const host = await submitHostCheck(page, "US");
  const app = frame(page);
  await expect(app.getByRole("heading", { name: "US warning match" })).toBeVisible();
  await expect(app.locator(".region-chip")).toHaveText("US");

  await app.getByLabel("Warning region").selectOption("UK");
  await expect(app.getByLabel("Warning region")).toHaveValue("UK");
  await app.locator("form.check-form").getByRole("button", { name: "Check product" }).click();
  await expect.poll(async () => (await host.readCalls()).length).toBe(1);
  expect((await host.readCalls())[0]?.arguments).toMatchObject({
    region: "UK",
    observation: {
      productName: "Sample milk",
      producer: "Submitted producer",
      countryOfOrigin: "United States",
      dates: { productionDate: "2026-10-01" },
    },
  });
  await expect(app.getByText("No product check has completed in this view.")).toHaveCount(0);
  await host.resolveCall(0, toolResult(checkResult("UK", { coverage: { ...checkResult("UK").coverage, region: "UK" } }), true));

  await expect(app.getByRole("heading", { name: "US warning match" })).toBeVisible();
  await expect(app.locator(".region-chip")).toHaveText("US");
  await expect(app.getByRole("status")).toContainText("The test tool failed");
  await expect(app.locator(".retained-facts .evidence-row").filter({ has: app.getByText("Producer", { exact: true }) })).toContainText("Submitted producer");
  await expect(app.locator(".retained-facts .evidence-row").filter({ has: app.getByText("Country of origin", { exact: true }) })).toContainText("United States");
  await expect(app.locator(".retained-facts .evidence-row").filter({ has: app.getByText("Production date", { exact: true }) })).toContainText("2026-10-01");
  const evidence = app.locator(".latest-result .evidence-details");
  await evidence.locator("summary").click();
  await expect(evidence).toContainText("Submitted producer");
  await expect(evidence).toContainText("checked as Enriched producer (catalogue enrichment)");
  await expect(evidence).not.toContainText("Enriched producer · supplied");

  await app.locator("form.check-form").getByRole("button", { name: "Check product" }).click();
  await expect.poll(async () => (await host.readCalls()).length).toBe(2);
  await expect(app.getByRole("button", { name: "Cancel" })).toBeVisible();
  await expect(app.locator(".region-chip")).toHaveText("US");
  await host.sendCancelled("The UK recheck was cancelled by the host.");
  await expect(app.getByRole("status")).toContainText("Request interrupted");
  await expect(app.getByRole("heading", { name: "US warning match" })).toBeVisible();
  await expect(app.locator(".region-chip")).toHaveText("US");
  await host.resolveCall(1, toolResult(checkResult("UK")));
  await expect(app.getByRole("heading", { name: "US warning match" })).toBeVisible();
});

test("an invalid tool result is rejected without replacing the previous committed result", async ({ page }) => {
  const host = await submitHostCheck(page, "US");
  const app = frame(page);
  await expect(app.getByRole("heading", { name: "US warning match" })).toBeVisible();

  await host.sendInput({ region: "UK", observation: { productName: "Sample milk" } });
  await expect(app.getByRole("status")).toContainText("Checking the official warning records");
  const malformed = checkResult("UK", { warnings: [{ ...checkResult("UK").warnings[0], unexpectedInternalId: "must be rejected" }] });
  await host.sendResult(toolResult(malformed));

  await expect(app.getByRole("status")).toContainText("No completed result was returned");
  await expect(app.getByRole("heading", { name: "US warning match" })).toBeVisible();
  await expect(app.locator(".region-chip")).toHaveText("US");
});

test("official packet groups stay together, host theme changes apply, and long codes fit on mobile", async ({ page }) => {
  const host = await mountMcpApp(page, "dark");
  const app = frame(page);
  await expect(app.locator(":root")).toHaveAttribute("data-theme", "dark");
  await host.setTheme("light");
  await expect(app.locator(":root")).toHaveAttribute("data-theme", "light");
  await host.setTheme("dark");
  await expect(app.locator(":root")).toHaveAttribute("data-theme", "dark");

  const longCode = "BATCH-" + "0123456789".repeat(16);
  const result = checkResult("UK", {
    warnings: [{
      ...checkResult("UK").warnings[0],
      affectedGroups: [{
        key: "one-packet-group",
        association: "source_group",
        targets: [
          { type: "product", value: "Sample milk", matchType: "exact", dateFrom: null, dateTo: null, notes: null },
          { type: "batch", value: longCode, matchType: "exact", dateFrom: null, dateTo: null, notes: "Printed next to the date" },
        ],
      }],
    }],
  });
  await host.sendInput({ region: "UK", observation: { productName: "Sample milk" } });
  await expect(app.getByRole("status")).toContainText("Checking the official warning records");
  await host.sendResult(toolResult(result));

  const warning = app.locator(".warning-row");
  await expect(warning.getByText("Grouped by the warning source")).toBeVisible();
  const group = warning.locator(".affected-group");
  await expect(group.getByText("product: Sample milk")).toBeVisible();
  const code = group.locator(".target-code").filter({ hasText: longCode });
  await expect(code).toBeVisible();
  await expect(group.getByText("Printed next to the date")).toBeVisible();
  const dimensions = await app.locator("html").evaluate((element) => ({
    width: element.clientWidth,
    scrollWidth: element.scrollWidth,
    codeRight: element.querySelector(".target-code")?.getBoundingClientRect().right ?? 0,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width);
  expect(dimensions.codeRight).toBeLessThanOrEqual(dimensions.width);
});
