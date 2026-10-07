import "server-only";

import { cache } from "react";

import { readResponseText } from "@/lib/http/bounded-response";
import { newsSources, parseNewsRss } from "./rss";
import type { NewsFeed } from "./types";

export const getFoodSafetyNews = cache(async (): Promise<NewsFeed> => {
  const results = await Promise.allSettled(newsSources.map(async (source) => {
    const response = await fetch(source.url, {
      next: { revalidate: 1800 },
      signal: AbortSignal.timeout(5_000),
      headers: { Accept: "application/rss+xml, application/xml, text/xml" },
    });
    if (!response.ok) throw new Error(`News feed returned ${response.status}`);
    return parseNewsRss(await readResponseText(response, 1024 * 1024), source);
  }));
  const unique = new Map<string, NewsFeed["articles"][number]>();
  for (const result of results) {
    if (result.status === "fulfilled") for (const article of result.value) unique.set(article.url, article);
  }
  return {
    articles: [...unique.values()].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)),
    unavailable: results.some((result) => result.status === "rejected"),
  };
});
