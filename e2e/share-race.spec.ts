import { expect, test } from "@playwright/test";

test("sharing a filtered US list uses visible filters before the address bar syncs", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "eat-or-yeet-region", value: "US", url: baseURL! }]);
  await page.goto("/?region=US");

  await expect(page.getByRole("button", { name: "Share this list" })).toBeVisible();
  await page.evaluate(() => {
    const nativeSetTimeout = window.setTimeout.bind(window);
    window.setTimeout = ((handler: TimerHandler, timeout = 0, ...args: unknown[]) =>
      nativeSetTimeout(handler, timeout === 300 ? 60_000 : timeout, ...args)) as typeof window.setTimeout;
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async ({ url }: ShareData) => {
        (window as typeof window & { __sharedUrl?: string }).__sharedUrl = url;
      },
    });
  });

  const snacks = page.getByRole("group", { name: "Filter by category" }).getByRole("link", { name: /^Snacks & sweets/ });
  await snacks.click();
  await expect(snacks).toHaveAttribute("aria-current", "true");
  expect(new URL(page.url()).searchParams.has("category")).toBe(false);

  await page.getByRole("button", { name: "Share this list" }).click();
  const sharedUrl = await page.evaluate(() => (window as typeof window & { __sharedUrl?: string }).__sharedUrl);

  expect(sharedUrl).toBeDefined();
  const shared = new URL(sharedUrl!);
  expect(shared.origin).toBe(new URL(page.url()).origin);
  expect(shared.searchParams.get("region")).toBe("US");
  expect(shared.searchParams.get("category")).toBe("Snacks & sweets");
  expect(new URL(page.url()).searchParams.has("category")).toBe(false);
});
