# Firecrawl sponsorship and Cloudflare integration

Firecrawl sponsors Eat or Yeet. The website acknowledges the sponsorship below the navigation and in the footer, using unmodified [official wordmarks](https://www.firecrawl.dev/press-brand).

## Who runs what

**All hosted Firecrawl requests run in the Cloudflare Worker. Its API key belongs in that Worker's secrets.** The NAS never needs a Firecrawl key and never calls Firecrawl.

Provider APIs remain the primary feeds. FSA, openFDA food/drug enforcement and USDA FSIS retain their existing transport and reconciliation. A live Cloudflare network probe on 30 October 2026 received HTTP 401 from FDA's announcement listing page. The existing working connection therefore still fetches FDA's complete food/supplement listing, checking its reported totals, but can upload the listing alone.

### API-first source audit

Firecrawl is justified only for useful content unavailable through the source's structured feed. Sponsorship does not change that rule.

| Source/content | Retrieval | Why |
| --- | --- | --- |
| FSA warning records | Existing public API | Structured warning and product data already exists. |
| FDA food/drug enforcement | Existing openFDA APIs | Product descriptions, code information, classifications and report/status fields are already available. |
| USDA FSIS archive | Existing official API and working external transport | An IP-access problem does not justify recreating an API with scraping. |
| FDA announcement listing | Existing structured listing endpoint | Already supplies date, brand, company, product, reason, notice URL and termination label. Do not scrape those fields again. |
| FDA announcement body | Firecrawl in Cloudflare, existing deterministic parser | Complete announcement text and consumer instructions are outside the listing's fields. This replaces an existing HTML transport, not the provider API or a dataset. |
| Open Food Facts | Existing barcode API | Structured product metadata already exists. |
| Publisher headlines | Existing RSS feeds | No Firecrawl search or article scraping is required for the current news feature. |

Checked the [openFDA food API](https://open.fda.gov/apis/food/enforcement/), [FDA's announcement XML downloads](https://www.fda.gov/about-fda/open-government-fda-data-sets/recalls-data-sets) and [official RSS feeds](https://www.fda.gov/about-fda/contact-fda/subscribe-podcasts-and-news-feeds) on 30 October 2026. The downloaded 2026 XML contained listing metadata, not full announcement bodies. The two recall RSS feeds each returned 20 items with truncated descriptions. These are useful structured sources, but neither replaces a complete detail-page retrieval. openFDA is updated weekly and is a distinct enforcement dataset; do not infer identical coverage from similar product names.

The HTML parser continues taking the listing's identity/status fields as supplied. It uses page text for announcement paragraphs, consumer instructions and source-confirmed code/date evidence. It does not ask Firecrawl to reconstruct API records. Full daily detail refreshes remain the existing conservative behaviour; skipping unchanged pages would need reliable upstream change signals before it could preserve the same coverage guarantees.

The cloud flow is:

1. The NAS fetches and validates FDA's complete listing using the existing provider endpoint.
2. It uploads a fresh listing snapshot to `/admin/fda-announcement-listings` using the existing restricted FDA upload token.
3. Cloudflare validates the snapshot and saves a private R2 manifest. Queue jobs fetch detail pages through Firecrawl, 25 notices per job with at most five requests in parallel.
4. Each page's raw HTML passes through the existing deterministic FDA parser. R2 holds the prepared batches. Only after every page passes does the normal durable D1 import begin.

The listing snapshot must be fresh within 15 minutes, contain unique canonical FDA paths and valid food/supplement rows, and fit the existing size limit. Delivery retries reuse saved detail batches. Missing keys, stale listings or failed pages fail the run and preserve the existing source-health safeguards. Source IDs, product/code/date associations and the 48-hour freshness gate remain unchanged.

There is no generated JSON extraction or model-written recall advice. Only public official notice URLs are sent to Firecrawl. Browsing and pack checks do not consume Firecrawl credits.

## Put the key in Cloudflare

Provision `FIRECRAWL_API_KEY` as a **secret** on each Worker environment that will run Firecrawl:

```sh
pnpm exec wrangler secret put FIRECRAWL_API_KEY --env staging
pnpm exec wrangler secret put FIRECRAWL_API_KEY --env production
```

Each command prompts for the value. The dashboard equivalent is Workers & Pages → the Worker → Settings → Variables and Secrets → Add → Secret. Production's Worker is `eat-or-yeet-backend`; staging is `eat-or-yeet-backend-staging`. Vercel and the NAS do not need this key. For local Worker testing, use the ignored `.dev.vars` file; the local comparison script reads `.env.local`.

## Evaluate and cut over explicitly

The committed Worker configuration remains `FDA_ANNOUNCEMENTS_FETCH_MODE=snapshot`. Provisioning the key alone does not enable Firecrawl.

The read-only local comparison remains available from a connection that can access FDA:

```sh
pnpm data:evaluate:firecrawl --limit 3
```

It makes one Firecrawl request for each selected page (limit 1–10), compares normalised fields with direct retrieval and writes no backend data. A failed retrieval or difference returns a nonzero exit code.

Live checks on 30 October 2026 validated a listing of 816 unique announcements. A local comparison matched every normalised field for one notice in 2,686 ms, excluding listing retrieval. An authenticated temporary Worker in Cloudflare's LHR region then accepted that validated listing, retrieved the same notice through Firecrawl and produced an identical serialised-record fingerprint. The key was passed as a hidden test secret; no production data or configuration was changed. Cloudflare's unsupported `redirect: error` option was replaced with `manual`, which rejects redirects without forwarding credentials.

For staging cutover, provision the staging secret, change staging's `FDA_ANNOUNCEMENTS_FETCH_MODE` to `firecrawl` in `wrangler.jsonc`, and deploy the staging Worker. Use a separately targeted staging importer with its own upload credentials. Set `FDA_ANNOUNCEMENTS_UPLOAD_MODE=listings` in that importer's environment. The existing container accepts this setting without a Firecrawl-specific Compose override:

```sh
FDA_ANNOUNCEMENTS_UPLOAD_MODE=listings \
  docker compose -f deploy/fsis-sync/compose.yaml up -d --build
```

Listing upload triggers the cloud jobs; hosted cron does not independently fetch the blocked FDA listing. The importer waits for the cloud ingestion ledger to complete. Full normalised FDA uploads are rejected while the Worker owns detail retrieval, and listing-only uploads are rejected in legacy snapshot mode, preventing mixed writers.

Before production, compare recent and older notices, multi-product tables, exact codes/dates, terminations and previously blocked pages. Measure complete-run duration and credits. The importer currently polls for up to 15 minutes, so verify the full run fits that operational limit. Compare seven daily cycles before general activation. A full refresh retrieves every detail page, including unchanged notices; the current sample is roughly 816 pages per run.

For production cutover, let an in-progress legacy FDA import finish, pause its FDA sync, deploy the production Worker with mode `firecrawl` and its secret, then recreate the importer with listing-only mode. USDA continues using its existing API transport. Do not remove the provider importer simply because detail retrieval moved to Cloudflare.

To roll back, pause FDA listing uploads, let existing cloud jobs finish or fail, restore the Worker's mode to `snapshot`, redeploy, then recreate the importer with `FDA_ANNOUNCEMENTS_UPLOAD_MODE=full` (the default). The existing uploader credentials remain usable. No database schema migration is required.

## Expected credit use

At the measured 816 detail pages, a complete daily refresh would use about 816 credits per day at Firecrawl's current [1-credit HTML scrape rate](https://docs.firecrawl.dev/billing). A one-off balance of 1,001,250 credits would cover about 1,227 days (3.36 years), or about 2.8 years with 20% overhead for growth, repeat runs and tests. This assumes no expiry, no other Firecrawl usage and unchanged pricing. Sponsorship-specific expiry or replenishment has not been verified. The default-off configuration consumes no scheduled Firecrawl credits.

## Government Index

The [Government Index](https://docs.firecrawl.dev/features/gov) is a separate US legal/regulatory search product. Its recall coverage and timeliness have not been established here; it does not participate in imports or source-health checks.
