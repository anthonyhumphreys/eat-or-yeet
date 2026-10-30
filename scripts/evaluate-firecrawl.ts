import { isDeepStrictEqual } from "node:util";
import nextEnv from "@next/env";

import { fetchFdaAnnouncementDetail, fetchFdaAnnouncementListings } from "../src/lib/incidents/fda-announcements";

async function main() {
  nextEnv.loadEnvConfig(process.cwd(), true);
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--limit" || !/^\d+$/.test(args[1]))) {
    throw new Error("Usage: pnpm data:evaluate:firecrawl [--limit 1-10]");
  }
  const limit = args.length ? Number(args[1]) : 3;
  if (limit < 1 || limit > 10) throw new Error("Choose a limit from 1 to 10; each page makes one paid Firecrawl request");
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey?.trim()) throw new Error("Set FIRECRAWL_API_KEY in the environment or .env.local before evaluating");

  // Read only: no backend calls, uploads, source-health updates or production writes.
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
  console.log(JSON.stringify({ listingCount: listings.length, evaluated: results.length, results }, null, 2));
  if (results.some(result => !result.matches)) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Firecrawl evaluation failed");
  process.exitCode = 1;
});
