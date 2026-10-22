// Capture a separate set of production views without changing the original sizzle assets.
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const base = process.argv.find((arg) => arg.startsWith("--base="))?.slice(7) ?? "https://www.eatoryeet.app";
const out = new URL("../public/overview/", import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 430, height: 840 }, deviceScaleFactor: 2, colorScheme: "light", locale: "en-GB", permissions: ["clipboard-read", "clipboard-write"] });
await context.addCookies([
  { name: "eat-or-yeet-region", value: "UK", url: base },
  { name: "eat-or-yeet-analytics", value: "v1.declined", url: base },
]);
const page = await context.newPage();
await page.emulateMedia({ reducedMotion: "reduce" });

async function capture(name) {
  await page.screenshot({ path: fileURLToPath(new URL(`${name}.png`, out)) });
  console.log("captured", name);
}
async function visit(path) {
  const response = await page.goto(base + path, { waitUntil: "networkidle" });
  if (!response?.ok()) throw new Error(`Could not capture ${path}`);
  await page.getByRole("main").waitFor();
  await page.evaluate(() => document.fonts.ready);
}
async function scrollToList() {
  await page.locator("#warnings").evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 16));
}

try {
  await visit("/?region=UK&type=Food");
  await capture("uk-home");
  await scrollToList();
  await capture("uk-list");
  await visit("/?region=US&type=Food");
  await capture("us-home");
  await visit("/?region=UK&type=Food&category=Dairy+%26+eggs");
  await scrollToList();
  await capture("category");
  await visit("/?region=UK&type=Food&hazard=allergen");
  await scrollToList();
  await capture("allergens");
  await visit("/incidents/fsa-prin-48-2026");
  const detail = await page.evaluate(() => ({
    title: document.querySelector("article h1")?.textContent?.trim(),
    advice: document.querySelector('[aria-labelledby="advice-heading"] > p')?.textContent?.trim(),
    officialUrl: document.querySelector('[aria-labelledby="advice-heading"] > a')?.href,
  }));
  if (!detail.title || !detail.advice || !detail.officialUrl) throw new Error("Could not capture the published warning");
  await capture("notice");
  await page.locator('[aria-labelledby="advice-heading"]').evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 16));
  await capture("advice");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole("button", { name: "Share this recall", exact: true }).click();
  await page.getByRole("button", { name: /copied/i }).waitFor();
  await capture("share");
  await visit("/search?mode=details&region=UK");
  await capture("pack-details");
  await page.getByRole("button", { name: "Barcode", exact: true }).click();
  await page.locator("#manual-barcode").fill("5051873005819");
  await capture("pack-barcode");
  await writeFile(new URL("content.json", out), JSON.stringify({ ...detail, capturedAt: new Date().toISOString(), region: "UK", slug: "fsa-prin-48-2026" }, null, 2) + "\n");
} finally {
  await browser.close();
}
