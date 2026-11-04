import { expect, test } from "@playwright/test";

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: "eat-or-yeet-region", value: "UK", url: baseURL! }]);
});

test("a restored list and show more keep their page in the shareable URL", async ({ page }) => {
  await page.goto("/incidents?region=UK&page=2");
  const rows = page.locator("#warnings ul > li");
  await expect(rows).toHaveCount(80);
  // The debounced URL effect must have settled before checking the restored page.
  await expect(page.locator("#warnings [aria-live]")).toHaveText(/recalls/);
  await expect(page).toHaveURL(/page=2/);
  await page.getByRole("link", { name: "Show 40 more", exact: true }).click();
  await expect(rows).toHaveCount(120);
  await expect(page).toHaveURL(/page=3/);
  await page.reload();
  await expect(rows).toHaveCount(120);
  await page.getByRole("searchbox").fill("milk");
  await expect(page).toHaveURL(/q=milk/);
  expect(new URL(page.url()).searchParams.has("page")).toBe(false);
});

test("a slow check explains the wait and changing country cancels its stale result", async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const started = page.waitForRequest("**/api/check");
  await page.route("**/api/check", async (route) => {
    await pending;
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Old UK check failed" }) });
  });
  await page.goto("/search?mode=details");
  await page.getByLabel("Product name").fill("My pack");
  try {
    await page.getByRole("button", { name: "Check published warnings", exact: true }).click();
    await started;
    await expect(page.getByRole("status").filter({ hasText: "Comparing your pack details" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Checking published warnings…", exact: true })).toBeDisabled();
    await page.getByRole("combobox", { name: "Warning location", exact: true }).selectOption("US");
    await expect(page.getByRole("button", { name: "Check published warnings", exact: true })).toBeEnabled();
    await expect(page.getByLabel("Product name")).toHaveValue("My pack");
  } finally {
    release();
  }
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  await page.getByRole("combobox", { name: "Warning location", exact: true }).selectOption("UK");
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Check published warnings", exact: true })).toBeEnabled();
});

test("an upstream HTML error gives a useful retry message and preserves entered details", async ({ page }) => {
  await page.route("**/api/check", (route) => route.fulfill({ status: 502, contentType: "text/html", body: "<h1>Bad gateway</h1>" }));
  await page.goto("/search?mode=details");
  await page.getByLabel("Product name").fill("My pack");
  await page.getByRole("button", { name: "Check published warnings", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("The check service is unavailable. Try again shortly.");
  await expect(page.getByLabel("Product name")).toHaveValue("My pack");
  await expect(page.getByRole("button", { name: "Check published warnings", exact: true })).toBeEnabled();
});

test("a stalled check times out with entered details ready for retry", async ({ page }) => {
  test.setTimeout(35_000);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/check", async (route) => {
    await pending;
    await route.abort();
  });
  await page.goto("/search?mode=details");
  await page.getByLabel("Product name").fill("My pack");
  try {
    await page.getByRole("button", { name: "Check published warnings", exact: true }).click();
    await expect(page.getByLabel("Product name")).toBeDisabled();
    await expect(page.getByRole("main").getByRole("alert")).toHaveText("The check took too long. Your details are still here; try again.", { timeout: 25_000 });
    await expect(page.getByLabel("Product name")).toHaveValue("My pack");
    await expect(page.getByRole("button", { name: "Check published warnings", exact: true })).toBeEnabled();
  } finally {
    release();
  }
});
