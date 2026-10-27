import type { MatchableIncident } from "@/lib/domain/types";
import { getFoodSafetyNews } from "@/lib/news/feed";
import { relatedNews } from "@/lib/news/related";
import { NewsList } from "./news-list";

export async function RecallNews({ incident }: { incident: Pick<MatchableIncident, "title" | "region" | "pathogen" | "hazard"> }) {
  const news = await getFoodSafetyNews().catch(() => ({ articles: [], unavailable: true }));
  return <NewsList articles={relatedNews(news.articles, incident)} unavailable={news.unavailable} empty="No news stories about this recall yet." />;
}
