import { afterEach, describe, expect, it, vi } from "vitest";

import { getFoodSafetyNews } from "@/lib/news/feed";
import { newsForRegion, relatedNews } from "@/lib/news/related";
import { newsSources, parseNewsRss } from "@/lib/news/rss";

const now = Date.parse("2026-10-07T12:00:00Z");
function item(title: string, link = "https://www.bbc.co.uk/news/articles/recall", date = "Tue, 06 Oct 2026 10:00:00 GMT") {
  return `<item><title><![CDATA[${title}]]></title><link>${link.replaceAll("&", "&amp;")}</link><pubDate>${date}</pubDate><description>Consumer news</description></item>`;
}
const rss = (...items: string[]) => `<rss version="2.0"><channel>${items.join("")}</channel></rss>`;

afterEach(() => vi.unstubAllGlobals());

describe("food safety news", () => {
  it("reads RSS CDATA, decodes text, removes tracking, and excludes unrelated health stories", () => {
    const articles = parseNewsRss(rss(item("Milk & cheese recalled", "https://www.bbc.co.uk/news/articles/recall?at_medium=RSS"), item("Exercise improves sleep")), newsSources[0], now);
    expect(articles).toHaveLength(1);
    expect(articles[0]).toMatchObject({ title: "Milk & cheese recalled", url: "https://www.bbc.co.uk/news/articles/recall", regions: ["UK"], publisher: "BBC News" });
  });

  it("rejects DTDs and malformed XML", () => {
    expect(() => parseNewsRss('<!DOCTYPE rss [<!ENTITY x "unsafe">]><rss/>', newsSources[0], now)).toThrow();
    expect(() => parseNewsRss("<rss><channel>", newsSources[0], now)).toThrow();
  });

  it("excludes untrusted URLs, missing dates, future stories, and old reports", () => {
    const articles = parseNewsRss(rss(
      item("Milk recalled", "https://www.bbc.co.uk.evil.example/news"),
      item("Milk recalled", "javascript:alert(1)"),
      item("Milk recalled", "https://www.bbc.co.uk/news/a", "garbage"),
      item("Milk recalled", "https://www.bbc.co.uk/news/b", "Tue, 06 Oct 2027 10:00:00 GMT"),
      item("Milk recalled", "https://www.bbc.co.uk/news/c", "Tue, 06 Oct 2024 10:00:00 GMT"),
    ), newsSources[0], now);
    expect(articles).toEqual([]);
  });

  it("scopes explicit US and UK Guardian stories and only relates news by food or hazard", () => {
    const articles = parseNewsRss(rss(
      item("US milk recall", "https://www.theguardian.com/us-news/2026/oct/06/milk"),
      item("UK salmonella outbreak", "https://www.theguardian.com/uk-news/2026/oct/06/eggs"),
    ), newsSources[2], now);
    expect(newsForRegion(articles, "UK")).toHaveLength(1);
    expect(relatedNews(articles, { title: "UK egg recall", region: "UK", pathogen: "Salmonella", hazard: null })).toEqual([articles[1]]);
    expect(relatedNews(articles, { title: "Bread recall", region: "UK", pathogen: null, hazard: null })).toEqual([]);
  });

  it("keeps the working feeds when a publisher fails and sorts headlines newest first", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("cbsnews")) throw new Error("Publisher unavailable");
      const guardian = url.includes("theguardian");
      return new Response(rss(item(guardian ? "Milk recalled in US" : "Eggs recalled", guardian ? "https://www.theguardian.com/us-news/2026/oct/07/milk" : "https://www.bbc.co.uk/news/articles/eggs", guardian ? new Date().toUTCString() : new Date(Date.now() - 86_400_000).toUTCString())));
    }));
    const feed = await getFoodSafetyNews();
    expect(feed.unavailable).toBe(true);
    expect(feed.articles.map((article) => article.publisher)).toEqual(["The Guardian", "BBC News"]);
  });

  it("reports total news failure without throwing into the warnings page", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Offline")));
    expect(await getFoodSafetyNews()).toEqual({ articles: [], unavailable: true });
  });
});
