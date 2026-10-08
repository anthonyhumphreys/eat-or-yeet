import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { listWarnings, getNews } = vi.hoisted(() => ({ listWarnings: vi.fn(), getNews: vi.fn() }));
vi.mock("@/db/queries", () => ({ listActivePublicIncidents: listWarnings }));
vi.mock("@/lib/news/feed", () => ({ getFoodSafetyNews: getNews }));

import { WarningFeed } from "@/components/incidents/warning-feed";
import { RegionalNews } from "@/components/news/regional-news";

const rows = [
  { id: "1", slug: "chocolate", title: "Waitrose recalls milk chocolate", summary: "An affected batch", hazard: "Undeclared milk", pathogen: null, region: "UK", authority: "Food Standards Agency", categories: ["Snacks & sweets", "Dairy & eggs"], stores: ["Waitrose"], updatedAt: new Date("2026-10-07T12:00:00Z") },
  { id: "2", slug: "bread", title: "Bread recall", summary: "Check the batch", hazard: "Contamination of product with Listeria monocytogenes", pathogen: "Listeria monocytogenes", region: "UK", authority: "Food Standards Agency", categories: ["Bakery & grains"], stores: ["Tesco"], updatedAt: new Date("2026-10-06T12:00:00Z") },
  { id: "3", slug: "us-eggs", title: "US eggs recalled", summary: "Salmonella", hazard: "Salmonella", pathogen: "Salmonella", region: "US", authority: "FDA", categories: ["Dairy & eggs"], stores: [], updatedAt: new Date("2026-10-05T12:00:00Z") },
];

const warningLinks = (html: string) => html.match(/href="\/incidents\/[^"]+"/g) ?? [];

beforeEach(() => {
  listWarnings.mockResolvedValue(rows);
  getNews.mockResolvedValue({ articles: [], unavailable: false });
});

async function render(params = {}, region: "UK" | "US" = "UK") {
  const content = await WarningFeed({ params, region, path: "/" });
  return renderToStaticMarkup(createElement("div", null, content));
}

describe("warnings landing feed", () => {
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
    expect(html.indexOf("Waitrose recalls milk chocolate")).toBeLessThan(html.indexOf("Bread recall"));
    expect(html).toContain('label="Fresh &amp; chilled"');
    expect(html).toContain('label="Cupboard &amp; snacks"');
  });

  it("matches search words separately and combines them with category and retailer", async () => {
    const html = await render({ q: "Waitrose chocolate", category: "Snacks & sweets", store: "Waitrose" });
    expect(warningLinks(html)).toEqual(['href="/incidents/chocolate"']);
    expect(html).not.toContain("Bread recall");
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

  it("keeps official warnings visible and hides the news panel when news fails", async () => {
    getNews.mockRejectedValue(new Error("Feed unavailable"));
    expect(await render()).toContain("Waitrose recalls milk chocolate");
    expect(await RegionalNews({ region: "UK" })).toBeNull();
  });

  it("renders warnings without waiting for a stalled publisher", async () => {
    getNews.mockImplementation(() => new Promise(() => {}));
    expect(await render()).toContain("Waitrose recalls milk chocolate");
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
