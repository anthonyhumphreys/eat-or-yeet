import { isDeepStrictEqual } from "node:util";

import { fetchFdaAnnouncementDetail, fetchFdaAnnouncementListings } from "./fda-announcements";

/** Read-only comparison shared by the local script and the admin-only Worker operation. */
export async function evaluateFdaFirecrawl(apiKey: string | undefined, limit: number) {
  if (!apiKey?.trim()) throw new Error("FIRECRAWL_API_KEY is required for Firecrawl evaluation");
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error("Evaluation limit must be from 1 to 10");
  const listings = await fetchFdaAnnouncementListings();
  if (!listings.length) throw new Error("FDA returned no announcement listings to evaluate");
  const results = [];
  for (const listing of listings.slice(0, limit)) {
    const startedAt = Date.now();
    const [direct, firecrawl] = await Promise.allSettled([
      fetchFdaAnnouncementDetail(listing, { mode: "direct" }),
      fetchFdaAnnouncementDetail(listing, { mode: "firecrawl", apiKey }),
    ]);
    const changedFields = direct.status === "fulfilled" && firecrawl.status === "fulfilled"
      ? Object.keys(direct.value).filter(key => !isDeepStrictEqual(
        direct.value[key as keyof typeof direct.value], firecrawl.value[key as keyof typeof firecrawl.value],
      )) : [];
    results.push({
      url: `https://www.fda.gov${listing.path}`,
      direct: direct.status,
      firecrawl: firecrawl.status,
      matches: direct.status === "fulfilled" && firecrawl.status === "fulfilled" && !changedFields.length,
      changedFields,
      elapsedMs: Date.now() - startedAt,
    });
  }
  return { listingCount: listings.length, evaluated: results.length, results };
}
