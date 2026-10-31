# Hybrid FDA cutover — 31 October 2026

## Full staging acceptance

The production candidate imported a complete fresh FDA listing of **818 notices** through Firecrawl in Cloudflare. The ingestion ledger completed successfully. All **818 of 818** imported records matched a separately retrieved direct FDA baseline across every normalised baseline field and original source data, excluding retrieval timestamps. Existing database bookkeeping and derived category fields were outside that comparison. Retained historical records outside this listing were not deleted.

- Staging Worker: `cb834850-e4bd-4326-99b0-29b80ac0c3a5`.
- Run: `ingestionRuns:39ba158c-560e-423c-8adc-4091563dfb1c`.
- Started: 23:11:48.879 UTC; completed: 23:21:57.469 UTC (10 minutes 8.590 seconds).
- Found 818; created 0; updated 187; errors none. Staging already contained earlier test data.
- Firecrawl reported 818 completed pages and **818 credits** for this accepted batch.

A preceding staging trial using rendered `rawHtml` failed field comparison because correction paragraphs were absent from rendered DOM output. Production was held until retrieval used exclusive `rawBase64`, which preserves the original HTTP response body. No rendered-output fallback is accepted. Invalid bytes, incomplete batches, wrong URLs or failed detail pages fail the import.

The Free plan still governs concurrency and request rates despite the one-time sponsored credits. The deployed path submits one batch of explicit official detail URLs with at most two browsers, persists its vendor job ID in private R2, polls that job, reads bounded result pages and prepares existing 25-notice import batches. It does not generate JSON records or recall advice.

## Production deployment

The legacy NAS importer had completed successfully before it was stopped. The saved Firecrawl key was transferred privately to the production Worker's secret store without displaying it. No Firecrawl key was sent to the NAS or Vercel.

- Production Worker: `058b6a63-d2cb-4f89-bc79-6e81faaeb885`.
- Worker settings: `FDA_ANNOUNCEMENTS_FETCH_MODE=firecrawl`, `FDA_ALEXANDRIA_FALLBACK=true`, `FSIS_FETCH_MODE=snapshot`.
- Scheduled API source refreshes and category lookups remain enabled; demo data and restore endpoints remain disabled.
- The NAS container was recreated at **23:23:07.942 UTC** with `FDA_ANNOUNCEMENTS_UPLOAD_MODE=listings` and FDA sync enabled. A targeted remote check confirmed `FIRECRAWL_API_KEY` was absent.
- Image: `eat-or-yeet-fsis-sync:firecrawl-20261031`, digest `sha256:27f80efa2dfcbd12ede520b5bb763c48bb7c6ebbd290cd96f7ffdf8a47779524`.
- USDA run `ingestionRuns:e44d9985-8da5-4550-b69f-8b224e888e48` succeeded with 97 records and no errors after startup.
- FDA run `ingestionRuns:e3b3c736-5497-47cc-b89c-30c2bf8d1ddc` succeeded with all **826 notices**, all 34 batches committed, zero errors, zero new records and zero changed records. It started at 23:23:20.325 UTC and completed at 23:32:41.200 UTC (**9 minutes 20.875 seconds**). Firecrawl reported **826 credits**.
- The NAS recorded a new combined success at **23:32:41.922 UTC**, after its 23:23:08.846 UTC attempt, with `failed=false`; its manual health check exited successfully.
- The latest ledgers for all five active sources (`fsa`, `fda`, `fda-drugs`, `fsis`, `fda-announcements`) were successful and less than 48 hours old after cutover.

Provider APIs retain bulk retrieval. Alexandria is enabled only for a failed individual numbered food-recall lookup, with atomic D1 reservations capped at 100 credits per UTC day per environment. Successful direct lookups and bulk enforcement queries never invoke it. No schema migration was needed.

## Active NAS deployment and updates

The source-only release is `/home/AnthonyHumphreys/apps/eat-or-yeet-fsis/releases/firecrawl-20261031`. Existing upload-secret mounts and the status volume are retained. The active Compose files are:

- `/home/AnthonyHumphreys/apps/eat-or-yeet-fsis/deploy/fsis-sync/compose.yaml`.
- `/home/AnthonyHumphreys/apps/eat-or-yeet-fsis/deploy/fsis-sync/compose.firecrawl-cutover.yaml`.

The second file pins the image and release build context, enables FDA sync, explicitly selects `listings`, and sets a 65-minute shutdown/startup allowance. Preserve both files when updating the service. The generic repository Compose default remains `full` for legacy environments; using the base file alone would lose the production listing setting.

Run on the NAS to recreate the existing tested image:

```sh
FSIS_BACKEND_URL=https://eat-or-yeet-backend.still-glitter-7d20.workers.dev \
  docker compose -p fsis-sync \
  -f /home/AnthonyHumphreys/apps/eat-or-yeet-fsis/deploy/fsis-sync/compose.yaml \
  -f /home/AnthonyHumphreys/apps/eat-or-yeet-fsis/deploy/fsis-sync/compose.firecrawl-cutover.yaml \
  up -d --no-build --no-deps fsis-sync
```

Both imports run immediately on startup, daily after success and hourly after failure. FDA listing uploads wait up to 60 minutes for the cloud ledger to finish. Check a new successful FDA ledger and USDA ledger, then verify the combined status file has a success timestamp after startup and `failed=false`. A container's running or healthy state alone does not prove a new import succeeded.

## Rollback

The previous production Worker version is `96cf3f1b-c987-48f5-87e4-ed449fe345bf`; the retained NAS image is `eat-or-yeet-fsis-sync:local`. To revert this cutover:

1. Stop the NAS service gracefully and let pending cloud work finish or fail. Do not change retrieval modes midway through an active import.
2. Following [Cloudflare's rollback procedure](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/), roll back the Worker with `pnpm exec wrangler rollback 96cf3f1b-c987-48f5-87e4-ed449fe345bf --env production`. This restores snapshot mode and disables Alexandria.
3. Recreate `fsis-sync` using only the original base Compose file, the retained `:local` image and explicit production `FSIS_BACKEND_URL`; omit the cutover override and use `up -d --no-build --no-deps fsis-sync`. This restores full FDA uploads with the existing credentials.
4. Verify both new import ledgers succeed and the NAS combined success timestamp advances. Record the rollback in configuration before the next deploy.

Source-health safeguards remain active throughout: failed, incomplete or stale refreshes block a negative food-check result. Retain the Firecrawl secret privately for investigation or delete it from Cloudflare if retiring the integration; no schema rollback is necessary.

## Checks

Lint, TypeScript, the production build and 744 tests across 75 files passed for the deployed code. Tests cover original-byte decoding and correction paragraphs, batch completeness and URL validation, continuation-origin restrictions, pending-job reuse, rate-limit rescheduling, upload-mode guards, direct-first Alexandria recovery and atomic spending limits. Live UK and US warning-list requests returned HTTP 200 after backend deployment.
