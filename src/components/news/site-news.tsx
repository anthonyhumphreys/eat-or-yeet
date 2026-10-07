import { NewsTicker } from "@/components/news/news-ticker";
import { getFoodSafetyNews } from "@/lib/news/feed";

export async function SiteNews() {
  return <NewsTicker feed={await getFoodSafetyNews()} />;
}
