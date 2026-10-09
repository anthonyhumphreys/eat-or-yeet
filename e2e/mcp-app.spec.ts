import { expect, test } from "@playwright/test";
import { checkResult, mountMcpApp, searchResult, toolError, toolResult, warningDetails } from "./fixtures/mcp-host";

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

test("warning search and paged detail return to the committed search without another tool call", async ({ page }) => {
  const host = await mountMcpApp(page);
  const app = frame(page);
  await app.getByRole("navigation", { name: "Checker views" }).getByRole("button", { name: "Search warnings" }).click();
  await app.getByLabel("Search region").selectOption("UK");
  await app.getByLabel("Product, brand, or warning title").fill("Sample milk");
  await expect.poll(async () => (await host.readCalls()).length).toBe(0);
  await app.locator("form.search-form").getByRole("button", { name: "Search warnings" }).click();
  await expect.poll(async () => (await host.readCalls()).length).toBe(1);
  expect((await host.readCalls())[0]).toMatchObject({
    name: "search_warnings",
    arguments: { region: "UK", query: "Sample milk", pageSize: 10 },
  });
  await host.resolveCall(0, toolResult(searchResult("UK")));

  await expect(app.getByRole("heading", { name: "2 warnings found" })).toBeVisible();
  await expect(app.getByText('Committed search · UK · “Sample milk”')).toBeVisible();
  await expect(app.getByRole("button", { name: "Load more warnings" })).toBeVisible();

  // Change only the search draft. Opening a result must still return to its committed UK query.
  await app.getByLabel("Search region").selectOption("US");
  await expect.poll(async () => (await host.readCalls()).length).toBe(1);
  await app.getByRole("button", { name: "Warning details" }).click();
  await expect.poll(async () => (await host.readCalls()).length).toBe(2);
  expect((await host.readCalls())[1]).toMatchObject({
    name: "get_warning",
    arguments: { slug: "uk-sample-recall", pageSize: 10 },
  });
  await host.resolveCall(1, toolResult(warningDetails("UK")));

  await expect(app.getByRole("heading", { name: "UK sample milk recall" })).toBeVisible();
  await expect(app.getByText("Showing 1 group on this page · 3 total affected groups.")).toBeVisible();
  await expect(app.locator(".affected-group")).toHaveCount(1);
  await expect(app.locator(".group-list")).toContainText("product: Sample milk");
  await expect(app.getByRole("button", { name: "Load more affected groups" })).toBeVisible();
  await app.getByRole("button", { name: "Back to UK search" }).click();

  await expect(app.getByRole("heading", { name: "Search published warnings" })).toBeVisible();
  await expect(app.getByLabel("Product, brand, or warning title")).toHaveValue("Sample milk");
  await expect(app.getByLabel("Search region")).toHaveValue("UK");
  await expect(app.getByRole("heading", { name: "2 warnings found" })).toBeVisible();
  await expect(app.getByText('Committed search · UK · “Sample milk”')).toBeVisible();
  await expect(app.getByRole("button", { name: "Load more warnings" })).toBeVisible();
  await expect.poll(async () => (await host.readCalls()).length).toBe(2);
});

test("a failed detail request restores focus to the selected second warning row", async ({ page }) => {
  const host = await mountMcpApp(page);
  const app = frame(page);
  await app.getByRole("navigation", { name: "Checker views" }).getByRole("button", { name: "Search warnings" }).click();
  await app.getByLabel("Search region").selectOption("UK");
  await app.getByLabel("Product, brand, or warning title").fill("Sample milk");
  await app.locator("form.search-form").getByRole("button", { name: "Search warnings" }).click();
  await expect.poll(async () => (await host.readCalls()).length).toBe(1);
  await host.resolveCall(0, toolResult(searchResult("UK", true)));

  const secondWarning = app.locator(".warning-row").filter({ hasText: "Second Sample milk recall" });
  const secondDetailButton = secondWarning.getByRole("button", { name: "Warning details" });
  await expect(secondDetailButton).toBeVisible();
  await secondDetailButton.click();
  await expect.poll(async () => (await host.readCalls()).length).toBe(2);
  expect((await host.readCalls())[1]).toMatchObject({
    name: "get_warning",
    arguments: { slug: "uk-second-recall", pageSize: 10 },
  });
  await host.resolveCall(1, toolError("The second warning details are temporarily unavailable."));

  await expect(app.getByRole("status")).toContainText("second warning details are temporarily unavailable");
  await expect(app.getByRole("heading", { name: "2 warnings found" })).toBeVisible();
  await expect(app.locator(".warning-row")).toHaveCount(2);
  await expect(secondDetailButton).toBeFocused();
  await expect.poll(async () => (await host.readCalls()).length).toBe(2);
});

