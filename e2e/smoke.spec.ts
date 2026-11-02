import { expect, test, type Page } from "@playwright/test";

const listHeading = (page: Page, region: "UK" | "US") => page.getByRole("heading", { name: new RegExp(`recalls in the ${region}$`) });
const location = (page: Page) => page.getByRole("combobox", { name: "Warning location", exact: true });
const chooseRegion = (page: Page, label: "United Kingdom" | "United States") => location(page).selectOption({ label });
const searchBox = (page: Page) => page.getByRole("searchbox", { name: /^Search (UK|US) recalls$/ });
const checkLink = (page: Page) => page.getByRole("link", { name: "Check a product", exact: true });
const foodTab = (page: Page, name: string) => page.getByRole("group", { name: "Filter by category" }).getByRole("link", { name: new RegExp(`^${name}`) });

// First-visit country questions are covered in region.spec.ts; these tests start with a saved choice.
test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: "eat-or-yeet-region", value: "UK", url: baseURL! }]);
});

test("home leads with recalls and one way to check a product", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "UK recalls", level: 1 })).toBeVisible();
  await expect(checkLink(page)).toBeVisible();
  await expect(checkLink(page)).toHaveAttribute("href", "/search");
  await expect(page.getByRole("search")).toHaveCount(0);
  await expect(listHeading(page, "UK")).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "UK recalls", level: 1 })).toBeVisible();
  await expect(page.locator("[data-nextjs-dialog]")).toHaveCount(0);
  expect(consoleErrors).toEqual([]);
});

test("news finishes loading and stays visible through filtering and country changes", async ({ page }) => {
  await page.goto("/?region=UK");
  const news = page.locator("#news");
  await expect(news.getByRole("heading", { name: "In the news", exact: true })).toBeVisible();
  await expect(news.getByRole("status")).toHaveCount(0);
  await page.getByRole("group", { name: "Filter by category" }).getByRole("link").nth(1).click();
  await expect(page).toHaveURL(/category=/);
  await expect(news.getByRole("heading", { name: "In the news", exact: true })).toBeVisible();
  await chooseRegion(page, "United States");
  await expect(listHeading(page, "US")).toBeVisible({ timeout: 15_000 });
  await expect(news.getByRole("heading", { name: "In the news", exact: true })).toBeVisible();
  await expect(news.getByRole("status")).toHaveCount(0);
});

test("location persists across reloads, warning browsing, and manual checks", async ({ page, context }) => {
  await page.goto("/");
  await chooseRegion(page, "United States");
  await expect(listHeading(page, "US")).toBeVisible({ timeout: 15_000 });
  const preference = (await context.cookies()).find((cookie) => cookie.name === "eat-or-yeet-region");
  expect(preference?.value).toBe("US");
  await page.goto("/incidents");
  await expect(listHeading(page, "US")).toBeVisible({ timeout: 15_000 });
  await page.reload();
  await expect(location(page)).toHaveValue("US");
  await page.goto("/search?mode=details");
  await expect(page.getByText("Checking against current")).toContainText("United States");
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

test("country selection responds while the new warnings are still loading", async ({ page }) => {
  await page.goto("/?region=UK");
  await expect(listHeading(page, "UK")).toBeVisible();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (request.headers().rsc === "1" && new URL(request.url()).searchParams.get("region") === "US") await pending;
    await route.continue();
  });
  try {
    await chooseRegion(page, "United States");
    await expect(location(page)).toHaveValue("US");
    await expect(location(page)).toHaveAttribute("aria-busy", "true");
    await expect(page.getByRole("status").filter({ hasText: "Loading United States warnings" })).toBeAttached();
  } finally {
    release();
  }
  await expect(listHeading(page, "US")).toBeVisible({ timeout: 15_000 });
  await expect(location(page)).toHaveAttribute("aria-busy", "false");
});

