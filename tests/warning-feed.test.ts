import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listWarnings, getNews } = vi.hoisted(() => ({ listWarnings: vi.fn(), getNews: vi.fn() }));
vi.mock("@/db/queries", () => ({ listActivePublicIncidents: listWarnings }));
vi.mock("@/lib/news/feed", () => ({ getFoodSafetyNews: getNews }));

import { WarningFeed } from "@/components/incidents/warning-feed";
import { RegionalNews } from "@/components/news/regional-news";

const rows = [
  { id: "1", slug: "chocolate", title: "Waitrose recalls milk chocolate", summary: "An affected batch", hazard: "Undeclared milk", pathogen: null, region: "UK", authority: "Food Standards Agency", categories: ["Snacks & sweets", "Dairy & eggs"], superCategories: ["Food"], stores: ["Waitrose"], updatedAt: new Date("2026-10-07T12:00:00Z") },
  { id: "2", slug: "bread", title: "Bread recall", summary: "Check the batch", hazard: "Contamination of product with Listeria monocytogenes", pathogen: "Listeria monocytogenes", region: "UK", authority: "Food Standards Agency", categories: ["Bakery & grains"], superCategories: ["Food"], stores: ["Tesco"], updatedAt: new Date("2026-10-06T12:00:00Z") },
  { id: "3", slug: "us-eggs", title: "US eggs recalled", summary: "Salmonella", hazard: "Salmonella", pathogen: "Salmonella", region: "US", authority: "FDA", categories: ["Dairy & eggs"], superCategories: ["Food"], stores: [], updatedAt: new Date("2026-10-05T12:00:00Z") },
];

// The recall list itself, after the top alert.
const list = (html: string) => html.slice(html.indexOf('id="warnings"'));
const warningLinks = (html: string) => (list(html).match(/href="\/incidents\/[^"]+"/g) ?? []).map((link) => link.replace(/\?[^"]+/, ""));

beforeEach(() => {
  // The top alert and "x ago" depend on today's date.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-08T12:00:00Z"));
  listWarnings.mockResolvedValue(rows);
  getNews.mockResolvedValue({ articles: [], unavailable: false });
});

afterEach(() => {
  vi.useRealTimers();
});

async function render(params = {}, region: "UK" | "US" = "UK") {
  const content = await WarningFeed({ params, region, path: "/" });
  return renderToStaticMarkup(createElement("div", null, content));
}

