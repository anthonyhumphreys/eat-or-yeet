import { NewsTicker } from "@/components/news/news-ticker";
import { getFoodSafetyNews } from "@/lib/news/feed";
import type { WarningRegion } from "@/lib/location";

export async function SiteNews({ region }: { region: WarningRegion }) {
  return <NewsTicker feed={await getFoodSafetyNews()} initialRegion={region} />;
}
