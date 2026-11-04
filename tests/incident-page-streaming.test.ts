import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const { getIncident, getNews } = vi.hoisted(() => ({ getIncident: vi.fn(), getNews: vi.fn() }));
vi.mock("@/db/queries", () => ({ getIncidentBySlug: getIncident }));
vi.mock("@/lib/news/feed", () => ({ getFoodSafetyNews: getNews }));

import IncidentPage from "@/app/incidents/[slug]/page";

afterEach(() => vi.resetAllMocks());

describe("recall detail loading", () => {
  it("renders the official advice and affected products while publisher news is stalled", async () => {
    getNews.mockImplementation(() => new Promise(() => {}));
    getIncident.mockResolvedValue({
      id: "notice", slug: "milk-recall", title: "Milk recall", summary: "Affected bottles.", region: "UK", status: "active",
      hazard: "Listeria", pathogen: "Listeria", consumerAdvice: "Do not consume the affected bottles.",
      authority: "Food Standards Agency", authorityUrl: "https://alerts.food.gov.uk/alert/notice", sourceId: "notice",
      publishedAt: new Date("2026-10-01T12:00:00Z"), updatedAt: new Date("2026-10-01T12:00:00Z"),
      superCategories: ["Food"], targets: [],
    });

    // Awaiting publisher news in the page itself would block here and fail the test.
    const page = await IncidentPage({ params: Promise.resolve({ slug: "milk-recall" }), searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(page);
    expect(html).toContain("Do not consume the affected bottles.");
    expect(html).toContain("Which products");
    expect(html).toContain("Read the official notice");
    expect(html).toContain("Loading related news…");
  });
});
