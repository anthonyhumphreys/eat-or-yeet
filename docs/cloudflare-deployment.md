# Cloudflare backend deployment

For the optional FDA Firecrawl integration, provision `FIRECRAWL_API_KEY` as a Worker secret in the intended environment. Its cloud job and listing-uploader cutover are documented in the [Firecrawl rollout guide](firecrawl.md). The NAS and Vercel do not need this key.

Production has used Cloudflare Workers, D1, Queues and private R2 since 14 October 2026. Next.js stays on Vercel. Wrangler declares separate local, staging and production resources. Both hosted stages are provisioned in `wrangler.jsonc`; confirm the selected account and environment before changing them.

See [architecture](architecture.md) for component boundaries, [ADR 0002](adr/0002-migrate-backend-to-cloudflare.md) for the migration decision and [the cutover record](cloudflare-cutover-2026-10-14.md) for dated production evidence. The provisioning and export instructions below apply to a new stage or an explicitly planned restore, not routine deployments.

## Records and transactions

D1 stores validated JSON records with their original opaque identifiers, creation timestamps and declared SQLite expression indexes. This retains existing warning links, relationships and encrypted Notion credentials without a lossy schema conversion. Public matching still reads compact projections rather than original source payloads.

Read operations bracket their reads with a database revision. Mutations stage their record writes and scheduled jobs, then commit one D1 batch with an optimistic revision check. A failed CHECK rolls back the whole batch; concurrent changes retry the operation. The global revision serializes writes, so this approach suits this application's modest write rate. Revisit it if sustained writer contention appears.

The transactional job outbox closes the gap between D1 writes and Queue publication. A minute cron republishes pending work and recovers expired leases. Lease tokens reject old queue deliveries and prevent a stale attempt from completing a newer claim. Failures retry with bounded backoff, then remain visible as `failed` records. Operations involving third-party effects still need their existing idempotency keys and domain leases.

Source archives are validated before imports are prepared in private R2. Each Queue delivery applies at most 25 notices and commits its progress, warning projections and next job together. Redelivery cannot double-count a committed batch. A newer source refresh fences older batches. Indexed reads are fetched together, while unchanged notices retain the compact-projection fast path. One consumer avoids contention on the database revision; delivery leases last 20 minutes, longer than Queue's 15-minute invocation limit. Nested operations use the Worker's SELF binding, and durable batches keep request chains below its invocation limit.

Configure R2 lifecycle rules for `source-imports/` at seven days and `fsis/` and `fda-announcements/` at one day. Committed batches and upload objects are deleted immediately; these rules remove abandoned objects after a failed preparation or superseded refresh.

## Provision an isolated stage

```sh
pnpm exec wrangler whoami
pnpm exec wrangler d1 create eat-or-yeet-staging --location weur
pnpm exec wrangler r2 bucket create eat-or-yeet-staging
pnpm exec wrangler queues create eat-or-yeet-staging
```

These creation commands are examples for an unprovisioned environment. Existing staging and production resources are already declared in `wrangler.jsonc`; do not recreate them for a routine release. For a new environment, use unique resource names, record the returned D1 UUID and configure its bindings. Do not point staging at production resources.

```sh
pnpm exec wrangler d1 migrations apply DB --env staging --remote
pnpm backend:types
pnpm exec wrangler deploy --env staging --dry-run
```

New schema changes need a new numbered migration. Run `pnpm backend:generate` for typed operation references and the registry; the generator writes the initial SQL only when it is missing. Do not delete or rewrite `0001_backend.sql` once deployed.

## Secrets and boundaries

Generate independent random 32-byte values per environment. Store operator files privately with mode 0600. Provision Worker secrets through `wrangler secret put NAME --env staging` or a private JSON file passed to `wrangler secret bulk FILE --env staging`.

- `BACKEND_SECRET`: required in the Worker and corresponding Vercel environment. It permits declared website operations only.
- `BACKEND_ADMIN_TOKEN`: required for `/admin/rpc`; permits internal operations. Keep it in operator tooling, never Vercel.
- `FSIS_UPLOAD_TOKEN`: only permits `/admin/fsis`. Give this token to the NAS importer.
- `FDA_UPLOAD_TOKEN`: only permits `/admin/fda-announcements`. Give this separate token to the same NAS importer. It cannot upload USDA data or call general operations.
- `NOTION_CREDENTIAL_KEY`: preserve the existing encryption key when restoring encrypted credentials. It must agree in Vercel and the Worker.
- `NOTION_CLIENT_ID`, `NOTION_CLIENT_SECRET`, `NOTION_REVIEW_CONNECTION_KEY`: needed in the Worker for enabled hosted Notion jobs. Keep the website's existing OAuth/webhook settings in Vercel.
- `OPENFDA_API_KEY`: optional Worker secret for source fetching.

