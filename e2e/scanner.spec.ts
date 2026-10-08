import { expect, test, type Page } from "@playwright/test";

import { emptyObservation, type ProductObservation } from "@/lib/domain/schemas";
import type { VerdictResult } from "@/lib/domain/types";

const oreoBarcode = "044000061494";
const oreoGtin = "00044000061494";
type CheckPayload = { region: "UK" | "US"; observation: ProductObservation };

function checkResult(region: "UK" | "US", identified = true): VerdictResult {
  const checkedAt = "2026-10-08T12:00:00.000Z";
  return {
    verdict: identified ? "EAT" : "NO_CLUE",
    matchLevel: "none",
    observation: { ...emptyObservation(), barcode: oreoGtin, productName: identified ? "Golden Oreo Mini" : null, brand: identified ? "Nabisco" : null },
    matches: [],
    checkedAt,
    datasetRegions: [region],
    datasetStatus: { healthy: true, checkedAt, regions: [region], sources: [] },
  };
}

async function installOreoCamera(page: Page) {
  await page.addInitScript(() => {
    // UPC-A bars for 044000061494, the barcode entered in the reported video.
    const bars = "10100011010100011010001100011010001101000110101010111001010100001100110101110011101001011100101";
    const camera = window as typeof window & { testCameraStreams: MediaStream[]; testCameraConstraints: MediaStreamConstraints[] };
    camera.testCameraStreams = [];
    camera.testCameraConstraints = [];
    Reflect.deleteProperty(window, "BarcodeDetector");
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async (constraints: MediaStreamConstraints) => {
          camera.testCameraConstraints.push(constraints);
          const canvas = document.createElement("canvas");
          canvas.width = 1280;
          canvas.height = 720;
          const context = canvas.getContext("2d")!;
          const stream = canvas.captureStream(10);
          camera.testCameraStreams.push(stream);
          function draw() {
            context.fillStyle = "white";
            context.fillRect(0, 0, canvas.width, canvas.height);
            context.fillStyle = "black";
            for (let index = 0; index < bars.length; index++) {
              if (bars[index] === "1") context.fillRect(260 + index * 8, 180, 8, 360);
            }
            if (stream.active) requestAnimationFrame(draw);
          }
          draw();
          return stream;
        },
      },
    });
  });
}

test("Oreo scan checks immediately, releases the rear camera, and offers optional details from the result", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "eat-or-yeet-region", value: "US", url: baseURL! }]);
  await installOreoCamera(page);
  const checks: CheckPayload[] = [];
  await page.route("**/api/check", async (route) => {
    checks.push(route.request().postDataJSON() as CheckPayload);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(checkResult("US")) });
  });
  await page.goto("/scan");
  await expect(page.getByRole("heading", { name: "No matching warning found" })).toBeFocused();
  await expect(page.getByLabel("Product name")).toHaveCount(0);
  await expect(page.getByLabel("Where did you buy this food?")).toHaveCount(0);
  expect(checks).toHaveLength(1);
  expect(checks[0]).toMatchObject({ region: "US", observation: { barcode: oreoBarcode, productName: null } });
  expect(await page.evaluate(() => {
    const camera = window as typeof window & { testCameraConstraints: MediaStreamConstraints[] };
    return camera.testCameraConstraints;
  })).toContainEqual({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  await expect.poll(() => page.evaluate(() => {
    const camera = window as typeof window & { testCameraStreams: MediaStream[] };
    return camera.testCameraStreams.every((stream) => stream.getTracks().every((track) => track.readyState === "ended"));
  })).toBe(true);

  await page.getByRole("button", { name: "Edit details" }).click();
  await expect(page.getByRole("heading", { name: "Add label details" })).toBeFocused();
  await expect(page.getByLabel("Barcode number")).toHaveValue(oreoGtin);
  await expect(page.getByLabel("Product name")).toHaveValue("Golden Oreo Mini");
  await expect(page.getByLabel("Brand", { exact: true })).toHaveValue("Nabisco");
  await page.getByLabel("Batch code").fill("TEST-BATCH");
  await page.getByRole("button", { name: "Check published warnings" }).click();
  await expect(page.getByRole("heading", { name: "No matching warning found" })).toBeVisible();
  expect(checks).toHaveLength(2);
  expect(checks[1]).toMatchObject({ region: "US", observation: { barcode: oreoGtin, productName: "Golden Oreo Mini", batchCode: "TEST-BATCH" } });
});