test("manual cancellation keeps the completed search and coverage results visible", async ({ page }) => {
  const host = await mountMcpApp(page);
  const app = frame(page);
  const navigation = app.getByRole("navigation", { name: "Checker views" });

  await navigation.getByRole("button", { name: "Search warnings" }).click();
  await app.getByLabel("Search region").selectOption("UK");
  await app.getByLabel("Product, brand, or warning title").fill("Sample milk");
  await app.locator("form.search-form").getByRole("button", { name: "Search warnings" }).click();
  await expect.poll(async () => (await host.readCalls()).length).toBe(1);
  await host.resolveCall(0, toolResult(searchResult("UK")));
  await expect(app.getByRole("heading", { name: "2 warnings found" })).toBeVisible();
  await expect(app.getByText('Committed search · UK · “Sample milk”')).toBeVisible();

  await app.getByLabel("Product, brand, or warning title").fill("Other milk");
  await app.locator("form.search-form").getByRole("button", { name: "Search warnings" }).click();
  await expect.poll(async () => (await host.readCalls()).length).toBe(2);
  await expect(app.getByRole("button", { name: "Cancel" })).toBeVisible();
  await expect(app.getByRole("heading", { name: "2 warnings found" })).toBeVisible();
  await app.getByRole("button", { name: "Cancel" }).click();
  await expect(app.getByRole("status")).toContainText("Request interrupted");
  await expect(app.getByRole("heading", { name: "2 warnings found" })).toBeVisible();
  await expect(app.getByText('Committed search · UK · “Sample milk”')).toBeVisible();
  await host.resolveCall(1, toolResult(searchResult("US")));
  await expect(app.getByText('Committed search · UK · “Sample milk”')).toBeVisible();

  await navigation.getByRole("button", { name: "Coverage" }).click();
  await app.getByLabel("Coverage region").selectOption("US");
  await app.getByRole("button", { name: "Check source coverage" }).click();
  await expect.poll(async () => (await host.readCalls()).length).toBe(3);
  await host.resolveCall(2, toolResult(searchResult("US").coverage));
  await expect(app.getByRole("heading", { name: "Coverage is current" })).toBeVisible();
  await expect(app.getByText(/For US · checked/)).toBeVisible();

  await app.getByLabel("Coverage region").selectOption("UK");
  await app.getByRole("button", { name: "Check source coverage" }).click();
  await expect.poll(async () => (await host.readCalls()).length).toBe(4);
  await expect(app.getByRole("button", { name: "Cancel" })).toBeVisible();
  await expect(app.getByRole("heading", { name: "Coverage is current" })).toBeVisible();
  await expect(app.getByText(/For US · checked/)).toBeVisible();
  await app.getByRole("button", { name: "Cancel" }).click();
  await expect(app.getByRole("status")).toContainText("Request interrupted");
  await expect(app.getByRole("heading", { name: "Coverage is current" })).toBeVisible();
  await expect(app.getByText(/For US · checked/)).toBeVisible();
  await expect.poll(async () => (await host.readCalls()).length).toBe(4);
  await host.resolveCall(3, toolResult(searchResult("UK").coverage));
  await expect(app.getByText(/For US · checked/)).toBeVisible();
});
