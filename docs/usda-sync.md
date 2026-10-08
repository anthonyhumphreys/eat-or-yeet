# USDA snapshot sync

USDA's public FSIS Recall API returns an Akamai 403 from our Convex backend, a Vercel function in `iad1`, standard GitHub Linux/ARM/macOS runners, and a Cloudflare Worker in Amsterdam. Curl and Chrome on GitHub also fail. A fetch from the maintainer's home network succeeds. The exact upstream blocking rule is unknown.

The official CDC combined feed is reachable from hosted runners, but currently includes only 22 recent notices. It cannot replace a full check of active USDA recalls and public health alerts. The full API currently contains 1,241 English notices, including 101 active notices.

## Import from a connection that works

Use Node 24+, install this repository's dependencies, and sign in to Convex with a maintainer account. Run from the repository root:

```sh
pnpm data:sync:fsis          # selected development deployment
pnpm data:sync:fsis --prod  # explicit production target
```

The script fetches the full official API and validates every record before uploading its English records to temporary Convex storage. An admin-only action validates the snapshot again, imports through the existing source ledger and deletes the temporary file. No new public write endpoint or application secret is added. Upload URLs and dataset contents stay out of logs.

Only active notices and explicit closures of previously active notices are stored. Unused resolved history is checked but does not create database rows. A snapshot missing a previously active notice fails the refresh. Warnings never resolve merely because they disappear from a response.

Snapshots must be fetched within 15 minutes of import and remain subject to the existing source size limit. Import failures mark the source unhealthy; a successful import becomes stale after 48 hours. A queued upload is not proof of a successful import.

## Daily external sync

When an external fetcher is responsible for USDA, set this variable on the matching Convex deployment:

```sh
pnpm exec convex env set FSIS_FETCH_MODE snapshot --prod
```

This stops the built-in cron from making the known blocked USDA request and overwriting a successful external run with a failure. Other sources continue on the Convex schedule. Without an external update, USDA becomes stale after 48 hours and blocks negative results as before.

Run `pnpm data:sync:fsis --prod` daily on a home machine that remains online, or from a hosted fetcher with verified USDA access. A home fetch adds no hosting service, but an offline machine cannot update the data. Keep the repository current so the fetcher and deployed importer agree. Configure the scheduler and failure notifications on that machine; this repository does not install an operating-system job automatically.

To return to direct Convex fetching after upstream access is fixed:

```sh
pnpm exec convex env remove FSIS_FETCH_MODE --prod
```

Official references: [USDA Recall API](https://www.fsis.usda.gov/science-data/developer-resources/recall-api), [CDC combined food safety feed](https://catalog.data.gov/dataset/food-safety-information-rss-feed).
