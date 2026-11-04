import { expect, test } from "@playwright/test";
import type { BrowsePage } from "@/lib/incidents/browse-view";

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: "eat-or-yeet-region", value: "US", url: baseURL! }]);
});

test("the initial US payload is bounded while the page and facets show complete totals", async ({ page, request }) => {
  const response = await page.goto("/incidents?region=US");
  expect(Buffer.byteLength(await response!.text())).toBeLessThan(300_000);
  const data: BrowsePage = await (await request.get("/api/warnings?region=US")).json();
  expect(data.total).toBeGreaterThan(40);
  expect(data.rows).toHaveLength(40);
  await expect(page.locator("#warnings ul > li")).toHaveCount(40);
  await expect(page.getByRole("heading", { name: `${data.total.toLocaleString("en-GB")} recalls in the US` })).toBeVisible();
  const food = page.getByRole("group", { name: "Filter by kind of product" }).getByRole("link", { name: `Food ${data.facets.types.find((facet) => facet.key === "Food")!.count.toLocaleString("en-GB")}`, exact: true });
  await expect(food).toBeVisible();

  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/warnings?*cursor=*", async (route) => { await pending; await route.continue(); });
  const started = page.waitForRequest((request) => request.url().includes("/api/warnings?") && new URL(request.url()).searchParams.has("cursor"));
  const more = page.getByRole("link", { name: /^(Show 40 more|Loading…)$/ });
  try {
    await more.focus();
    await more.press("Enter");
    await started;
    await expect(more).toBeFocused();
    await expect(more).toHaveAttribute("aria-disabled", "true");
  } finally { release(); }
  await expect(page.locator("#warnings ul > li")).toHaveCount(80);
  await expect(more).toBeFocused();
});

test("counts wait honestly and a superseded response cannot replace a newer search", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  let release!: () => void;
  let started!: () => void;
  let finished!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const oldStarted = new Promise<void>((resolve) => { started = resolve; });
  const oldFinished = new Promise<void>((resolve) => { finished = resolve; });
  await page.route("**/api/warnings?*", async (route) => {
    if (new URL(route.request().url()).searchParams.get("q") !== "milk") return route.continue();
    try {
      const response = await route.fetch();
      started();
      await pending;
      await route.fulfill({ response });
    } finally { finished(); }
  });
  await page.goto("/incidents?region=US");
  const input = page.getByRole("searchbox");
  try {
    await input.fill("milk");
    await oldStarted;
    await expect(page.getByRole("status").filter({ hasText: "Updating recalls and counts" })).toBeVisible();
    await expect(page.locator(".recall-count").first()).toHaveText("Updating count");
    await input.fill("bread");
    await expect(page.getByRole("heading", { name: /recalls? found/ })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Updating recalls and counts" })).toHaveCount(0);
    const titles = await page.locator("#warnings ul > li").allTextContents();
    release();
    await oldFinished;
    await expect(input).toHaveValue("bread");
    expect(await page.locator("#warnings ul > li").allTextContents()).toEqual(titles);
    expect(await page.locator(".recall-count-ready").first().evaluate((element) => parseFloat(getComputedStyle(element).animationDuration))).toBeLessThan(0.001);
  } finally { release(); }
});

test("failed filtering retains results and retry can reach a true empty result", async ({ page }) => {
  await page.route("**/api/warnings?*", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Fixture outage" }) }));
  await page.goto("/incidents?region=US");
  const rows = page.locator("#warnings ul > li");
  await expect(rows).toHaveCount(40);
  await page.getByRole("searchbox").fill("zzzznorecallmatch");
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await expect(rows).toHaveCount(40);
  await expect(page.getByText("No recall reports match.")).toHaveCount(0);
  await page.unroute("**/api/warnings?*");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("main").getByText("No recall reports match.")).toBeVisible();
  await expect(rows).toHaveCount(0);
});

test("back navigation restores the query, visible page and complete count together", async ({ page, request }) => {
  const original = "/incidents?region=US&q=milk&page=2";
  const expected: BrowsePage = await (await request.get("/api/warnings?region=US&q=milk")).json();
  await page.goto(original);
  await expect(page.locator("#warnings ul > li")).toHaveCount(Math.min(80, expected.total));
  // Preserve this entry, as a same-document navigation would, before editing its successor.
  await page.evaluate(() => history.pushState(history.state, "", location.href));
  await page.getByRole("searchbox").fill("bread");
  await expect(page).toHaveURL(/q=bread/);
  await expect(page.getByRole("status").filter({ hasText: "Updating recalls and counts" })).toHaveCount(0);
  await page.goBack();
  await expect(page.getByRole("searchbox")).toHaveValue("milk");
  await expect(page).toHaveURL(/q=milk.*page=2/);
  await expect(page.locator("#warnings ul > li")).toHaveCount(Math.min(80, expected.total));
  await expect(page.getByRole("heading", { name: `${expected.total.toLocaleString("en-GB")} recalls found` })).toBeVisible();
});
