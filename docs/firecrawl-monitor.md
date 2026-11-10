# FDA Monitor imports

Firecrawl Monitor can trigger earlier FDA announcement updates while the existing daily full import continues to verify coverage. The feature is disabled in every committed Worker environment and in the uploader's Compose defaults.

## Import flow

1. The dedicated `/webhooks/firecrawl/fda` route verifies the raw body's HMAC, the configured monitor/check identity, and canonical FDA URLs. It records deduplicated intent in D1 before returning HTTP 202. Vendor diffs never become recall records.
2. The existing uploader polls `/admin/fda-monitor` every five minutes while waiting for its regular daily imports. That endpoint accepts only the FDA upload token. A request causes a fresh, complete, validated food/supplement listing upload with its captured request version; USDA is not imported early.
3. New notices, changed listing metadata, and notified detail-page edits queue targeted original-byte retrievals. The existing FDA parser, incident upsert, matching projection, and browse revision handle the resulting records.
4. Daily full imports continue. Incremental imports never create a successful full-source ledger or extend its 48-hour freshness deadline. Outstanding work also blocks negative pack-check results until it is applied or reconciled. Removed or out-of-scope URLs never delete or resolve warnings.

Request versions prevent an older listing handoff from satisfying newer events. Notice revisions reject superseded in-flight results. Full imports cannot overwrite a record covered by a newer event or incremental import. Paid retrieval is reserved atomically, with a shared cap of **100 attempts per UTC day per environment**. Failed or uncertain requests retain their reservation and are not retried automatically; pending work remains visible until reconciliation or a newer event recovers it.

The daily listing also updates the monitor's explicit target set. Targets include the listing and the newest `FDA_MONITOR_DETAIL_LIMIT` notices, across food and supplements. All targets share the monitor's schedule. A limit of five is the committed pilot default; older detail pages still receive the full daily refresh. Increasing the limit increases Monitor's recurring cost.

## Configure a paused pilot

Use a staging environment first. The [investigation](firecrawl-monitor-investigation-2026-11-10.md) and [live evidence](../reports/firecrawl-monitor-2026-11-10.json) record the API smoke tests. Production webhook delivery has not been enabled by this change.

Put the API key in the ignored local `.env.local` for the setup script. Preview the source count, monitored URL count, cadence, and base credits per check:

```sh
pnpm data:configure:monitor --backend-url https://YOUR-STAGING-WORKER.workers.dev --schedule hourly --detail-limit 5
```

The preview only reads FDA's validated listing. Add `--apply` to create a dedicated monitor and pause it for bootstrap. Creation initially uses a weekly schedule; a separate pause request precedes setting the requested cadence, so an invalid cadence cannot prevent pausing. If any request has an uncertain result, inspect the dashboard before repeating `--apply`, because creation must not be duplicated. Save the printed monitor ID. Do not resume the monitor yet.

One listing plus five detail pages checked hourly costs **1,008 base monitoring credits per seven days**, plus change-triggered original-byte retrievals. AI judging is disabled. Monitor continues to charge for unchanged checks; this pilot improves detection latency and bounds application-side work rather than promising lower vendor spend.

## Bootstrap the Worker and uploader

1. Apply the additive `0003_fda_monitor.sql` migration before deploying the new Worker:

   ```sh
   pnpm exec wrangler d1 migrations apply DB --env staging --remote
   ```

2. Provision the existing Firecrawl API key and **the account's webhook HMAC secret** on that Worker. Obtain the HMAC secret from Firecrawl's account settings; it is separate from the API key. Use interactive secret entry:

   ```sh
   pnpm exec wrangler secret put FIRECRAWL_API_KEY --env staging
   pnpm exec wrangler secret put FIRECRAWL_WEBHOOK_SECRET --env staging
   ```

3. Set the chosen Worker's variables to `FDA_MONITOR_ENABLED=true`, `FDA_MONITOR_ID=<created ID>`, and the same `FDA_MONITOR_DETAIL_LIMIT` used by the setup command. Keep `FDA_ANNOUNCEMENTS_FETCH_MODE=firecrawl`. Deploy that environment. The secret is required only when Monitor is enabled; disabled deployments do not need it.
4. Rebuild the existing source uploader with this version and enable `FDA_MONITOR_ENABLED=true` alongside `FDA_ANNOUNCEMENTS_UPLOAD_MODE=listings` and FDA announcement sync. Preserve its existing backend URL, restricted upload tokens, status volume, and production cutover overrides. The Firecrawl API key and HMAC secret stay in Cloudflare; the uploader requires neither.
5. Let startup complete a new full FDA and USDA import. Verify their successful ledgers and the uploader's combined success timestamp. Confirm `fdaMonitor.getStatus` reports a fresh listing, equal requested/fulfilled versions, and zero pending notices. The target-sync job updates the paused monitor while preserving its target ID.
6. Resume the monitor in the Firecrawl dashboard. Confirm its webhook points at this Worker's `/webhooks/firecrawl/fda`, both page and completion events are subscribed, and judging remains disabled. Check the first completion and any resulting targeted import before enabling a production environment.

The existing minute cron publishes pending durable jobs, including after a process restart. The daily maintenance cron removes expired deduplication receipts in bounded batches. No new public RPC operation is exposed.

## Inspect and recover

With operator backend credentials configured, use:

```sh
pnpm backend:run fdaMonitor.getStatus '{}'
pnpm backend:run fdaMonitor.getPending '{"cursor":null}'
```

Status includes requested and fulfilled listing versions, pending count, and the last received check-completion status. Pending notices expose only their official path, whether retrieval was attempted, and a generic error. Follow pagination for more than 25 pending notices.

The account used in the smoke test allows three control API requests per minute. Target-management jobs reschedule rate-limited requests and preserve stable target IDs. After bounded retries they log `fda_monitor_target_sync_failed`; inspect the dashboard and the configured ID/limit, then the next accepted listing can reconcile targets again. Uploader polling failures log `fda_monitor_poll_failed` and do not renew the daily success timestamp.

If a paid retrieval or commit fails, the notice remains pending and the existing full reconciliation recovers it without repeating that uncertain request. A missed webhook is also covered by the daily full refresh. Monitor alone is not used as evidence of complete coverage, and there is no claim that this implementation replaces daily reconciliation or proves long-term detection parity.

To disable the feature, pause the vendor monitor, set `FDA_MONITOR_ENABLED=false` on both the Worker and uploader, and retain the existing listing mode and daily source refreshes. Imported warnings and the additive schema can remain. Verify a new successful full import after changing operational settings.