Local Wrangler uses `.dev.vars`; hosted stages use `.dev.vars.staging` or `.dev.vars.production` for local emulation only. These files are ignored. Production secrets must be explicitly provisioned remotely. Worker logs record operation identifiers and error classes, not request contents or credential envelopes.

USDA and FDA announcements use `snapshot` fetch modes. The NAS validates the complete official FDA food/supplement listing and every detail page, then uploads normalized records. The Worker validates their age, schema, FDA origin, source IDs and announcement paragraphs before preparing imports. A Worker-side live test received a regional FDA "Page Not Found" response for an announcement reachable from the home connection, so the NAS fetches this source too. FSA and openFDA food/drug enforcement feeds remain on Workers. The NAS health check covers both snapshot imports, and the application's uncached source-health gate still expires missing or failed coverage.

## Routine release order

1. Review the new numbered SQL migration and compatibility with the currently deployed application. Apply it to staging with `pnpm exec wrangler d1 migrations apply DB --env staging --remote`.
2. Deploy the compatible Worker with `pnpm backend:deploy:staging`, then deploy the Next.js preview using that stage's website credential. Keep preview imports and hosted Notion consent disabled unless explicitly running their acceptance checks.
3. After staging acceptance, apply production migrations with `pnpm exec wrangler d1 migrations apply DB --env production --remote`, then run `pnpm backend:deploy:production`.
4. Build and verify the matching Vercel deployment before promotion. `pnpm build:vercel` does not deploy the Worker or apply SQL migrations.

For a frontend rollback, retain a compatible Cloudflare-backed Vercel deployment. Schema and Worker rollback must account for data written since release. See the migration procedure below only when changing backends or restoring an export.

## Restore a Convex export

Retain a private export and the original backend before cutover. Export with the old CLI, which is no longer a runtime dependency:

```sh
# Run the export in the retained legacy checkout, with its Convex dependency
# and deployment configuration. The migrated project no longer includes it.
pnpm exec convex export --prod --include-file-storage --path /private/path/convex-production.zip
pnpm backend:restore .local-backups/convex-production.zip --validate-only
```

The HTTP restore validates every table before its first write, retains IDs and timestamps, and can resume by replaying the same export. Its preflight rejects records from another dataset, including a demo-seeded destination; restore into an empty database. The HTTP preflight bounds exports to 100,000 records. It does not import old scheduler entries or create third-party jobs. Resolve any active jobs before taking the final cutover export. Empty tables must be present in the archive. Unexpected tables and non-empty legacy file storage require operator review.

For a short production write freeze, generate a private SQL import instead. It validates the same records, rejects duplicate IDs and refuses an occupied destination. Large source payloads are assembled from ordered chunks to stay below D1's SQL statement limit. Its temporary table is removed after import. This path requires Wrangler account access and does not enable HTTP restore.

```sh
pnpm backend:restore .local-backups/convex-production.zip --sql-output .local-backups/production-restore.sql
pnpm exec wrangler d1 execute DB --env production --remote --file .local-backups/production-restore.sql
```

Temporarily deploy the selected stage with `--var BACKEND_RESTORE_ENABLED:true`. Supply `BACKEND_URL` and `BACKEND_ADMIN_TOKEN` privately to the restore command, then deploy normally again to disable restore:

```sh
pnpm exec wrangler deploy --env staging --var BACKEND_RESTORE_ENABLED:true
pnpm backend:restore .local-backups/convex-production.zip
pnpm backend:deploy:staging
```

Compare every table count, sample opaque IDs and foreign-key references. Inspect required UK and US source status with `incidents.getDatasetStatus`. A restored stale ledger must continue to block negative food-check results. Run the required refreshes and configure the external USDA importer before relying on healthy coverage.