test("changing country on manual entry does not reload server data", async ({ page }) => {
  await page.goto("/search?mode=details");
  const serverRequests: string[] = [];
  page.on("request", (request) => { if (request.headers().rsc === "1") serverRequests.push(request.url()); });
  await chooseRegion(page, "United States");
  await expect(page.getByText("Checking against current")).toContainText("United States");
  await chooseRegion(page, "United Kingdom");
  await expect(page.getByText("Checking against current")).toContainText("United Kingdom");
  expect(serverRequests).toEqual([]);
});

test("warning search filters instantly, keeps a shareable URL and preserves the location", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto("/incidents?region=US");
  const serverRequests: string[] = [];
  page.on("request", (request) => { if (request.resourceType() === "document" || request.headers().rsc === "1") serverRequests.push(request.url()); });
  await page.waitForLoadState("networkidle");
  await page.keyboard.press("/");
  await expect(searchBox(page)).toBeFocused();
  await page.keyboard.type("chocolate");
  await expect(page.getByRole("heading", { name: /recalls? found$/ })).toBeVisible();
  await expect(page).toHaveURL(/region=US.*q=chocolate/);
  await foodTab(page, "Snacks & sweets").click();
  await expect(page).toHaveURL(/category=Snacks/);
  await expect(location(page)).toHaveValue("US");
  expect(serverRequests).toEqual([]);
  await page.reload();
  await expect(searchBox(page)).toHaveValue("chocolate");
  await expect(foodTab(page, "Snacks & sweets")).toHaveAttribute("aria-current", "true");
  await page.getByRole("button", { name: "Clear all" }).click();
  await expect(listHeading(page, "US")).toBeVisible({ timeout: 15_000 });
  await checkLink(page).click();
  await expect(page.getByText("Checking against current")).toContainText("United States");
  expect(errors).toEqual([]);
});

test("manual entry exposes barcode and label detail fields", async ({ page }) => {
  await page.goto("/search");
  await expect(page.getByRole("heading", { name: "Type it in" })).toBeVisible();
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
  await expect(page.getByText("3 digits so far. Most packs have 13.")).toBeVisible();
  await barcode.fill("4006381333930");
  await expect(check).toBeDisabled();
  await expect(page.getByText(/doesn’t add up/)).toBeVisible();
  await barcode.fill("4006381333931");
  await expect(check).toBeEnabled();
  await expect(page.getByText("Valid 13-digit barcode.")).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "EAT", exact: true })).toHaveCount(0);
  await expect(page.getByText("This checks published warnings, not whether food is safe to eat.").first()).toBeVisible();
  await expect(page.getByText("Food Standards Agency")).toBeVisible();
  await expect(page.getByText("UK", { exact: true }).last()).toBeVisible();
  await page.getByRole("button", { name: "Share result" }).click();
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
  await expect(page.getByLabel("Or type the number")).toBeVisible();
  await expect(page.getByRole("button", { name: "No barcode? Use label details" })).toBeVisible();
  await expect(page.getByText("Starting the camera…")).toBeVisible();
  await expect(page.getByText(/Camera access is blocked/)).toBeVisible();
});


test("warning browsing works with reduced motion and without view transition support", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    Object.defineProperty(document, "startViewTransition", { configurable: true, value: undefined });
  });
  await page.goto("/incidents?region=UK");
  await chooseRegion(page, "United States");
  await expect(listHeading(page, "US")).toBeVisible({ timeout: 15_000 });
  const category = page.getByRole("group", { name: "Filter by category" }).getByRole("link").nth(1);
  await category.click();
  await expect(category).toHaveAttribute("aria-current", "true");
  await searchBox(page).fill("no such food warning");
  await expect(page.getByText("No recall reports match.")).toBeVisible();
  await page.getByRole("button", { name: "Remove “no such food warning”" }).click();
  await expect(page.getByRole("heading", { name: /recalls? found$/ })).toBeVisible();
  await expect(category).toHaveAttribute("aria-current", "true");
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe("auto");
  expect(errors).toEqual([]);
});

test("small screens keep the navigation and warnings inside the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/?region=UK");
  await expect(listHeading(page, "UK")).toBeVisible();
  await expect(location(page)).toBeVisible();
  await expect(checkLink(page)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
