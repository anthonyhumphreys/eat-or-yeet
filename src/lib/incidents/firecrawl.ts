import { z } from "zod";

import { MAX_SOURCE_TEXT_BYTES, readResponseJson } from "@/lib/http/bounded-response";

const SCRAPE_ENDPOINT = "https://api.firecrawl.dev/v2/scrape";
const FDA_ANNOUNCEMENTS_PATH = "/safety/recalls-market-withdrawals-safety-alerts/";
const scrapeSchema = z.object({
  success: z.literal(true),
  warning: z.string().optional(),
  data: z.object({
    rawHtml: z.string().trim().min(1).max(MAX_SOURCE_TEXT_BYTES),
    warning: z.string().optional(),
    metadata: z.object({
      statusCode: z.number().int().min(200).max(299),
      sourceURL: z.string().url(),
      url: z.string().url().optional(),
      error: z.string().optional(),
    }),
  }),
});

function announcementUrl(value: string): URL {
  const url = new URL(value);
  if (url.origin !== "https://www.fda.gov" || url.username || url.password
    || !url.pathname.startsWith(FDA_ANNOUNCEMENTS_PATH) || url.pathname === FDA_ANNOUNCEMENTS_PATH
    || url.search || url.hash) {
    throw new Error("Firecrawl retrieval requires a canonical FDA announcement URL");
  }
  return url;
}

/** Retrieve source HTML only. The existing FDA parser remains responsible for recall data. */
export async function fetchFirecrawlFdaHtml(value: string, apiKey: string | undefined): Promise<string> {
  const url = announcementUrl(value);
  const key = apiKey?.trim();
  if (!key) throw new Error("FIRECRAWL_API_KEY is required for Firecrawl FDA detail retrieval");

  let response: Response;
  try {
    response = await fetch(SCRAPE_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        url: url.href,
        formats: ["rawHtml"],
        onlyMainContent: false,
        maxAge: 0,
        timeout: 30_000,
        location: { country: "US", languages: ["en-US"] },
      }),
      signal: AbortSignal.timeout(35_000),
      cache: "no-store",
      redirect: "error",
    });
  } catch {
    // Transport errors and vendor response bodies can contain credentials.
    throw new Error("Firecrawl FDA detail request failed; check connectivity and credentials");
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Firecrawl FDA detail request returned HTTP ${response.status}`);
  }

  let payload: z.infer<typeof scrapeSchema>;
  try {
    payload = scrapeSchema.parse(await readResponseJson(response, 4 * MAX_SOURCE_TEXT_BYTES));
    const metadata = payload.data.metadata;
    if (payload.warning || payload.data.warning || metadata.error
      || announcementUrl(metadata.sourceURL).href !== url.href
      || (metadata.url && announcementUrl(metadata.url).href !== url.href)
      || new TextEncoder().encode(payload.data.rawHtml).byteLength > MAX_SOURCE_TEXT_BYTES) {
      throw new Error("Unverified scrape");
    }
  } catch {
    throw new Error("Firecrawl returned an invalid, incomplete or oversized FDA detail response");
  }
  return payload.data.rawHtml;
}
