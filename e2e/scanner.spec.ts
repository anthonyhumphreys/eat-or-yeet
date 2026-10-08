import { expect, test } from "@playwright/test";

const oreoBarcode = "044000061494";

test("ZXing fallback reads Oreo UPC 044000061494 and releases the rear camera after detection", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "eat-or-yeet-region", value: "UK", url: baseURL! }]);
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
  await page.goto("/scan");
  await expect(page.getByRole("heading", { name: "Got it. Anything else?" })).toBeVisible();
  await expect(page.getByLabel("Barcode number")).toHaveValue(oreoBarcode);
  expect(await page.evaluate(() => {
    const camera = window as typeof window & { testCameraConstraints: MediaStreamConstraints[] };
    return camera.testCameraConstraints;
  })).toContainEqual({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  await expect.poll(() => page.evaluate(() => {
    const camera = window as typeof window & { testCameraStreams: MediaStream[] };
    return camera.testCameraStreams.every((stream) => stream.getTracks().every((track) => track.readyState === "ended"));
  })).toBe(true);

  await page.getByLabel("Where did you buy this food?").selectOption("US");
  await expect(page.getByLabel("Barcode number")).toHaveValue(oreoBarcode);
  let checkedRegion: string | undefined;
  let checkedBarcode: string | undefined;
  await page.route("**/api/check", async (route) => {
    const body = route.request().postDataJSON();
    checkedRegion = body.region;
    checkedBarcode = body.observation.barcode;
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Test response" }) });
  });
  await page.getByRole("button", { name: "Check published warnings" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Test response" })).toBeVisible();
  expect(checkedRegion).toBe("US");
  expect(checkedBarcode).toBe(oreoBarcode);
});
