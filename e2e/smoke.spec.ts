import { expect, test } from "@playwright/test";

test("home explains the product and exposes both camera paths", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Eat or Yeet?" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Scan my food/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Take a photo/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Admin" })).toHaveCount(0);
  await expect(page.locator("[data-nextjs-dialog]")).toHaveCount(0);
  expect(consoleErrors).toEqual([]);
});

test("system dark mode hydrates without a framework error", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Eat or Yeet?" })).toBeVisible();
  await expect(page.locator("[data-nextjs-dialog]")).toHaveCount(0);
  expect(consoleErrors).toEqual([]);
});

test("manual fallback exposes recall identifiers", async ({ page }) => {
  await page.goto("/search");
  await expect(page.getByRole("heading", { name: "Search food warnings" })).toBeVisible();
  await expect(page.getByLabel("Barcode number")).toBeVisible();
  await page.getByRole("tab", { name: "Label details" }).click();
  await expect(page.getByLabel("Batch code")).toBeVisible();
  await expect(page.getByLabel("Producer", { exact: true })).toBeVisible();
  await expect(page.locator("[data-nextjs-dialog]")).toHaveCount(0);
});

test("manual evidence reaches the deterministic warning result", async ({ page }) => {
  await page.goto("/search");
  await page.getByRole("tab", { name: "Label details" }).click();
  await page.getByLabel("Product").fill("Tesco Finest Mozzarella Pearls & Pesto Orzo Salad");
  await page.getByRole("button", { name: "Check these details" }).click();
  await expect(page.getByRole("heading", { name: "MAYBE YEET" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Food Standards Agency")).toBeVisible();
  await expect(page.getByText(/Product name Tesco Finest/)).toBeVisible();
});

test("photo analysis checks immediately and keeps editing available", async ({ page }) => {
  const observation = {
    productName: "Test label",
    brand: null,
    barcode: "12345670",
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
    rawVisibleText: ["Test label", "12345670"],
    confidence: 1,
  };
  await page.route("**/api/analyse", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ observation }) }));
  await page.route("**/api/check", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ verdict: "EAT", matchLevel: "none", observation, matches: [], checkedAt: new Date().toISOString(), datasetRegions: ["UK"] }) }));

  await page.goto("/scan?mode=photo");
  await page.locator('input[type="file"]').setInputFiles({ name: "label.png", mimeType: "image/png", buffer: Buffer.from("not-a-real-image") });
  await expect(page.getByRole("heading", { name: "EAT" })).toBeVisible();
  await page.getByRole("button", { name: "Edit details" }).click();
  await expect(page.getByRole("heading", { name: "Edit checked details" })).toBeVisible();
  await expect(page.getByLabel("Product")).toHaveValue("Test label");
});
