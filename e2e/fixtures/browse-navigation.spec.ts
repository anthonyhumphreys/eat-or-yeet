import { expect, test } from "@playwright/test";

const listUrl = "/incidents?region=UK&q=fixture&hazard=allergen&store=Waitrose&page=3";
const rows = (page: import("@playwright/test").Page) => page.locator("#warnings [data-recall-slug]");

test.beforeEach(async ({ context, baseURL, page }) => {
  page.on("pageerror", error => { throw error; });
  await context.addCookies([{ name: "eat-or-yeet-region", value: "UK", url: baseURL! }]);
});

test("restores filters, loaded rows and focus after detail navigation and reload", async ({ page }) => {
  await page.goto(listUrl);
  await expect(rows(page)).toHaveCount(120);
  await expect(page).toHaveURL(/page=3/);
  await rows(page).last().click();
  await expect(page.getByRole("heading", { name: "What to do" })).toBeVisible();
  await page.getByRole("link", { name: "Back to recalls", exact: true }).click();
  await expect(rows(page)).toHaveCount(120);
  await expect(page.getByRole("searchbox")).toHaveValue("fixture");
  await expect(rows(page).last()).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await page.reload();
  await expect(rows(page)).toHaveCount(120);
  await expect(page).toHaveURL(/page=3/);
});

test("show more updates the URL and browser Back restores the expanded list", async ({ page }) => {
  await page.goto("/incidents?region=UK&q=fixture");
  await expect(rows(page)).toHaveCount(40);
  await page.getByRole("link", { name: "Show 40 more" }).click();
  await expect(rows(page)).toHaveCount(80);
  await expect(page).toHaveURL(/page=2/);
  await rows(page).last().click();
  await expect(page.getByRole("heading", { name: "What to do" })).toBeVisible();
  await page.goBack();
  await expect(rows(page)).toHaveCount(80);
  await expect(page).toHaveURL(/page=2/);
  await page.getByRole("searchbox").fill("no-such-fixture");
  await expect(page).not.toHaveURL(/page=/);
});

test("direct recalls reject external return targets and keep canonical sharing", async ({ page }) => {
  await page.goto("/incidents/fixture-0?returnTo=https%3A%2F%2Fattacker.example");
  await expect(page.getByRole("link", { name: "All UK recalls", exact: true })).toHaveAttribute("href", "/?region=UK");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/incidents\/fixture-0$/);
  await page.goto(listUrl);
  await expect(rows(page).first()).toHaveAttribute("href", /returnTo=/);
});


test("clamps an expanded list when fewer results remain",async({page})=>{
  await page.goto("/incidents?region=UK&q=fixture&page=999");
  await expect(rows(page)).toHaveCount(130);
  await expect(page).toHaveURL(/page=4/);
  await expect(page.getByRole("link",{name:/Show .* more/})).toHaveCount(0);
});
