import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const { getNews, getIncident } = vi.hoisted(() => ({ getNews: vi.fn(), getIncident: vi.fn() }));
vi.mock("@/lib/news/feed", () => ({ getFoodSafetyNews: getNews }));
vi.mock("@/db/queries", () => ({ getIncidentBySlug: getIncident }));

import IncidentPage from "@/app/incidents/[slug]/page";
import { RecallNews } from "@/components/news/recall-news";

const incident = {
  title: "Fixture milk recall", slug: "fixture-milk", region: "UK" as const, status: "active", superCategories: ["Food"],
  hazard: "Undeclared milk", pathogen: null, summary: "Check the affected product", consumerAdvice: "Return the affected pack to the shop.",
  authority: "Food Standards Agency", authorityUrl: "https://alerts.food.gov.uk/", sourceId: "FSA-PRIN-1-2026",
  publishedAt: new Date("2026-10-01"), updatedAt: new Date("2026-10-01"), targets: [],
};
const article = { title: "Milk recall reported", url: "https://www.bbc.co.uk/news/fixture", publisher: "BBC News", publishedAt: "2026-10-01T12:00:00Z", regions: ["UK" as const], topics: ["milk"] };

afterEach(() => { vi.clearAllMocks(); });

describe("recall detail news streaming", () => {
  it("returns the recall shell while news is still pending", async () => {
    let release!: (value: { articles: never[]; unavailable: boolean }) => void;
    getNews.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    getIncident.mockResolvedValue(incident);
    try {
      const page = await IncidentPage({ params: Promise.resolve({ slug: incident.slug }) });
      const html = renderToStaticMarkup(page);
      expect(html).toContain(incident.consumerAdvice);
      expect(html).toContain("Which products");
      expect(html).toContain("Read the official notice");
      expect(html).toContain("Loading related news");
      expect(html).toContain('role="status"');
    } finally { release({ articles: [], unavailable: false }); }
  });

  it("keeps related regional articles and partial-feed notices", async () => {
    getNews.mockResolvedValue({ articles: [article, { ...article, title: "US only", regions: ["US"] }, { ...article, title: "Unrelated news", topics: ["spinach"] }], unavailable: true });
    const html = renderToStaticMarkup(await RecallNews({ incident }));
    expect(html).toContain(article.title);
    expect(html).not.toContain("US only");
    expect(html).not.toContain("Unrelated news");
    expect(html).toContain("Some publisher feeds are temporarily unavailable.");
  });

  it("distinguishes empty news from unavailable news", async () => {
    getNews.mockResolvedValue({ articles: [], unavailable: false });
    expect(renderToStaticMarkup(await RecallNews({ incident }))).toContain("No news stories about this recall yet.");
    getNews.mockRejectedValue(new Error("Publisher unavailable"));
    const html = renderToStaticMarkup(await RecallNews({ incident }));
    expect(html).toContain("News is temporarily unavailable.");
    expect(html).not.toContain("No news stories about this recall yet.");
  });
});
