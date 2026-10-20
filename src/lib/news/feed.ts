import "server-only";

import { cache } from "react";
import { unstable_cache } from "next/cache";

import { readResponseText } from "@/lib/http/bounded-response";
import { MAX_NEWS_AGE_MS, newsSources, parseNewsRss, type NewsSource } from "./rss";
import type { NewsFeed } from "./types";

// Cache validated articles per publisher. Throwing on a failed refresh lets Next.js
// keep that publisher's last successful result instead of caching an empty feed.
const loadNewsSource = unstable_cache(async (source: NewsSource) => {
  const response = await fetch(source.url, {
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
    headers: { Accept: "application/rss+xml, application/xml, text/xml" },
  });
  if (!response.ok) throw new Error(`${source.publisher} news feed returned ${response.status}`);
  return parseNewsRss(await readResponseText(response, 1024 * 1024), source);
}, ["food-safety-news-source-v1"], { revalidate: 1800 });

export const getFoodSafetyNews = cache(async (): Promise<NewsFeed> => {
  const results = await Promise.allSettled(newsSources.map((source) => loadNewsSource(source)));
  const unique = new Map<string, NewsFeed["articles"][number]>();
  const oldest = Date.now() - MAX_NEWS_AGE_MS;
  for (const result of results) {
    if (result.status === "fulfilled") {
      for (const article of result.value) {
        // A retained feed must still respect the age limit during a long outage.
        if (Date.parse(article.publishedAt) >= oldest) unique.set(article.url, article);
      }
    }
  }
  return {
    articles: [...unique.values()].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)),
    unavailable: results.some((result) => result.status === "rejected"),
  };
});
