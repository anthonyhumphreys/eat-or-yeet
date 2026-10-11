import { expect, test } from "@playwright/test";
import { getNotionSetupOrigin } from "../src/lib/integrations/notion-installation";

const enabled = Boolean(getNotionSetupOrigin());

test("disabled Notion entry explains availability without an install button", async ({ page, context, baseURL }) => {
  test.skip(enabled, "This case runs against the default-off server.");
  await context.addCookies([{ name: "eat-or-yeet-region", value: "US", url: baseURL! }]);
  await page.goto("/integrations/notion");
  await expect(page.getByRole("heading", { name: "Get the template now" })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Add to Notion/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Get the Notion template" })).toHaveAttribute("href", /notion\.site/);
  await expect(page.getByRole("link", { name: "check your packet on this site" })).toHaveAttribute("href", "/search");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test.describe("enabled Notion entry", () => {
  test.skip(!enabled, "Run with complete Notion setup configuration.");

  test("uses the saved country and follows a header change before installation", async ({ page, context, baseURL }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await context.addCookies([{ name: "eat-or-yeet-region", value: "UK", url: baseURL! }]);
    await page.goto("/integrations/notion");
    const add = page.getByRole("link", { name: "Add to Notion", exact: true });
    await expect(add).toHaveAttribute("href", "/api/notion/connect?region=UK");
    await page.getByRole("combobox", { name: "Warning location", exact: true }).selectOption("US");
    await expect(add).toHaveAttribute("href", "/api/notion/connect?region=US");
    await expect(page.getByText("Warning country: United States", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Manage, reconnect or disconnect a Notion list" })).toHaveAttribute("href", "/integrations/notion/manage");
    await expect(page.getByRole("heading", { name: "You control the connection" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });

  test("first visit carries the country confirmed in the global prompt", async ({ page, context }) => {
    await page.goto("/integrations/notion");
    const prompt = page.getByRole("dialog", { name: "Where do you buy your food?" });
    await expect(prompt).toBeVisible();
    await prompt.getByRole("radio", { name: /United States/ }).check();
    await prompt.getByRole("button", { name: "Show US recalls" }).click();
    await expect(prompt).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Add to Notion", exact: true })).toHaveAttribute("href", "/api/notion/connect?region=US");
    expect((await context.cookies()).find((cookie) => cookie.name === "eat-or-yeet-region")?.value).toBe("US");
  });

  test("an explicit region link overrides a saved country", async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "eat-or-yeet-region", value: "UK", url: baseURL! }]);
    await page.goto("/integrations/notion?region=US");
    await expect(page.getByRole("link", { name: "Add to Notion", exact: true })).toHaveAttribute("href", "/api/notion/connect?region=US");
    await page.getByRole("combobox", { name: "Warning location", exact: true }).selectOption("UK");
    await expect(page.getByRole("link", { name: "Add to Notion", exact: true })).toHaveAttribute("href", "/api/notion/connect?region=UK");
    await expect(page).toHaveURL(/region=UK/);
  });
});
