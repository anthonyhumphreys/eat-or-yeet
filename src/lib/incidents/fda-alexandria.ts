import { z } from "zod";

import { MAX_SOURCE_TEXT_BYTES, readResponseJson } from "@/lib/http/bounded-response";

export const FDA_ALEXANDRIA_LOOKUP_CREDITS = 5;
export const FDA_ALEXANDRIA_DAILY_CREDITS = 100;
const endpoint = "https://api.firecrawl.dev/v2/scrape";
const responseSchema = z.object({
  success: z.literal(true),
  warning: z.string().optional(),
  data: z.object({
    creditsCost: z.literal(FDA_ALEXANDRIA_LOOKUP_CREDITS),
    alexandria: z.array(z.object({
      provider: z.literal("fda-gov"),
      capability: z.literal("records/food_recalls"),
      creditsCost: z.literal(FDA_ALEXANDRIA_LOOKUP_CREDITS),
      records: z.literal(1),
      upstreamStatus: z.literal(200),
      error: z.unknown().optional(),
      warning: z.string().optional(),
      data: z.object({
        dataset: z.literal("food_recalls"),
        pagination_truncated: z.literal(false),
        total_matching: z.literal(1),
        skip: z.literal(0),
        next_skip: z.null(),
        source_url: z.string().url(),
        records: z.array(z.object({
          record_id: z.string(),
          source_url: z.string().url(),
          data: z.record(z.string(), z.unknown()),
        })).length(1),
      }),
    })).length(1),
  }),
});

function verifySource(value: string, recallNumber: string, limit: number) {
  const url = new URL(value);
  if (url.origin !== "https://api.fda.gov" || url.pathname !== "/food/enforcement.json"
    || url.username || url.password || url.hash
    || url.searchParams.get("search") !== `recall_number:"${recallNumber}"`
    || url.searchParams.get("skip") !== "0" || url.searchParams.get("limit") !== String(limit)
    || [...url.searchParams.keys()].some(key => !["search", "skip", "limit"].includes(key))) {
    throw new Error("Unverified FDA source");
  }
}

/** A single failed numbered-recall lookup only; never used for bulk collection. */
export async function fetchAlexandriaFdaRecall(recallNumber: string, apiKey: string | undefined): Promise<unknown> {
  if (!/^[A-Za-z0-9-]{1,100}$/.test(recallNumber)) throw new Error("FDA fallback requires a valid recall number");
  const key = apiKey?.trim();
  if (!key) throw new Error("FIRECRAWL_API_KEY is required for FDA Alexandria fallback");
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "x-request-id": crypto.randomUUID() },
      body: JSON.stringify({ alexandria: { provider: "fda-gov", capability: "records/food_recalls", options: { record_id: recallNumber, limit: 2 } } }),
      signal: AbortSignal.timeout(35_000),
      redirect: "manual",
      cache: "no-store",
    });
  } catch {
    throw new Error("FDA Alexandria fallback request failed; check connectivity and credentials");
  }
  if (response.status !== 200) {
    await response.body?.cancel();
    throw new Error(`FDA Alexandria fallback returned HTTP ${response.status}`);
  }
  try {
    const payload = responseSchema.parse(await readResponseJson(response, MAX_SOURCE_TEXT_BYTES));
    const result = payload.data.alexandria[0];
    const record = result.data.records[0];
    if (payload.warning || result.warning || result.error !== undefined
      || record.record_id !== recallNumber || record.data.recall_number !== recallNumber) throw new Error("Unverified record");
    verifySource(result.data.source_url, recallNumber, 2);
    verifySource(record.source_url, recallNumber, 1);
    return record.data;
  } catch {
    // Never copy vendor bodies, errors, or schema diagnostics into ingestion logs.
    throw new Error("FDA Alexandria fallback returned an invalid, incomplete or mismatched response");
  }
}
