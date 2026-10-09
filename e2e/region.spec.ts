import { expect, test, type Page } from "@playwright/test";

test.use({ locale: "en-GB", timezoneId: "America/New_York" });

const countryDialog = (page: Page) => page.getByRole("dialog", { name: "Where do you buy your food?" });

test("first visit asks for a country with the browser's suggestion pre-selected and remembers the choice", async ({ page, context }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto("/");
  const prompt = countryDialog(page);
  await expect(prompt).toBeVisible();
  await expect(prompt.getByRole("radio", { name: /United States/ })).toBeChecked();
  await expect(prompt).toContainText("Suggested");
  await expect(page).toHaveURL(/region=UK/);
  expect((await context.cookies()).some((cookie) => cookie.name === "eat-or-yeet-region")).toBe(false);
  await page.reload();
  await expect(countryDialog(page)).toBeVisible();
  await countryDialog(page).getByRole("button", { name: "Show US recalls" }).click();
  await expect(countryDialog(page)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /recalls in the US$/ })).toBeVisible();
  expect((await context.cookies()).find((cookie) => cookie.name === "eat-or-yeet-region")?.value).toBe("US");
  await page.goto("/scan");
  await expect(page.getByRole("combobox", { name: "Warning location", exact: true })).toHaveValue("US");
  await expect(page.getByLabel("Where did you buy this food?")).toHaveCount(0);
  await page.reload();
  await expect(countryDialog(page)).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Warning location", exact: true })).toHaveValue("US");
  expect(errors).toEqual([]);
});

test("choosing the UK persists even when the browser suggests US", async ({ page, context }) => {
  await page.goto("/search");
  const prompt = countryDialog(page);
  await prompt.getByRole("radio", { name: /United Kingdom/ }).check();
  await prompt.getByRole("button", { name: "Show UK recalls" }).click();
  await expect(prompt).toHaveCount(0);
  expect((await context.cookies()).find((cookie) => cookie.name === "eat-or-yeet-region")?.value).toBe("UK");
  await page.reload();
  await expect(countryDialog(page)).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Warning location", exact: true })).toHaveValue("UK");
  await expect(page.getByLabel("Where did you buy this food?")).toHaveCount(0);
});

test("closing the country question keeps the pre-selected country", async ({ page, context }) => {
  await page.goto("/");
  await expect(countryDialog(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(countryDialog(page)).toHaveCount(0);
  expect((await context.cookies()).find((cookie) => cookie.name === "eat-or-yeet-region")?.value).toBe("US");
});

test("saved regions hide repeated questions and the header can change a check", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "eat-or-yeet-region", value: "UK", url: baseURL! }]);
  await page.goto("/search?mode=details&region=UK");
  await expect(countryDialog(page)).toHaveCount(0);
  const location = page.getByRole("combobox", { name: "Warning location", exact: true });
  await expect(location).toHaveValue("UK");
  await expect(page.getByLabel("Where did you buy this food?")).toHaveCount(0);
  await page.getByLabel("Product name").fill("Golden Oreo Mini");
  await location.selectOption("US");
  await expect(location).toHaveValue("US");
  await expect(page.getByLabel("Product name")).toHaveValue("Golden Oreo Mini");
  await expect(page).toHaveURL(/region=US/);
  let checkedRegion: string | undefined;
  await page.route("**/api/check", async (route) => {
    checkedRegion = route.request().postDataJSON().region;
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Test response" }) });
  });
  await page.getByRole("button", { name: "Check published warnings" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Test response" })).toBeVisible();
  expect(checkedRegion).toBe("US");
});

test("request country takes precedence over an uncertain browser suggestion", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.setExtraHTTPHeaders({ "x-vercel-ip-country": "GB" });
  await page.goto("/");
  await expect(countryDialog(page).getByRole("radio", { name: /United Kingdom/ })).toBeChecked();
  expect(errors).toEqual([]);
});
