import { expect, test } from "@playwright/test";

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: "eat-or-yeet-region", value: "UK", url: baseURL! }]);
});

test("switching from a food category to Medical clears the category and restores through reload", async ({ page }) => {
  await page.goto("/?region=US");
  const kinds = page.getByRole("group", { name: "Filter by kind of product" });
  const categories = page.getByRole("group", { name: "Filter by category" });
  await expect(kinds).toBeVisible();
  await categories.getByRole("link", { name: /^Snacks & sweets/ }).click();
  await expect(page).toHaveURL(/category=Snacks/);

  // Counts describe the selection after switching kind, which clears the category.
  const medical = kinds.getByRole("link", { name: /^Medical [1-9]/ });
  await expect(medical).toBeVisible();
  await medical.click();
  await expect(page).toHaveURL(/type=Medical/);
  expect(new URL(page.url()).searchParams.has("category")).toBe(false);
  await expect(page.locator("#warnings li").first()).toBeVisible();
  await expect(categories.getByRole("link", { name: /^Snacks & sweets/ })).toHaveCount(0);
  await page.reload();
  await expect(medical).toHaveAttribute("aria-current", "true");

  await page.locator("#warnings li a").first().click();
  await expect(page.getByRole("heading", { name: "What to do" })).toBeVisible();
  await expect(page.getByText(/Do not stop taking a prescribed medicine/)).toBeVisible();
  await expect(page.getByText(/Current recall status is unverified/)).toBeVisible();
  await expect(page.getByText(/Published recall report/)).toBeVisible();
  await expect(page.getByText(/Active recall ·/)).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Check your pack", exact: true })).toHaveCount(0);
});

test("a medicine search with no matches offers pharmacist advice instead of the food checker", async ({ page }) => {
  await page.goto("/?region=US&type=Medical&q=zzzznotarealmedicine");
  await expect(page.getByText("No recall reports match.")).toBeVisible();
  await expect(page.getByText(/For a medicine, check the latest official information or ask a pharmacist/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Check its codes and dates", exact: true })).toHaveCount(0);
});

test("food recall pages preserve the recall region when checking a pack", async ({ page }) => {
  await page.goto("/?region=UK");
  await page.locator("#warnings li a").first().click();
  await expect(page.getByRole("link", { name: "Check your pack", exact: true })).toHaveAttribute("href", "/search?mode=details&region=UK");
});
