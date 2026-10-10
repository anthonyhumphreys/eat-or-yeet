# Keeping Convex usage small

The 9 October 2026 usage report showed about 759 MB of database storage and 2.95 GB of monthly database I/O across Eat or Yeet deployments. Production warning-list queries accounted for about 1.88 GB of that I/O. These are observed totals, not a forecast or a guaranteed saving.

## Storage and imports

The full `incidents` table retains official source payloads. Its only application lookup uses `by_authority_sourceId`. Four unused indexes were removed; at the measured 93.25 MB of documents across deployments, that avoids about 373 MB of indexed copies. Convex bills each index as another table copy. [Convex limits](https://docs.convex.dev/production/state/limits)

Matching and browsing still use `incidentMatchData`, which omits the original source payload. Its indexes serve current application queries. Warning records and matching targets are retained.

Imports compare incoming content with existing records and skip unchanged writes. `retrievedAt` and `sourceRunId` identify the last content update; the ingestion ledger records subsequent successful fetches, even when no notice changes. Projection repairs still run when needed. Every projection write increments the region's cache revision in the same mutation.

`incidentImportState` stores a small SHA-256 fingerprint and the IDs of each notice's archive and matching record. The fingerprint covers persisted source content, including the original payload, while ignoring fetch bookkeeping and object key order. A repeat import reads this state and checks the matching record against the current projection. When both match, it skips the larger archive read and performs no writes. Missing, changed or corrupt matching records still go through the repair path. State, notices, projections and cache revisions commit together.

The importer rereads an incoming notice's archive at least every seven days, even when its fingerprint matches. This checks stored content; official sources still refresh daily and the 48-hour health gate still applies on every scan. Notices outside a source's current feed window are retained but are not included in these periodic checks. State is populated during ordinary imports, so rollout needs no bulk migration.

The daily cron no longer scans all incident documents to repeat the matcher migration. For an older deployment with missing projections, run `incidents:backfillMatchDataInternal` once before enabling checks. New imports maintain their own projections.

## Caching and freshness

The existing Next.js persistent data cache stores individual browse and matcher pages, plus warning details. Keys include deployment URL, region or slug, demo mode where relevant, and dataset revision. A fresh, small version query selects the right entry on every request. New, changed and resolved warnings select new entries immediately, including writes from partial imports. Unchanged imports retain the revision.

Snapshots include notice start and expiry times. The app applies those boundaries on every request, outside the cache. Product checks also read source health on every request; a cached dataset never extends the 48-hour freshness gate or conceals a failed source fetch. Health failures still prevent a reassuring no-match result.

Pages are limited to 100 rows and a 512 KiB database-read budget. This keeps normal cache entries below the Next.js data cache's 2 MiB limit, rather than trying to cache an entire regional dataset in one item. The small worker cache remains bounded. No Redis service or additional paid cache is needed for this workload.

All warning mutations must use `bumpDatasetVersions`. Direct dashboard edits or imports that bypass application mutations need a revision bump before cached views are current. A new version row's document ID separates caches after a database restore or reset.

Maintenance writes to original notice records must also call `invalidateImportState` for the affected authority/source ID. The existing demo seed and legacy FDA repair do this. Direct dashboard edits must remove the corresponding import-state row; identity changes or record deletion also need matching-record reconciliation. Weekly checks can repair archive edits and relink deleted archives, but they are not a replacement for maintaining these invariants during manual changes.

The bounded worker cache also prepares matcher objects once per revision instead of allocating all notice and target objects on every scan. Start/expiry filtering still uses the current time on each request.

## Scan calls and temporary metadata

Anonymous and network rate-limit buckets now update in one authenticated, atomic Convex mutation. Their keys, hourly windows and limits are unchanged. A product-first lookup query returns either curated product data or valid cached barcode metadata. It only reads fallback metadata when the curated product is absent. A warm barcode scan therefore uses three Convex calls instead of five: rate limits, product lookup and source health/version. Cold metadata and warning-page cache misses need additional calls. Older endpoints remain available for in-flight deployments.

The existing daily temporary-data cleanup also removes expired barcode metadata in batches of 100, continuing until the expired backlog is gone. It retains live metadata and curated products. This bounds storage as the number of distinct scanned products grows.

Recalled-product categories use a separate `productCategoryCache` table that is never cleaned up, because browse labels should not flip when a cache row expires. Each import reads cached rows for its barcodes in batches of 200 and queues unseen barcodes. An hourly job (`products:lookupProductCategories`, at minute 41) checks up to 60 queued barcodes against Open Food Facts, one about every 1.1 seconds, newest notices first. That is well under Open Food Facts' product rate limit. Found categories are rechecked after 90 days, unknown barcodes after 30, and failed lookups the next day without losing the last answer. Categories found by the job reach the browse feed on the next daily import.

## Development and previews

Prefer the existing account-free local Convex setup for routine development and browser tests. Cloud development and preview imports consume the same team allowance as production. Keep a cloud preview only while it serves an active review, and avoid importing a full duplicate dataset for a connectivity probe. [Local development](https://docs.convex.dev/cli/local-deployments)

Set `SCHEDULED_SOURCE_REFRESH=false` on cloud development and inactive previews to avoid duplicate daily imports. This only disables the scheduled refresh; `incidents:refreshAllInternal` and individual source actions still work manually. An unset flag preserves daily refreshes in production. Development source health correctly becomes stale after 48 hours without a manual refresh. Set `PRODUCT_CATEGORY_LOOKUPS=false` there too, to stop the hourly Open Food Facts lookups.

Before retiring a preview, confirm its identity and that production uses a separate backend. Export a backup with `pnpm exec convex export --deployment NAME --path BACKUP.zip`. Keep backups private and outside version control; `.local-backups/` is ignored. Never remove production warning records to fit a quota.

## Verification

Use `pnpm exec convex deployment usage --prod --json` to inspect production counters and the team usage dashboard for storage. Monthly I/O already consumed cannot be undone. Compare subsequent daily usage after rollout; don't infer the long-term reduction from a single warm-cache request.

Useful regressions include cached pages across workers, revision changes after partial imports, source-health failures with warm caches, notice start/expiry boundaries, deployment/demo isolation, and retries after failed page loads. Verify hosted imports and a known warning as well as an identified unmatched barcode.

The 9 October rollout passed 183 unit tests, 42 browser tests, lint, type checking and a production build. A development USDA sync fetched 101 active notices and updated one changed record. Hosted production checks matched a known recalled barcode, returned no published warning match for Oreo with healthy US coverage, and loaded both regional warning lists. A warm sample of three Oreo checks plus three UK page loads added 18 calls and about 8.8 KB of reported database I/O. These immediate counters may lag or include concurrent traffic; the sample is evidence that warm requests avoid full dataset reads, not a monthly cost forecast.

The unused indexes were removed from production, cloud development and the retained `main` preview. Using the reported document sizes, projected database storage is about 386 MB after the reporting delay. The old preview was backed up privately; its data was retained. Confirm the eventual storage gauge before treating that projection as measured usage.

Scheduled imports were disabled on cloud development and the retained `main` preview. Production's flag remains unset, so the daily official-source cron continues. The independent daily NAS USDA sync is unchanged.

For the subsequent fingerprint rollout, a hosted development sample imported the same ten existing notices twice. Both imports reported zero creations or updates. The first, which created fingerprint state, used 113,482 bytes of reported database I/O; the repeat used 36,448 bytes, about 68% less. This verifies the hosted fast path, not a monthly forecast. Weekly archive checks, source-ID scans, changed notices and ordinary traffic also consume I/O. Measure a complete production refresh cycle before assigning a free-tier DAU allowance.

The final rollout passed 208 unit tests, 42 browser tests, lint, type checking and a production build. A subsequent warm production sample of three Oreo checks and three UK browse requests used 12 Convex calls and 5,550 bytes of reported database I/O, compared with the earlier 18 calls and 8,757 bytes. This sample covers cached requests to one product; it does not predict distinct-product traffic or cold cache costs.

## Capacity estimate after the 9 October optimisations

Assume three warm barcode checks and one warning browse page per daily active user, every day for a 30-day month. That is ten Convex calls and four dynamic website requests per user per day. Scheduled jobs, cold product lookups, cache fills, sharing, additional navigation and bots add usage.

| Daily active users | Monthly Convex calls | Vercel active CPU at an assumed 50 ms per dynamic request |
| --- | --- | --- |
| 1,000 | 300,000 | 1.7 hours |
| 2,000 | 600,000 | 3.3 hours |
| 3,000 | 900,000 | 5 hours |

Against Convex's one million monthly calls, the traffic-only ceiling rises from about 2,100 to 3,300 DAU. Budget around 2,500 DAU to retain room for imports, cold requests and development. This is a call budget, not an established fully free capacity. [Convex limits](https://docs.convex.dev/production/state/limits)

Vercel Hobby includes four active CPU hours monthly. At the illustrative 50 ms per dynamic request, the CPU-only ceiling is about 2,400 DAU. At 25–100 ms it ranges from about 4,800 to 1,200 DAU. Actual CPU consumption and the project's Vercel billing plan have not been verified. These calculations also exclude CDN request, transfer and memory limits. Database waiting time is excluded from active CPU billing. [Vercel function pricing](https://vercel.com/docs/functions/usage-and-pricing), [Hobby allowances](https://vercel.com/docs/plans/hobby)

The 9 October team usage snapshot showed 91,695 calls, leaving 90.8% of the monthly call allowance, but already 3.03 GB of database I/O. There is no remaining free I/O allowance this month. The storage gauge still showed about 759 MB; the roughly 386 MB post-cleanup figure remains a projection before fingerprint-state growth.

Keep 1,000–2,000 DAU as a provisional planning range until a full production refresh cycle establishes the new daily import cost. Weekly archive checks and ordinary warning changes also need to fit within Convex's one GB monthly I/O allowance. Do not present this range as guaranteed fully free operation. Measure active CPU, cold product traffic and the steady import baseline before raising it.
