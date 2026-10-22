// Captures real production screenshots and live food recall counts for the sizzle reel.
// Usage: pnpm capture [--base=https://www.eatoryeet.app]
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const base = process.argv.find((arg) => arg.startsWith("--base="))?.slice(7) ?? "https://www.eatoryeet.app";
const out = new URL("../public/shots/", import.meta.url);
await mkdir(out, { recursive: true });

const shots = [
  { name: "home-uk-light", path: "/", region: "UK", scheme: "light", device: "phone" },
  { name: "home-us-dark", path: "/", region: "US", scheme: "dark", device: "phone" },
  { name: "incident-uk-light", path: "incident", region: "UK", scheme: "light", device: "phone" },
  { name: "incident-us-dark", path: "incident", region: "US", scheme: "dark", device: "desktop" },
  { name: "home-uk-desktop", path: "/", region: "UK", scheme: "light", device: "desktop" },
  { name: "allergens-uk-light", path: "/?region=UK&hazard=allergen", region: "UK", scheme: "light", device: "phone", toList: true },
];
// The food category the browse demo taps. Any category chip label on the UK home page works.
const DEMO_CATEGORY = "Dairy & eggs";
const devices = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 },
};

const counts = {};
const browser = await chromium.launch();
for (const shot of shots) {
  const context = await browser.newContext({ ...devices[shot.device], colorScheme: shot.scheme, locale: shot.region === "UK" ? "en-GB" : "en-US" });
  await context.addCookies([
    { name: "eat-or-yeet-region", value: shot.region, url: base },
    { name: "eat-or-yeet-analytics", value: "v1.declined", url: base },
  ]);
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(base, { waitUntil: "networkidle" });
  // The Food tab only: "Everything" also counts FDA drug enforcement reports.
  const food = (await page.locator("a, button").filter({ hasText: /^Food\s+[\d,]+$/ }).first().textContent())?.match(/[\d,]+/)?.[0];
  if (food) counts[shot.region] = Number(food.replaceAll(",", ""));
  if (shot.path === "incident") {
    const href = await page.locator('a[href^="/incidents/"]').first().getAttribute("href");
    await page.goto(base + href, { waitUntil: "networkidle" });
  } else if (shot.path !== "/") {
    await page.goto(base + shot.path, { waitUntil: "networkidle" });
  }
  if (shot.toList) await page.getByPlaceholder(/allergen or shop/).evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 160));
  await page.waitForTimeout(800);
  await page.screenshot({ path: fileURLToPath(new URL(`${shot.name}.png`, out)), type: "png" });
  console.log("captured", shot.name);
  await context.close();
}

// Real list data for the recreated browse UI: top alert, tab and category counts, and rows.
const scrapeList = () => {
  const kind = (el) => (el?.className.includes("yeet-soft") ? "pathogen" : el?.className.includes("maybe-soft") ? "allergen" : "other");
  const alert = [...document.querySelectorAll('a[href^="/incidents/"]')].find((a) => !a.closest("li"));
  const chips = (container) => [...container.querySelectorAll("a")].map((a) => a.textContent.trim().match(/^(.*?)\s+([\d,]+)$/)).filter(Boolean).map(([, label, count]) => ({ label, count }));
  const chipRows = [...document.querySelectorAll("a[aria-current]")].map((a) => a.parentElement);
  return {
    heading: document.querySelector("h2 .tabular-nums")?.parentElement.textContent.trim(),
    alert: alert && { label: alert.querySelector("span span")?.textContent.trim(), title: alert.querySelector("span.block")?.textContent.trim() },
    types: chipRows[0] ? chips(chipRows[0]) : [],
    categories: chipRows[1] ? chips(chipRows[1]) : [],
    rows: [...document.querySelectorAll('li > a[href^="/incidents/"]')].slice(0, 6).map((a) => {
      const body = a.querySelector("span.min-w-0");
      const meta = body.children[1];
      return {
        title: body.children[0].textContent.trim(),
        hazard: meta.children[0].textContent.replace("Hazard:", "").trim(),
        kind: kind(meta.children[0]),
        categories: meta.children[1]?.textContent.trim() ?? "",
        date: body.children[2]?.textContent.trim() ?? "",
      };
    }),
  };
};
const context = await browser.newContext({ ...devices.phone, locale: "en-GB" });
await context.addCookies([{ name: "eat-or-yeet-region", value: "UK", url: base }, { name: "eat-or-yeet-analytics", value: "v1.declined", url: base }]);
const page = await context.newPage();
await page.goto(base, { waitUntil: "networkidle" });
const all = await page.evaluate(scrapeList);
await page.goto(`${base}/?${new URLSearchParams({ region: "UK", category: DEMO_CATEGORY })}`, { waitUntil: "networkidle" });
const filtered = await page.evaluate(scrapeList);
await browser.close();

if (!counts.UK || !counts.US) throw new Error(`Could not read food recall counts: ${JSON.stringify(counts)}`);
if (!all.alert || all.rows.length < 4 || filtered.rows.length < 3) throw new Error("Could not read the recall list");
await writeFile(new URL("../public/stats.json", import.meta.url), `${JSON.stringify({ ...counts, capturedAt: new Date().toISOString() }, null, 2)}\n`);
await writeFile(new URL("../public/browse.json", import.meta.url), `${JSON.stringify({ category: DEMO_CATEGORY, all, filtered }, null, 2)}\n`);
console.log("counts", counts, "rows", all.rows.length, filtered.rows.length);
