import nextEnv from "@next/env";

import { evaluateFdaFirecrawl } from "../src/lib/incidents/firecrawl-evaluation";

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
  const report = await evaluateFdaFirecrawl(apiKey, limit);
  console.log(JSON.stringify(report, null, 2));
  if (report.results.some(result => !result.matches)) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Firecrawl evaluation failed");
  process.exitCode = 1;
});