test("an unidentified typed barcode offers label entry after the first check", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "eat-or-yeet-region", value: "US", url: baseURL! }]);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => { throw new DOMException("Permission denied", "NotAllowedError"); } } });
  });
  const checks: CheckPayload[] = [];
  await page.route("**/api/check", async (route) => {
    checks.push(route.request().postDataJSON() as CheckPayload);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(checkResult("US", checks.length > 1)) });
  });
  await page.goto("/scan");
  await page.getByLabel("Or type the number").fill(oreoBarcode);
  await page.getByRole("button", { name: "Check published warnings" }).click();
  await expect(page.getByRole("heading", { name: "Not enough details" })).toBeVisible();
  await expect(page.getByLabel("Product name")).toHaveCount(0);
  await page.getByRole("button", { name: "Add label details" }).click();
  await expect(page.getByLabel("Barcode number")).toHaveValue(oreoGtin);
  await page.getByLabel("Product name").fill("Golden Oreo Mini");
  await page.getByRole("button", { name: "Check published warnings" }).click();
  await expect(page.getByRole("heading", { name: "No matching warning found" })).toBeVisible();
  expect(checks[1]).toMatchObject({ region: "US", observation: { barcode: oreoGtin, productName: "Golden Oreo Mini" } });
});

test("a failed automatic check retries the same barcode without opening a form", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "eat-or-yeet-region", value: "US", url: baseURL! }]);
  await installOreoCamera(page);
  const checks: CheckPayload[] = [];
  await page.route("**/api/check", async (route) => {
    checks.push(route.request().postDataJSON() as CheckPayload);
    await route.fulfill({ status: checks.length === 1 ? 503 : 200, contentType: "application/json", body: JSON.stringify(checks.length === 1 ? { error: "Warning database unavailable" } : checkResult("US")) });
  });
  await page.goto("/scan");
  await expect(page.getByRole("heading", { name: "Couldn't complete this check" })).toBeFocused();
  await expect(page.getByRole("alert").filter({ hasText: "Warning database unavailable" })).toBeVisible();
  await expect(page.getByLabel("Product name")).toHaveCount(0);
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("heading", { name: "No matching warning found" })).toBeVisible();
  expect(checks).toHaveLength(2);
  expect(checks[1]).toEqual(checks[0]);
});

test("first scan waits for a region choice and then checks automatically", async ({ page }) => {
  await installOreoCamera(page);
  const checks: CheckPayload[] = [];
  await page.route("**/api/check", async (route) => {
    checks.push(route.request().postDataJSON() as CheckPayload);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(checkResult("US")) });
  });
  await page.goto("/scan");
  await expect(page.getByRole("status").filter({ hasText: "Choose a warning region above" })).toBeVisible();
  await page.getByLabel("Or type the number").fill(oreoBarcode);
  await expect(page.getByRole("button", { name: "Check published warnings" })).toBeDisabled();
  await page.getByLabel("Or type the number").press("Enter");
  expect(await page.evaluate(() => (window as typeof window & { testCameraStreams: MediaStream[] }).testCameraStreams.length)).toBe(0);
  expect(checks).toHaveLength(0);
  await page.getByRole("button", { name: "Use US warnings" }).click();
  await expect(page.getByRole("heading", { name: "No matching warning found" })).toBeVisible();
  expect(checks).toHaveLength(1);
  expect(checks[0]).toMatchObject({ region: "US", observation: { barcode: oreoBarcode } });
  await expect(page.getByRole("complementary", { name: "Choose your warning region" })).toHaveCount(0);
});