## Deploy and verify

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm backend:deploy:staging
```

Use the staging URL returned by Wrangler. Set Vercel Preview `BACKEND_URL` and `BACKEND_SECRET` to that stage; keep `ALLOW_DEMO_DATA=false` and `NOTION_INSTALL_ENABLED=false` for ordinary previews. Check warning browsing, details, known matches, unknown products, stale/failed sources, public shares, quotas and job recovery. Hosted Notion needs a separate live consent, signed event, review and disconnect acceptance run.

`pnpm backend:run module.operation` is an operator-only CLI. It loads local environment files and calls `/admin/rpc`. For example, `pnpm backend:run incidents.refreshAllInternal` queues source refreshes. Use `incidents.queueSourceRefresh '{"sourceId":"fda-announcements"}'` for a single source; fetching a full archive in an HTTP call can outlast its client timeout. Queued jobs are not proof of successful imports.

## Migration cutover and rollback

The following sequence documents the completed backend migration and requirements for any coordinated repeat. It is not the routine release checklist.

1. Provision production D1, Queue, R2 and secrets independently. Confirm Cloudflare credits and spending alerts in the account dashboard; code does not set a billing cap.
2. Pause the old backend's scheduled writers and the old NAS importer. Drain or resolve active Notion jobs. Take a final export while writers are stopped.
3. Apply production D1 migrations and restore the final export with IDs intact. Disable the restore flag. Preserve the existing Notion encryption key. Keep refresh jobs disabled until verification finishes.
4. Point the NAS at the production Worker using separate FSIS and FDA upload tokens. Verify complete imports and source freshness for both countries, then enable the production schedules in `wrangler.jsonc`.
5. Set Vercel Production `BACKEND_URL` and `BACKEND_SECRET`, retain its website secrets, and change the Build Command to `pnpm build:vercel`. The command now builds only Next.js. Stage a production deployment with `vercel deploy --prod --skip-domain`, verify that exact deployment, then promote it. Keep production domains on the old deployment until verification passes.
6. Retain a verified Cloudflare-backed Vercel deployment as the first frontend rollback option; promoting it keeps post-cutover D1 writes available. Keep the legacy deployment, backend and private export until acceptance finishes. Returning to Convex requires pausing native writers and reconciling post-cutover records first, then restoring the legacy URL/credential and scheduler settings together. Never run both job schedulers against the same Notion installations.

The production cutover was performed on 14 October 2026. See [the cutover record](cloudflare-cutover-2026-10-14.md) for resources, deployment identities, validation and retained rollback material. Physical camera hardware and live Notion consent still require separate acceptance. Retire Convex credentials and delete old resources only after the cutover is accepted.


## Indexed recall browsing (migration 0002)

Apply `0002_warning_browse.sql` before deploying the Worker that maintains the new projection:

```sh
pnpm exec wrangler d1 migrations apply DB --env staging --remote
pnpm backend:deploy:staging
```

Use the corresponding production environment only after staging verification. With that environment's private `BACKEND_URL` and `BACKEND_ADMIN_TOKEN` configured, rebuild existing projections:

```sh
pnpm backend:run browse.rebuild
pnpm backend:run browse.list '{"region":"UK","filters":{"q":""}}'
pnpm backend:run browse.list '{"region":"US","filters":{"q":""}}'
```

Run this rebuild after restoring a legacy database export as well. The rebuild processes bounded batches, refreshes complete source hazard/product search text and bumps regional revisions. It is restartable. New matching-row writes update the projection, facets and FTS5 index in the same D1 transaction. Trigger dirty markers make a partially rebuilt or older-writer index unavailable rather than returning a partial list. The website retains the complete legacy path until the new operation succeeds; the first-party pagination endpoint returns a controlled unavailable response if an active browse session loses its backend.

Verify counts, filters, multiple pages, a revision change, both regions and reported medical recalls before promotion. The food-only top alert excludes reported records. A rollback to the prior Worker can leave dirty markers; rebuild again before re-enabling indexed browsing. This migration adds derived tables/indexes and optional matching-row fields; it does not rewrite migration 0001 or change source-health gates.

A local SQLite regression with 1,600 representative warnings measured 943,251 bytes for the full legacy list and 11,328 bytes for the first indexed response, including counts/facets (about 98.8% less). It uses one list RPC plus a revision lookup, instead of paging the entire region. Query-plan checks confirm the regional ordering and trigram indexes. These fixture measurements are not a forecast of provider billed reads: facet aggregation, actual notices and cache behavior affect production cost.
