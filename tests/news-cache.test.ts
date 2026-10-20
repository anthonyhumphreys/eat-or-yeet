import "next/dist/server/node-environment";

import { workAsyncStorage, type WorkStore } from "next/dist/server/app-render/work-async-storage.external";
import type { IncrementalCache } from "next/dist/server/lib/incremental-cache";
import type { CachedFetchValue } from "next/dist/server/response-cache";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getFoodSafetyNews } from "@/lib/news/feed";
import { MAX_NEWS_AGE_MS, newsSources } from "@/lib/news/rss";

const now = Date.parse("2026-10-20T12:00:00Z");
const entries = new Map<string, { value: CachedFetchValue; writtenAt: number }>();

// Exercise Next.js's real cache and revalidation logic with an in-memory store.
const incrementalCache = {
  generateSimpleCacheKey: async (key: string) => key,
  get: async (key: string) => {
    const entry = entries.get(key);
    return entry ? { value: entry.value, isStale: Date.now() >= entry.writtenAt + entry.value.revalidate * 1_000 } : null;
  },
  set: async (key: string, value: CachedFetchValue) => {
    entries.set(key, { value, writtenAt: Date.now() });
  },
} as unknown as IncrementalCache;

async function readFeed() {
  const store = { incrementalCache, pendingRevalidates: {} } as WorkStore;
  const feed = await workAsyncStorage.run(store, getFoodSafetyNews);
  await Promise.all(Object.values(store.pendingRevalidates ?? {}));
  return feed;
}

function publisherFeed(url: string, headline = "Milk recalled", publishedAt = now) {
  const source = newsSources.find((source) => source.url === url)!;
  return new Response(`<rss><channel><item><title>${headline}</title><link>https://${source.hosts[0]}/recall</link><pubDate>${new Date(publishedAt).toUTCString()}</pubDate></item></channel></rss>`);
}

beforeEach(() => {
  entries.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("publisher news cache", () => {
  it.each(["timeout", "HTTP error", "malformed XML"])("retains a publisher's headlines after a refresh fails with %s", async (failure) => {
    const fetch = vi.fn(async (url: string) => publisherFeed(url));
    vi.stubGlobal("fetch", fetch);
    expect((await readFeed()).articles).toHaveLength(3);

    vi.setSystemTime(now + 1_801_000);
    fetch.mockImplementation(async (url: string) => {
      if (url !== newsSources[0].url) return publisherFeed(url, "Cheese recalled", Date.now());
      if (failure === "timeout") throw new DOMException("Publisher timed out", "TimeoutError");
      if (failure === "HTTP error") return new Response("Unavailable", { status: 503 });
      return new Response("<rss><channel>");
    });
    await readFeed();

    const feed = await readFeed();
    expect(feed.articles.map((article) => [article.publisher, article.title])).toEqual([
      ["CBS News", "Cheese recalled"],
      ["The Guardian", "Cheese recalled"],
      ["BBC News", "Milk recalled"],
    ]);
  });

  it("retries a cold failed publisher on the next request instead of caching its failure", async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url === newsSources[0].url) throw new Error("Offline");
      return publisherFeed(url);
    });
    vi.stubGlobal("fetch", fetch);
    const partial = await readFeed();
    expect(partial.unavailable).toBe(true);
    expect(partial.articles).toHaveLength(2);

    fetch.mockImplementation(async (url: string) => publisherFeed(url));
    const feed = await readFeed();
    expect(feed.unavailable).toBe(false);
    expect(feed.articles).toHaveLength(3);
    expect(fetch.mock.calls.filter(([url]) => url !== newsSources[0].url)).toHaveLength(2);
  });

  it("keeps the last headlines when every publisher fails to refresh", async () => {
    const fetch = vi.fn(async (url: string) => publisherFeed(url));
    vi.stubGlobal("fetch", fetch);
    const original = await readFeed();

    vi.setSystemTime(now + 1_801_000);
    fetch.mockRejectedValue(new Error("Offline"));
    expect((await readFeed()).articles).toEqual(original.articles);
    expect((await readFeed()).articles).toEqual(original.articles);
  });

  it("does not retain expired stories through a prolonged publisher outage", async () => {
    const fetch = vi.fn(async (url: string) => publisherFeed(url, "Milk recalled", now - MAX_NEWS_AGE_MS + 60_000));
    vi.stubGlobal("fetch", fetch);
    expect((await readFeed()).articles).toHaveLength(3);

    vi.setSystemTime(now + 1_801_000);
    fetch.mockRejectedValue(new Error("Offline"));
    expect((await readFeed()).articles).toEqual([]);
    expect((await readFeed()).articles).toEqual([]);
  });
});
