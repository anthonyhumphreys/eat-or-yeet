import { NewsList } from "@/components/news/news-list";
import type { WarningRegion } from "@/lib/location";
import { getFoodSafetyNews } from "@/lib/news/feed";
import { newsForRegion } from "@/lib/news/related";

export async function RegionalNews({ region, limit = 5 }: { region: WarningRegion; limit?: number }) {
  const feed = await getFoodSafetyNews().catch(() => ({ articles: [], unavailable: true }));
  const articles = newsForRegion(feed.articles, region).slice(0, limit);
  return <NewsList articles={articles} unavailable={feed.unavailable} />;
}
