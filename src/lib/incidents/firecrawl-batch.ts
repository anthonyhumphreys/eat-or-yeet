import { z } from "zod";

import { readResponseJson } from "@/lib/http/bounded-response";
import { announcementUrl, parseFirecrawlFdaOriginal } from "./firecrawl";

const origin = "https://api.firecrawl.dev";
const prefix = "/v2/batch/scrape";
const idSchema = z.string().uuid();
const statusSchema = z.object({
  status: z.enum(["scraping", "completed", "failed", "cancelled"]),
  total: z.number().int().min(0).max(10_000), completed: z.number().int().min(0).max(10_000),
  next: z.string().url().nullish(), data: z.array(z.unknown()).max(10_000),
});

export class FirecrawlBatchRetry extends Error {
  constructor(readonly delayMs: number) { super("Firecrawl FDA batch temporarily unavailable"); }
}

async function request(path: string, apiKey: string | undefined, body?: unknown): Promise<unknown> {
  const key = apiKey?.trim();
  if (!key) throw new Error("FIRECRAWL_API_KEY is required for FDA batch retrieval");
  let response: Response;
  try {
    response = await fetch(origin + path, { method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}), redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(35_000) });
  } catch { throw new Error("Firecrawl FDA batch request failed"); }
  if (response.status !== 200) {
    await response.body?.cancel();
    if (response.status === 429 || (!body && response.status >= 500)) {
      const delay = Number(response.headers.get("retry-after"));
      throw new FirecrawlBatchRetry(Number.isFinite(delay) && delay > 0 ? Math.min(delay, 120) * 1000 : 30_000);
    }
    throw new Error(`Firecrawl FDA batch request returned HTTP ${response.status}`);
  }
  try { return await readResponseJson(response, 12 * 1024 * 1024); }
  catch { throw new Error("Firecrawl returned an invalid or oversized FDA batch response"); }
}

export async function startFirecrawlFdaBatch(urls: string[], apiKey: string | undefined): Promise<string> {
  if (!urls.length || urls.length > 10_000 || new Set(urls).size !== urls.length) throw new Error("FDA batch requires 1–10000 unique URLs");
  urls.forEach(announcementUrl);
  const payload = await request(prefix, apiKey, { urls, maxConcurrency: 2, ignoreInvalidURLs: false,
    formats: ["rawBase64"], onlyMainContent: false, maxAge: 0, timeout: 30_000, location: { country: "US", languages: ["en-US"] } });
  const parsed = z.object({ success: z.literal(true), id: idSchema, invalidURLs: z.array(z.string()).max(0).nullish() }).safeParse(payload);
  if (!parsed.success) throw new Error("Firecrawl returned an invalid FDA batch identifier");
  return parsed.data.id;
}

/** Normalise each bounded result page immediately rather than retaining the full HTML archive. */
export async function readFirecrawlFdaBatch<T>(id: string, urls: string[], apiKey: string | undefined, parse: (url: string, html: string) => T): Promise<T[] | null> {
  idSchema.parse(id);
  const base = `${prefix}/${id}`;
  let path = base;
  const expected = new Set(urls);
  const results = new Map<string, T>();
  const seen = new Set<string>();
  for (let page = 0; page < 256; page++) {
    if (seen.has(path)) throw new Error("Firecrawl FDA batch repeated a result page");
    seen.add(path);
    const parsed = statusSchema.safeParse(await request(path, apiKey));
    if (!parsed.success) throw new Error("Firecrawl returned invalid FDA batch progress");
    const payload = parsed.data;
    if (payload.status === "scraping") return null;
    if (payload.status !== "completed" || payload.total !== urls.length || payload.completed !== urls.length) throw new Error("Firecrawl FDA batch is incomplete");
    for (const data of payload.data) {
      const item = z.object({ metadata: z.object({ sourceURL: z.string().url() }) }).safeParse(data);
      const url = item.success ? item.data.metadata.sourceURL : "";
      if (!expected.has(url) || results.has(url)) throw new Error("Firecrawl FDA batch returned an unexpected or repeated notice");
      results.set(url, parse(url, parseFirecrawlFdaOriginal(url, { success: true, data })));
    }
    if (!payload.next) {
      if (results.size !== expected.size) throw new Error("Firecrawl FDA batch omitted a notice");
      return urls.map(url => results.get(url)!);
    }
    const next = new URL(payload.next);
    if (next.origin !== origin || next.pathname !== base || next.username || next.password || next.hash
      || !/^\d+$/.test(next.searchParams.get("skip") ?? "")
      || [...next.searchParams.keys()].some(key => key !== "skip")) throw new Error("Firecrawl FDA batch returned an invalid continuation URL");
    path = next.pathname + next.search;
  }
  throw new Error("Firecrawl FDA batch exceeded its result-page limit");
}
