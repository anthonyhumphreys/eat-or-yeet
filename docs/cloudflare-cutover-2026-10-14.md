# Cloudflare production cutover — 14 October 2026

Migration [PR #29](https://github.com/anthonyhumphreys/eat-or-yeet/pull/29) merged as `d418eb590070858f19628b810f4b859f915bebad`. Next.js and public integrations remain on Vercel; Cloudflare owns backend state and scheduled work.

## Production identities

| Resource | Identity |
| --- | --- |
| Cloudflare account | `715060911f9418f1df0f9de0265d8a64` (confirmed Lexio account) |
| Worker | `eat-or-yeet-backend` |
| Backend URL | `https://eat-or-yeet-backend.still-glitter-7d20.workers.dev` |
| Worker version at cutover | `77f02dfd-d65a-41be-b02e-993d0b15806b` |
| D1 | `eat-or-yeet` / `a27dc9e5-4d3e-44f5-8586-6eab64ea43d1` |
| Queue and private R2 bucket | `eat-or-yeet` |
| Website | `https://www.eatoryeet.app` |
| Merged-main Vercel deployment | `dpl_CMgiYCxaQzLWx3xY5Df1yjXguSea` |
| Merged-main deployment URL | `https://eat-or-yeet-j577l6m0z-anthonyhumphreys.vercel.app` |
| NAS Compose project/container | `fsis-sync` / `fsis-sync-fsis-sync-1` |
| NAS image | `eat-or-yeet-fsis-sync:cloudflare-reviewed-8dfd803` |
| NAS image digest | `sha256:6d48327777d7a62dddd33efd361a1e67a0c39f3022eb983e731b7528ff39bbd0` |

The NAS runs the reviewed importer from `8dfd803ab332e9c81d1ba0b6366da24e03da9cce`. Its checkout is `~/apps/eat-or-yeet-fsis`; Compose lives in `deploy/fsis-sync`. It holds only the separate USDA and FDA upload credentials, mounted as secrets. Both sources are attempted independently, and combined health requires both to succeed.

## Data and writer transition

Legacy Convex source/product schedules were disabled, its website mutation credential was rotated to freeze writes, and the legacy NAS container was stopped before the final export. No active Notion installations, pending OAuth flows or Notion jobs needed draining.

The final snapshot contained 19,625 records across 21 tables. Every table count matched after D1 restore, and warning projection/import-state relationships had zero broken links. Original IDs and timestamps were retained. Existing Notion encryption and third-party credentials were preserved; operator and upload credentials were generated separately. Restore access is disabled.

The production Worker has source/product schedules enabled, demo data disabled and external snapshot modes for USDA FSIS and FDA announcements. FSA and openFDA food/drug feeds run on Workers. R2 lifecycle rules expire abandoned source-import batches after seven days and raw snapshot uploads after one day; successful objects are deleted immediately.

A production Vercel deployment was built with `--prod --skip-domain`, tested against production D1, then promoted. The merged-main deployment subsequently built successfully and took over the production aliases with the same native backend settings.

## Acceptance

- All 612 tests, lint and type checks pass. The production Next.js build passes. CodeRabbit and Macroscope correctness checks passed before merge.
- The first production NAS cycle imported 101 active USDA notices and 804 FDA food/supplement announcements. The revised independent importer completed a second cycle with 101 and 806 respectively; both imports succeeded and Docker health reports healthy.
- Fresh FSA and openFDA food imports succeeded. UK and US food coverage are healthy. The source gate returned an inconclusive check while imports were incomplete, including with previously cached warning data.
- The merged production website serves browsing, a retained warning detail URL and integrations. A known recall matches, an unmatched-product check completes with healthy coverage, and creating/reopening a public share returns HTTP 200.
- Public MCP passes both supported protocol modes: coverage, product checks, warning search/details and embedded app resource delivery. The incomplete-coverage behaviour was checked before the fresh imports completed.
- Post-import warning projection/import-state relationship checks still report zero broken links.

Live Notion OAuth consent, signed events and physical camera hardware were not exercised. Retained credentials and zero active Notion state do not substitute for that acceptance.

## Rollback material and procedure

Private files are ignored and must not be committed or pasted into logs:

- `.local-backups/convex-final-cutover-20261014.zip`: final frozen legacy dataset.
- `.local-backups/production-final-restore.sql` and `production-final-counts.json`: validated import and count manifest.
- `.local-backups/convex-operator`: retained Convex CLI checkout.
- `.local-backups/legacy-writes-original.env` and `convex-production-env.private`: original legacy settings.
- `.local-backups/production.env`: native operator access; `.local-backups/production-secrets.json`: provisioned credentials.
- NAS `~/apps/eat-or-yeet-fsis-convex-rollback-20261014`: legacy checkout, Compose configuration and saved status.
- NAS Docker tag `eat-or-yeet-fsis-sync:convex-rollback-20261014`: original importer image.

For a frontend regression, promote the previously validated native production artifact:

```sh
pnpm dlx vercel promote https://eat-or-yeet-agy5l42n9-anthonyhumphreys.vercel.app --yes --scope team_trMksOxJYKuixLYWdXQZYSJi
```

That deployment (`dpl_91G2XZ8nNT6r72DVEB1ECoAkAUig`) uses the production Worker, preserving new D1 records. An earlier verified native artifact, `dpl_5cyxZeGwhFFMCZBT8r9UCy8XgLji`, is also retained at `https://eat-or-yeet-mpm8uv48d-anthonyhumphreys.vercel.app`.

For a backend regression, inspect the failure and take a fresh D1 export before changing state. Prefer a compatible Worker version rollback that retains D1. Time Travel is a data rewind, not an ordinary application rollback; capture its current bookmark and account for intervening writes before using it.

Returning to Convex is a last-resort coordinated migration: pause native website/background/NAS writers, export and reconcile post-cutover records, restore the original Convex mutation credential and settings, restart the saved legacy NAS image with explicit Compose project `fsis-sync`, then restore the legacy Vercel deployment and matching backend settings. The retained legacy frontend is `dpl_4ViJfQ6N1aZyh2481jfTzuF91yrB` at `https://eat-or-yeet-matu300m4-anthonyhumphreys.vercel.app`. Promoting it alone would return users to the frozen legacy dataset.

Keep legacy resources frozen until acceptance is complete; do not run both schedulers against the same Notion installations. The Anvil Cloud implementation follow-up is [ANV-54](https://linear.app/anvil-stack/issue/ANV-54/make-anvil-clouds-cloudflare-adapter-viable-for-a-stateful-production).
