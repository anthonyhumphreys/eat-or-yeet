import type { WarningRegion } from "@/lib/location";

export type NewsArticle = {
  title: string;
  url: string;
  publisher: string;
  publishedAt: string;
  regions: WarningRegion[];
  topics: string[];
};

export type NewsFeed = { articles: NewsArticle[]; unavailable: boolean };
