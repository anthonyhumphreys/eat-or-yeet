import { expect, test } from "@playwright/test";

test("home leads with warnings and exposes barcode and manual paths", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Food warnings. Before your next bite." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Check my food", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Check a barcode or label details", exact: true })).toBeVisible();
  await expect(page.getByRole("search")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Current UK warnings", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByRole("link", { name: /Take a photo/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Admin" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Skip to main content" })).toBeAttached();
  await expect(page.locator("[data-nextjs-dialog]")).toHaveCount(0);
  expect(consoleErrors).toEqual([]);
});

test("system dark mode hydrates without a framework error", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Food warnings. Before your next bite." })).toBeVisible();
  await expect(page.locator("[data-nextjs-dialog]")).toHaveCount(0);
  expect(consoleErrors).toEqual([]);
});

test("location persists across reloads, warning browsing, and manual checks", async ({ page, context }) => {
  await page.goto("/");
  await page.getByRole("combobox", { name: "Warning location", exact: true }).selectOption("US");
  await expect(page.getByRole("heading", { name: "Current US warnings", exact: true })).toBeVisible();
  const preference = (await context.cookies()).find((cookie) => cookie.name === "eat-or-yeet-region");
  expect(preference?.value).toBe("US");
  await page.goto("/incidents");
  await expect(page.getByRole("heading", { name: "Current US warnings", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Warning location", exact: true })).toHaveValue("US");
  await page.goto("/search?mode=details");
  await expect(page.getByText("Checking warnings from the")).toContainText("United States");
  let checkedRegion: string | undefined;
  await page.route("**/api/check", async (route) => {
    checkedRegion = route.request().postDataJSON().region;
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Test response" }) });
  });
  await page.getByLabel("Product name").fill("Example food");
  await page.getByRole("button", { name: "Check published warnings" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Test response" })).toBeVisible();
  expect(checkedRegion).toBe("US");
});

test("warning search and grouped categories preserve the selected location", async ({ page }) => {
  await page.goto("/?region=US");
  await page.getByLabel("Search warnings", { exact: true }).fill("chocolate");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(/region=US.*q=chocolate/);
  await expect(page.getByLabel("Search warnings", { exact: true })).toHaveValue("chocolate");
  await page.getByLabel("Food category", { exact: true }).selectOption("Snacks & sweets");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByRole("heading", { name: "Snacks & sweets", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Warning location", exact: true })).toHaveValue("US");
  await page.getByRole("link", { name: "Clear filters" }).click();
  await expect(page.getByRole("heading", { name: "Current US warnings", exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Check my food", exact: true }).click();
  await expect(page.getByText("Checking warnings from the")).toContainText("United States");
  await expect(page.getByRole("combobox", { name: "Warning location", exact: true })).toHaveValue("US");
});

test("manual entry exposes barcode and label detail fields", async ({ page }) => {
  await page.goto("/search");
  await expect(page.getByRole("heading", { name: "Enter food details" })).toBeVisible();
  await expect(page.getByLabel("Barcode number")).toBeVisible();
  await page.getByRole("button", { name: "Label details" }).click();
  await expect(page.getByLabel("Batch code")).toBeVisible();
  await page.getByText("More identifiers").click();
  await expect(page.getByLabel("Producer", { exact: true })).toBeVisible();
  await expect(page.locator("[data-nextjs-dialog]")).toHaveCount(0);
});

test("manual barcode validation accepts only supported GTIN lengths with a check digit", async ({ page }) => {
  await page.goto("/search");
  const barcode = page.getByLabel("Barcode number");
  const check = page.getByRole("button", { name: "Check published warnings" });
  await barcode.fill("123");
  await expect(check).toBeDisabled();
  await expect(page.getByText(/valid 8, 12, 13, or 14 digit barcode/)).toBeVisible();
  await barcode.fill("4006381333931");
  await expect(check).toBeEnabled();
});

test("manual label details produce a qualified published-warning result", async ({ page }) => {
  const checkedAt = "2026-10-07T10:00:00.000Z";
  await page.addInitScript(() => {
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText: async () => { throw new DOMException("Clipboard denied", "NotAllowedError"); } },
    });
  });
  await page.route("**/api/check", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      verdict: "EAT",
      matchLevel: "none",
      observation: {
        productName: "Sample product",
        brand: null,
        barcode: null,
        batchCode: null,
        lotCode: null,
        producer: null,
        farmCode: null,
        countryOfOrigin: null,
        establishmentNumber: null,
        approvalNumber: null,
        retailer: null,
        category: null,
        eggMark: null,
        dates: null,
      },
      matches: [],
      checkedAt,
      datasetRegions: ["UK"],
      shareToken: "mock-share-token",
      datasetStatus: {
        healthy: true,
        checkedAt,
        regions: ["UK"],
        sources: [{ id: "fsa", name: "Food Standards Agency", region: "UK", lastSuccessfulAt: checkedAt, status: "healthy", scope: "Food alerts" }],
      },
    }),
  }));
  await page.route("**/api/share", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ url: "http://localhost:3000/s/shared-check" }) }));

  await page.goto("/search?mode=details");
  await page.getByLabel("Product name").fill("Sample product");
  await page.getByRole("button", { name: "Check published warnings" }).click();
  await expect(page.getByRole("heading", { name: "No matching warning found" })).toBeFocused();
  await expect(page.getByRole("heading", { name: "EAT" })).toHaveCount(0);
  await expect(page.getByText("This checks published warnings, not whether food is safe to eat.").first()).toBeVisible();
  await expect(page.getByText("Food Standards Agency")).toBeVisible();
  await expect(page.getByText("UK", { exact: true }).last()).toBeVisible();
  await page.getByRole("button", { name: "Create public link" }).click();
  await expect(page.getByLabel("Share link")).toHaveValue("http://localhost:3000/s/shared-check");
  await expect(page.getByRole("link", { name: "Open link" })).toHaveAttribute("href", "http://localhost:3000/s/shared-check");
});

test("camera denial keeps manual barcode entry available", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window.navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: () => new Promise((_, reject) => {
          window.setTimeout(() => reject(new DOMException("Permission denied", "NotAllowedError")), 700);
        }),
      },
    });
  });
  await page.goto("/scan");
  await expect(page.getByRole("link", { name: "Type the barcode instead" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Enter details manually" })).toBeVisible();
  await expect(page.getByText("Starting the camera…")).toBeVisible();
  await expect(page.getByText(/Camera access is blocked/)).toBeVisible();
});
