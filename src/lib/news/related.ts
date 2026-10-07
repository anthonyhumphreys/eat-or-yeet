import type { WarningRegion } from "@/lib/location";
import type { NewsArticle } from "./types";

export function newsForRegion(articles: NewsArticle[], region: WarningRegion) {
  return articles.filter((article) => article.regions.includes(region));
}

export function relatedNews(articles: NewsArticle[], incident: { title: string; region: WarningRegion; pathogen: string | null; hazard: string | null }) {
  const subject = `${incident.title} ${incident.pathogen ?? ""} ${incident.hazard ?? ""}`.toLowerCase();
  return newsForRegion(articles, incident.region).filter((article) => article.topics.some((topic) => subject.includes(topic))).slice(0, 3);
}
