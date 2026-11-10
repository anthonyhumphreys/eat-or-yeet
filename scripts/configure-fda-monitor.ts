import nextEnv from "@next/env";
import { parseArgs } from "node:util";
import { z } from "zod";
import { fetchFdaAnnouncementListings } from "../src/lib/incidents/fda-announcements";
import { monitorRequest, monitorResponseSchema, monitorScrapeOptions, monitorTargets } from "../src/lib/incidents/firecrawl-monitor";

async function main() {
  nextEnv.loadEnvConfig(process.cwd());
  const { values } = parseArgs({ options: { "backend-url": { type: "string" }, schedule: { type: "string" }, "detail-limit": { type: "string", default: "5" }, apply: { type: "boolean", default: false } } });
  if (!values["backend-url"] || !values.schedule) throw new Error("Usage: configure-fda-monitor --backend-url https://worker.example --schedule 'every 6 hours' [--detail-limit 5] [--apply]");
  const backend = new URL(values["backend-url"]);
  if (backend.protocol !== "https:" || backend.username || backend.password || backend.search || backend.hash || backend.pathname !== "/") throw new Error("Use an HTTPS backend origin");
  const listings = (await fetchFdaAnnouncementListings()).sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
  const urls = monitorTargets(listings.map(item => `https://www.fda.gov${item.path}`), Number(values["detail-limit"]));
  const plan = { name: "Eat or Yeet FDA announcements", schedule: { text: values.schedule, timezone: "UTC" }, judgeEnabled: false, retentionDays: 7,
    targets: [{ type: "scrape", urls, scrapeOptions: monitorScrapeOptions }],
    webhook: { url: new URL("/webhooks/firecrawl/fda", backend).href, events: ["monitor.page", "monitor.check.completed"] } };
  console.log(JSON.stringify({ listingCount: listings.length, monitoredUrls: urls.length, baseCreditsPerCheck: urls.length, schedule: values.schedule, webhook: plan.webhook.url, apply: values.apply }, null, 2));
  if (!values.apply) return;
  // Never retry creation after an uncertain response: inspect the vendor dashboard.
  const result = monitorResponseSchema.parse(await monitorRequest("/monitor", process.env.FIRECRAWL_API_KEY, "POST", { ...plan, schedule: { text: "weekly", timezone: "UTC" } })).data;
  console.log(`Created monitor ${result.id}. Pausing it for bootstrap.`);
  const path = `/monitor/${z.string().uuid().parse(result.id)}`;
  await monitorRequest(path, process.env.FIRECRAWL_API_KEY, "PATCH", { status: "paused" });
  await monitorRequest(path, process.env.FIRECRAWL_API_KEY, "PATCH", { schedule: plan.schedule });
  console.log(`FDA_MONITOR_ID=${result.id}\nFDA_MONITOR_DETAIL_LIMIT=${values["detail-limit"]}\nMonitor is paused. Complete the documented Worker/uploader bootstrap before activation.`);
}
main().catch(() => { console.error("FDA monitor configuration failed. Inspect the dashboard before retrying --apply; a monitor may already exist."); process.exitCode = 1; });
