import { NewsList } from "@/components/news/news-list";
import type { WarningRegion } from "@/lib/location";
import { getFoodSafetyNews } from "@/lib/news/feed";
import { newsForRegion } from "@/lib/news/related";

// News is supplementary on the warning desk, so an empty or failed feed takes no space.
export async function RegionalNews({ region }: { region: WarningRegion }) {
  const feed = await getFoodSafetyNews().catch(() => ({ articles: [], unavailable: true }));
  const articles = newsForRegion(feed.articles, region).slice(0, 5);
  return articles.length ? <NewsList articles={articles} /> : null;
}
