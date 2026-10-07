import { NewsList } from "@/components/news/news-list";
import type { WarningRegion } from "@/lib/location";
import { getFoodSafetyNews } from "@/lib/news/feed";
import { newsForRegion } from "@/lib/news/related";

export async function RegionalNews({ region }: { region: WarningRegion }) {
  const feed = await getFoodSafetyNews().catch(() => ({ articles: [], unavailable: true }));
  return <NewsList articles={newsForRegion(feed.articles, region).slice(0, 5)} unavailable={feed.unavailable} />;
}
