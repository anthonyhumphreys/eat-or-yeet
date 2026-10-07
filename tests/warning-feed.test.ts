import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { listWarnings, getNews } = vi.hoisted(() => ({ listWarnings: vi.fn(), getNews: vi.fn() }));
vi.mock("@/db/queries", () => ({ listActivePublicIncidents: listWarnings }));
vi.mock("@/lib/news/feed", () => ({ getFoodSafetyNews: getNews }));

import { WarningFeed } from "@/components/incidents/warning-feed";
import { RegionalNews } from "@/components/news/regional-news";

const rows = [
  { id: "1", slug: "chocolate", title: "Waitrose recalls milk chocolate", summary: "An affected batch", region: "UK", authority: "Food Standards Agency", categories: ["Snacks & sweets", "Dairy & eggs"], stores: ["Waitrose"], updatedAt: new Date("2026-10-07T12:00:00Z") },
  { id: "2", slug: "bread", title: "Bread recall", summary: "Check the batch", region: "UK", authority: "Food Standards Agency", categories: ["Bakery & grains"], stores: ["Tesco"], updatedAt: new Date("2026-10-06T12:00:00Z") },
  { id: "3", slug: "us-eggs", title: "US eggs recalled", summary: "Salmonella", region: "US", authority: "FDA", categories: ["Dairy & eggs"], stores: [], updatedAt: new Date("2026-10-05T12:00:00Z") },
];

beforeEach(() => {
  listWarnings.mockResolvedValue(rows);
  getNews.mockResolvedValue({ articles: [], unavailable: false });
});

async function render(params = {}, region: "UK" | "US" = "UK") {
  const content = await WarningFeed({ params, region, path: "/" });
  return renderToStaticMarkup(createElement("div", null, content));
}

describe("warnings landing feed", () => {
  it("scopes warnings by region and lists a multi-category notice once", async () => {
    const html = await render();
    expect(html).not.toContain("US eggs recalled");
    expect(html.match(/<article/g)).toHaveLength(2);
    expect(html.indexOf("Waitrose recalls milk chocolate")).toBeLessThan(html.indexOf("Bread recall"));
    expect(html).toContain('label="Fresh &amp; chilled"');
    expect(html).toContain('label="Cupboard &amp; snacks"');
  });

  it("matches search words separately and combines them with category and retailer", async () => {
    const html = await render({ q: "Waitrose chocolate", category: "Snacks & sweets", store: "Waitrose" });
    expect(html.match(/<article/g)).toHaveLength(1);
    expect(html).toContain("Waitrose recalls milk chocolate");
    expect(html).not.toContain("Bread recall");
  });

  it("does not claim an empty dataset when the warning query failed", async () => {
    listWarnings.mockRejectedValue(new Error("Deployment unavailable"));
    const html = await render();
    expect(html).toContain("Warnings are temporarily unavailable.");
    expect(html).not.toContain("No current warnings match");
    expect(html).toContain("https://alerts.food.gov.uk/");
  });

  it("keeps official warnings visible when news fails", async () => {
    getNews.mockRejectedValue(new Error("Feed unavailable"));
    expect(await render()).toContain("Waitrose recalls milk chocolate");
    const news = await RegionalNews({ region: "UK" });
    expect(renderToStaticMarkup(news)).toContain("News is temporarily unavailable");
  });

  it("renders warnings without waiting for a stalled publisher", async () => {
    getNews.mockImplementation(() => new Promise(() => {}));
    expect(await render()).toContain("Waitrose recalls milk chocolate");
    expect(listWarnings).toHaveBeenCalledWith("UK");
  });

  it("paginates after filtering and preserves the filters in page links", async () => {
    listWarnings.mockResolvedValue(Array.from({ length: 125 }, (_, index) => ({
      ...rows[0], id: String(index), slug: `recall-${index}`, title: `Waitrose chocolate recall ${index}`,
    })));
    const html = await render({ q: "chocolate", category: "Snacks & sweets", store: "Waitrose", page: "2" });
    expect(html.match(/<article/g)).toHaveLength(50);
    expect(html).toContain("Showing 51–100 of 125 warnings");
    expect(html).toContain("recall-50");
    expect(html).not.toContain('href="/incidents/recall-0"');
    expect(html).toContain("region=UK&amp;category=Snacks+%26+sweets&amp;store=Waitrose&amp;q=chocolate&amp;page=3#warnings");
  });

  it("clamps invalid and out-of-range page numbers without losing warnings", async () => {
    listWarnings.mockResolvedValue(Array.from({ length: 60 }, (_, index) => ({ ...rows[0], id: String(index), slug: `recall-${index}` })));
    expect((await render({ page: "-2" })).match(/<article/g)).toHaveLength(50);
    expect((await render({ page: "999999" })).match(/<article/g)).toHaveLength(10);
  });
});
