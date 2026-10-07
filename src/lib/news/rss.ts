import { XMLParser, XMLValidator } from "fast-xml-parser";
import { z } from "zod";

import { sourceHtmlToText } from "@/lib/incidents/source-text";
import type { WarningRegion } from "@/lib/location";
import type { NewsArticle } from "./types";

export type NewsSource = { publisher: string; url: string; hosts: string[]; regions: WarningRegion[]; foodOnly?: boolean };

export const newsSources: NewsSource[] = [
  { publisher: "BBC News", url: "https://feeds.bbci.co.uk/news/health/rss.xml", hosts: ["www.bbc.co.uk", "www.bbc.com", "bbc.com"], regions: ["UK"] },
  { publisher: "CBS News", url: "https://www.cbsnews.com/latest/rss/health", hosts: ["www.cbsnews.com"], regions: ["US"] },
  { publisher: "The Guardian", url: "https://www.theguardian.com/world/food-safety/rss", hosts: ["www.theguardian.com"], regions: ["UK", "US"], foodOnly: true },
];

const foodHazard = /\b(?:food[ -](?:safety|poisoning|borne)|salmonella|listeria|cyclospora|cyclosporiasis|e\.? coli|botulism)\b/i;
const recall = /\brecall(?:s|ed)?\b/i;
const foodProduct = /\b(?:foods?|milk|cheese|eggs?|lettuce|salad|meat|chicken|chocolate|drinks?|formula|gatorade|bread|fruits?|sprouts?|pasta|sauce|beef|pork|turkey|juice|berry|berries|yogurt|yoghurt|peanuts?)\b/i;

const topicNames = ["salmonella", "listeria", "cyclospora", "botulism", "eggs", "milk", "cheese", "lettuce", "chicken", "chocolate", "formula", "gatorade", "bread", "sprouts", "pasta", "beef", "peanut", "allergen"];
const itemSchema = z.object({ title: z.string(), link: z.string(), pubDate: z.string(), description: z.string().optional() });
const feedSchema = z.object({ rss: z.object({ channel: z.object({ item: z.array(z.unknown()).default([]) }) }) });

export function parseNewsRss(xml: string, source: NewsSource, now = Date.now()): NewsArticle[] {
  // Publisher feeds never need DTDs; reject them before an XML parser sees entity declarations.
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new Error("Invalid news RSS");
  const parser = new XMLParser({ parseTagValue: false, maxNestedTags: 32, isArray: (name) => name === "item" });
  const parsed: unknown = parser.parse(xml);
  const feed = feedSchema.parse(parsed);
  return feed.rss.channel.item.slice(0, 100).flatMap((raw): NewsArticle[] => {
    const item = itemSchema.safeParse(raw);
    if (!item.success) return [];
    const title = sourceHtmlToText(item.data.title).slice(0, 240);
    const text = `${title} ${sourceHtmlToText(item.data.description ?? "").slice(0, 2_000)}`;
    if (!title || (!source.foodOnly && !(foodHazard.test(text) || (recall.test(text) && foodProduct.test(text))))) return [];
    const publishedAt = Date.parse(item.data.pubDate);
    if (!Number.isFinite(publishedAt) || publishedAt > now + 5 * 60 * 1_000 || publishedAt < now - 180 * 24 * 60 * 60 * 1_000) return [];
    let url: URL;
    try { url = new URL(item.data.link); } catch { return []; }
    if (url.protocol !== "https:" || url.username || url.password || url.port || !source.hosts.includes(url.hostname)) return [];
    for (const key of [...url.searchParams.keys()]) if (/^(?:utm_|at_)/.test(key)) url.searchParams.delete(key);
    url.hash = "";
    let regions = source.regions;
    if (source.publisher === "The Guardian") {
      if (url.pathname.startsWith("/us-news/") || /\b(?:US|U\.S\.|FDA|USDA|CDC|American|United States)\b/.test(title)) regions = ["US"];
      else if (url.pathname.startsWith("/uk-news/") || /\b(?:UK|Britain|British|England|Scotland|Wales|Northern Ireland|FSA)\b/.test(title)) regions = ["UK"];
    }
    return [{ title, url: url.href, publisher: source.publisher, publishedAt: new Date(publishedAt).toISOString(), regions, topics: topicNames.filter((topic) => text.toLowerCase().includes(topic)) }];
  });
}
