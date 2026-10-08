import { expect, test } from "@playwright/test";

test.use({ locale: "en-GB", timezoneId: "America/New_York" });

test("first visit suggests a browser region and remembers the accepted choice", async ({ page, context }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto("/");
  const prompt = page.getByRole("complementary", { name: "Choose your warning region" });
  await expect(prompt).toContainText("Suggested for you: United States");
  await expect(page).toHaveURL(/region=UK/);
  expect((await context.cookies()).some((cookie) => cookie.name === "eat-or-yeet-region")).toBe(false);
  await page.reload();
  await expect(prompt).toContainText("Suggested for you: United States");
  await expect(page.getByRole("combobox", { name: "Warning location", exact: true })).toHaveValue("UK");
  await prompt.getByRole("button", { name: "Use US warnings" }).click();
  await expect(prompt).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /warnings in the US$/ })).toBeVisible();
  expect((await context.cookies()).find((cookie) => cookie.name === "eat-or-yeet-region")?.value).toBe("US");
  await page.goto("/scan");
  await expect(page.getByLabel("Where did you buy this food?")).toHaveValue("US");
  await page.reload();
  await expect(prompt).toHaveCount(0);
  await expect(page.getByLabel("Where did you buy this food?")).toHaveValue("US");
  expect(errors).toEqual([]);
});

test("confirming the default UK choice persists even when the browser suggests US", async ({ page, context }) => {
  await page.goto("/search");
  const prompt = page.getByRole("complementary", { name: "Choose your warning region" });
  await prompt.getByRole("button", { name: "Use UK warnings" }).click();
  await expect(prompt).toHaveCount(0);
  expect((await context.cookies()).find((cookie) => cookie.name === "eat-or-yeet-region")?.value).toBe("UK");
  await page.reload();
  await expect(prompt).toHaveCount(0);
  await expect(page.getByLabel("Where did you buy this food?")).toHaveValue("UK");
});

test("saved and explicit URL regions are respected and suggestions can change a check", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "eat-or-yeet-region", value: "UK", url: baseURL! }]);
  await page.goto("/search?mode=details&region=UK");
  await expect(page.getByRole("complementary", { name: "Choose your warning region" })).toHaveCount(0);
  await expect(page.getByLabel("Where did you buy this food?")).toHaveValue("UK");
  await page.getByLabel("Product name").fill("Golden Oreo Mini");
  await page.getByRole("button", { name: "Use US warnings" }).click();
  await expect(page.getByLabel("Where did you buy this food?")).toHaveValue("US");
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
  await expect(page.getByRole("complementary", { name: "Choose your warning region" })).toContainText("Suggested for you: United Kingdom");
  expect(errors).toEqual([]);
});