describe("warnings landing feed", () => {
  it("searches complete source hazards and product text without expanding display tags", async () => {
    listWarnings.mockResolvedValue([{ ...rows[0], title: "Various products recalled", hazard: "Undeclared milk, egg and sesame allergens", searchText: "northstar sesame crunch" }]);
    const html = await render({ q: "sesame northstar" });
    expect(warningLinks(html)).toHaveLength(1);
    expect(html).toContain("Milk, egg +1");
    expect(warningLinks(await render({ q: "sesame absent" }))).toHaveLength(0);
  });

  it("adds a kind-of-product row once a region has more than food, and filters by it", async () => {
    const medicine = { ...rows[2], id: "4", slug: "infant-drops", title: "Infant drops recalled", hazard: "Subpotent drug", pathogen: null, categories: ["Over-the-counter medicines"], superCategories: ["Baby", "Medical"], updatedAt: new Date("2026-10-04T12:00:00Z") };
    listWarnings.mockResolvedValue([...rows, medicine]);

    const uk = await render();
    expect(uk).not.toContain('aria-label="Filter by kind of product"');

    const everything = await render({}, "US");
    expect(everything).toContain('aria-label="Filter by kind of product"');
    expect(everything).toContain('href="/?region=US&amp;type=Medical"');
    expect(everything).not.toContain("type=Cosmetics");
    expect(warningLinks(everything)).toHaveLength(2);

    const medical = await render({ type: "Medical" }, "US");
    expect(warningLinks(medical)).toEqual(['href="/incidents/infant-drops"']);
    expect(medical).toContain('href="/?region=US&amp;type=Medical&amp;category=Over-the-counter+medicines"');
    expect(medical).not.toContain("category=Supplements");
    expect(medical).toContain("Published report · current status unverified");
    const empty = await render({ type: "Medical", q: "not-a-real-medicine" }, "US");
    expect(empty).not.toContain("Check its codes and dates");
    expect(empty).toContain("ask a pharmacist");
    listWarnings.mockResolvedValue([medicine]);
    expect(await render({ type: "Medical" }, "US")).not.toContain("Top alert");
  });

  it("renders stable September abbreviations and keeps London date boundaries", async () => {
    listWarnings.mockResolvedValue([
      { ...rows[0], updatedAt: new Date("2026-09-30T12:00:00Z") },
      { ...rows[1], updatedAt: new Date("2026-09-30T23:30:00Z") },
    ]);
    const html = await render();
    expect(html).toContain("30 Sep");
    expect(html).not.toContain("30 Sept");
    expect(html).toContain("1 Oct");
  });

  it("scopes warnings by region and lists a multi-category notice once", async () => {
    const html = await render();
    expect(html).not.toContain("US eggs recalled");
    expect(warningLinks(html)).toHaveLength(2);
    expect(list(html).indexOf(">Milk chocolate<")).toBeLessThan(list(html).indexOf("Bread recall"));
    expect(html).toContain('aria-label="Filter by category"');
    expect(html).toContain('href="/?region=UK&amp;category=Bakery+%26+grains"');
    // Categories with no recalls are hidden.
    expect(html).not.toContain('href="/?region=UK&amp;category=Supplements"');
  });

  it("matches search words separately and combines them with category and retailer", async () => {
    const html = await render({ q: "Waitrose chocolate", category: "Snacks & sweets", store: "Waitrose" });
    expect(warningLinks(html)).toEqual(['href="/incidents/chocolate"']);
    expect(list(html)).not.toContain("Bread recall");
  });

  it("leads with this month's newest food-poisoning recall as the top alert", async () => {
    const html = await render();
    const top = html.slice(0, html.indexOf('id="warnings"'));
    expect(top).toContain("Top alert · Listeria");
    expect(top).toContain('href="/incidents/bread?returnTo=');
    expect(top).toContain("2 days ago");
  });

  it("shows each recall's date and how long ago it was", async () => {
    vi.setSystemTime(new Date("2026-10-14T12:00:00Z"));
    const html = await render();
    expect(html).toContain("7 Oct 2026");
    expect(html).toContain("1 week ago");
  });

  it("tags each warning with a plain hazard and filters by hazard group", async () => {
    const all = await render();
    expect(all).toContain("Listeria");
    expect(all).toContain("Milk");
    const html = await render({ hazard: "pathogen" });
    expect(warningLinks(html)).toEqual(['href="/incidents/bread"']);
  });

  it("finds warnings by allergen or shop name", async () => {
    expect(warningLinks(await render({ q: "listeria" }))).toEqual(['href="/incidents/bread"']);
    expect(warningLinks(await render({ q: "tesco" }))).toEqual(['href="/incidents/bread"']);
  });

  it("does not claim an empty dataset when the warning query failed", async () => {
    listWarnings.mockRejectedValue(new Error("Deployment unavailable"));
    const html = await render();
    expect(html).toContain("Warnings are temporarily unavailable.");
    expect(html).not.toContain("No current warnings match");
    expect(html).toContain("https://alerts.food.gov.uk/");
  });

  it("keeps official warnings visible and explains when news fails", async () => {
    getNews.mockRejectedValue(new Error("Feed unavailable"));
    expect(await render()).toContain(">Milk chocolate<");
    const news = renderToStaticMarkup(await RegionalNews({ region: "UK" }));
    expect(news).toContain("News is temporarily unavailable.");
    expect(news).not.toContain("No recent reporting found");
  });

  it("distinguishes an empty regional feed from an unavailable feed", async () => {
    const news = renderToStaticMarkup(await RegionalNews({ region: "UK" }));
    expect(news).toContain("No recent reporting found for this selection.");
    expect(news).not.toContain("temporarily unavailable");
  });

  it("shows available regional headlines and explains a partial publisher failure", async () => {
    const article = { title: "UK milk recalled", url: "https://www.bbc.co.uk/news/milk", publisher: "BBC News", publishedAt: "2026-10-07T12:00:00Z", topics: ["milk"] };
    getNews.mockResolvedValue({ articles: [{ ...article, regions: ["UK"] }, { ...article, title: "US eggs recalled", url: "https://www.cbsnews.com/eggs", regions: ["US"] }], unavailable: true });
    const news = renderToStaticMarkup(await RegionalNews({ region: "UK" }));
    expect(news).toContain("UK milk recalled");
    expect(news).not.toContain("US eggs recalled");
    expect(news).toContain("Some publisher feeds are temporarily unavailable.");
  });

  it("renders warnings without waiting for a stalled publisher", async () => {
    getNews.mockImplementation(() => new Promise(() => {}));
    const html = await render();
    expect(html).toContain(">Milk chocolate<");
    expect(html).toContain("Loading news…");
    expect(listWarnings).toHaveBeenCalledWith("UK");
  });

  it("restores a deeper list from the page parameter and links to the next step", async () => {
    listWarnings.mockResolvedValue(Array.from({ length: 125 }, (_, index) => ({
      ...rows[0], id: String(index), slug: `recall-${index}`, title: `Waitrose chocolate recall ${index}`,
    })));
    const html = await render({ q: "chocolate", category: "Snacks & sweets", store: "Waitrose", page: "2" });
    expect(warningLinks(html)).toHaveLength(80);
    expect(html).toContain("Showing 80 of 125");
    expect(html).toContain("Show 40 more");
    expect(html).toContain("region=UK&amp;q=chocolate&amp;category=Snacks+%26+sweets&amp;store=Waitrose&amp;page=3");
  });

  it("falls back to the first step for invalid page numbers", async () => {
    listWarnings.mockResolvedValue(Array.from({ length: 60 }, (_, index) => ({ ...rows[0], id: String(index), slug: `recall-${index}` })));
    expect(warningLinks(await render({ page: "-2" }))).toHaveLength(40);
    expect(warningLinks(await render({ page: "999999" }))).toHaveLength(40);
  });
});
