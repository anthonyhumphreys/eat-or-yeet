# Keeping Convex usage small

The 9 October 2026 usage report showed about 759 MB of database storage and 2.95 GB of monthly database I/O across Eat or Yeet deployments. Production warning-list queries accounted for about 1.88 GB of that I/O. These are observed totals, not a forecast or a guaranteed saving.

## Storage and imports

The full `incidents` table retains official source payloads. Its only application lookup uses `by_authority_sourceId`. Four unused indexes were removed; at the measured 93.25 MB of documents across deployments, that avoids about 373 MB of indexed copies. Convex bills each index as another table copy. [Convex limits](https://docs.convex.dev/production/state/limits)

Matching and browsing still use `incidentMatchData`, which omits the original source payload. Its indexes serve current application queries. Warning records and matching targets are retained.

Imports compare incoming content with existing records and skip unchanged writes. `retrievedAt` and `sourceRunId` identify the last content update; the ingestion ledger records subsequent successful fetches, even when no notice changes. Projection repairs still run when needed. Every projection write increments the region's cache revision in the same mutation.

The daily cron no longer scans all incident documents to repeat the matcher migration. For an older deployment with missing projections, run `incidents:backfillMatchDataInternal` once before enabling checks. New imports maintain their own projections.

## Caching and freshness

The existing Next.js persistent data cache stores individual browse and matcher pages, plus warning details. Keys include deployment URL, region or slug, demo mode where relevant, and dataset revision. A fresh, small version query selects the right entry on every request. New, changed and resolved warnings select new entries immediately, including writes from partial imports. Unchanged imports retain the revision.

Snapshots include notice start and expiry times. The app applies those boundaries on every request, outside the cache. Product checks also read source health on every request; a cached dataset never extends the 48-hour freshness gate or conceals a failed source fetch. Health failures still prevent a reassuring no-match result.

Pages are limited to 100 rows and a 512 KiB database-read budget. This keeps normal cache entries below the Next.js data cache's 2 MiB limit, rather than trying to cache an entire regional dataset in one item. The small worker cache remains bounded. No Redis service or additional paid cache is needed for this workload.

All warning mutations must use `bumpDatasetVersions`. Direct dashboard edits or imports that bypass application mutations need a revision bump before cached views are current. A new version row's document ID separates caches after a database restore or reset.

## Development and previews

Prefer the existing account-free local Convex setup for routine development and browser tests. Cloud development and preview imports consume the same team allowance as production. Keep a cloud preview only while it serves an active review, and avoid importing a full duplicate dataset for a connectivity probe. [Local development](https://docs.convex.dev/cli/local-deployments)

Before retiring a preview, confirm its identity and that production uses a separate backend. Export a backup with `pnpm exec convex export --deployment NAME --path BACKUP.zip`. Keep backups private and outside version control; `.local-backups/` is ignored. Never remove production warning records to fit a quota.

## Verification

Use `pnpm exec convex deployment usage --prod --json` to inspect production counters and the team usage dashboard for storage. Monthly I/O already consumed cannot be undone. Compare subsequent daily usage after rollout; don't infer the long-term reduction from a single warm-cache request.

Useful regressions include cached pages across workers, revision changes after partial imports, source-health failures with warm caches, notice start/expiry boundaries, deployment/demo isolation, and retries after failed page loads. Verify hosted imports and a known warning as well as an identified unmatched barcode.

The 9 October rollout passed 183 unit tests, 42 browser tests, lint, type checking and a production build. A development USDA sync fetched 101 active notices and updated one changed record. Hosted production checks matched a known recalled barcode, returned no published warning match for Oreo with healthy US coverage, and loaded both regional warning lists. A warm sample of three Oreo checks plus three UK page loads added 18 calls and about 8.8 KB of reported database I/O. These immediate counters may lag or include concurrent traffic; the sample is evidence that warm requests avoid full dataset reads, not a monthly cost forecast.

The unused indexes were removed from production, cloud development and the retained `main` preview. Using the reported document sizes, projected database storage is about 386 MB after the reporting delay. The old preview was backed up privately; its data was retained. Confirm the eventual storage gauge before treating that projection as measured usage.
