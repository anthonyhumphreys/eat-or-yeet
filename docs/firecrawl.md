# Firecrawl sponsorship and Cloudflare integration

Firecrawl sponsors Eat or Yeet. The website acknowledges the sponsorship below the navigation and in the footer, using unmodified [official wordmarks](https://www.firecrawl.dev/press-brand).

## Who runs what

**All hosted Firecrawl requests run in the Cloudflare Worker. Its API key belongs in that Worker's secrets.** The NAS never needs a Firecrawl key and never calls Firecrawl.

Provider APIs remain the primary feeds. FSA, openFDA food/drug enforcement and USDA FSIS retain their existing bulk transport and reconciliation. An optional Alexandria fallback can recover individual failed FDA food-enforcement lookups, with a shared daily credit cap. A live Cloudflare network probe on 30 October 2026 received HTTP 401 from FDA's announcement listing page. The existing working connection therefore still fetches FDA's food/supplement listing, checking its reported totals, but can upload the listing alone.

### API-first source audit

Use public APIs for structured bulk records and Firecrawl for announcement text. Alexandria is a bounded recovery route for a failed individual API lookup, not a second bulk feed. Sponsorship does not require duplicating successful retrievals.

| Source/content | Retrieval | Why |
| --- | --- | --- |
| FSA warning records | Existing public API | Structured warning and product data already exists. |
| FDA food/drug enforcement | Existing openFDA APIs | Product descriptions, code information, classifications and report/status fields are already available. Optional Alexandria recovery applies only to failed numbered food-recall lookups. |
| USDA FSIS archive | Existing official API and working external transport | An IP-access problem does not justify recreating an API with scraping. |
| FDA announcement listing | Existing structured listing endpoint | Already supplies date, brand, company, product, reason, notice URL and termination label. Do not scrape those fields again. |
| FDA announcement body | Firecrawl in Cloudflare, existing deterministic parser | Complete announcement text and consumer instructions are outside the listing's fields. This replaces an existing HTML transport, not the provider API or a dataset. |
| Open Food Facts | Existing barcode API | Structured product metadata already exists. |
| Publisher headlines | Existing RSS feeds | No Firecrawl search or article scraping is required for the current news feature. |

Checked the [openFDA food API](https://open.fda.gov/apis/food/enforcement/), [FDA's announcement XML downloads](https://www.fda.gov/about-fda/open-government-fda-data-sets/recalls-data-sets) and [official RSS feeds](https://www.fda.gov/about-fda/contact-fda/subscribe-podcasts-and-news-feeds) on 30 October 2026. The downloaded 2026 XML contained listing metadata, not full announcement bodies. The two recall RSS feeds each returned 20 items with truncated descriptions. These are useful structured sources, but neither replaces a complete detail-page retrieval. openFDA is updated weekly and is a distinct enforcement dataset; do not infer identical coverage from similar product names.

The HTML parser continues taking the listing's identity/status fields as supplied. It uses page text for announcement paragraphs, consumer instructions and source-confirmed code/date evidence. It does not ask Firecrawl to reconstruct API records. Full daily detail refreshes remain the existing conservative behaviour; skipping unchanged pages would need reliable upstream change signals before it could preserve the same coverage guarantees.

An experiment on 30 October retrieved the original FDA datatable JSON through Firecrawl at one credit per request. However, independent full comparisons returned differing historical notice sets: direct/Firecrawl counts included 827/818, 818/816 and 816/826. Some identical-URL cache-busted comparisons matched, but cache-busting did not establish repeatable full-list parity. The cause is not established; do not remove the listing handoff on the strength of successful HTTP responses or internally consistent totals alone. No experimental cloud-listing transport is enabled or shipped.

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

## Alexandria fallback

Set `FDA_ALEXANDRIA_FALLBACK=true` in the intended Worker's `wrangler.jsonc` environment after provisioning its Firecrawl secret. The committed default is `false`, independently of announcement retrieval mode.

Bulk food/drug queries and unnumbered event reconciliation always call openFDA directly. Only a numbered food-recall lookup that fails direct retrieval or validation can call `fda-gov/records/food_recalls`, with `record_id` and a limit of two to detect ambiguity. The response must contain exactly one matching original FDA record, matching official source URLs, HTTP 200 upstream status, no truncation or provider error, and the expected five-credit price. The existing FDA parser then validates and normalises the record. Successful direct requests never invoke Alexandria, and browsing or pack checks never invoke it.

The shared D1 budget permits at most 20 fallback attempts (100 reserved credits) per UTC day per environment. Reservations happen atomically before paid calls; failed or uncertain requests retain their reservation. There are no automatic paid-request retries. When the cap is exhausted or recovery cannot verify the record, the import fails and the normal ingestion ledger and source-health gate report incomplete coverage. An exhausted budget never means that a warning is resolved. Set the flag back to `false` and redeploy to disable fallback; no schema migration is needed.

Live discovery and execution on 30 October confirmed a ten-record page maximum and five credits per request for both FDA recall capabilities. With 1,104 food and 2,802 drug records marked Ongoing, a full Alexandria replacement would need 111 + 281 requests, or 1,960 credits per refresh before reconciliation. This bulk replacement is deliberately absent.

An authenticated temporary Worker in Cloudflare's LHR region exercised the actual Alexandria helper and FDA parser against recall `F-1170-2024`, returning the expected source identity and code information. The saved key was transferred into the temporary runtime without displaying it. Native D1 integration tests also cover Worker flag wiring, concurrent reservations, UTC reset, budget exhaustion and retention of existing warnings after failure. No production data or configuration changed.

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

## Expected credit use and sponsorship expiry

The account's [Usage → View all balances](https://www.firecrawl.dev/app/t/TjAzYP5DmjY/usage) showed on 30 October 2026:

- 1,000,000 one-time sponsored credits, expiring **30 October 2027**, with no refresh.
- A separate 1,000-credit free allowance, refreshing on 28 November 2026.
- A further 250 one-time credits with no displayed expiry.

The practical sponsored runway is therefore **12 months**, regardless of the balance's theoretical multi-year usage runway. The sidebar reset date applies to the free allowance, not a monthly replenishment of the million credits.

At the observed 816–827 detail pages, a complete daily refresh would use about 24,480–24,810 credits per 30 days at the current [1-credit HTML scrape rate](https://docs.firecrawl.dev/billing). Even using the full 100-credit Alexandria cap every day adds only 3,000 credits per 30 days. That is roughly 335,000–340,000 credits over a year, or about 400,000 with 20% headroom. Actual spend depends on listing size, repeat runs and how often direct lookups fail. The committed default-off configuration consumes no scheduled Firecrawl credits.

## Government Index

The [Government Index](https://docs.firecrawl.dev/features/gov) is a separate US legal/regulatory search product. Its recall coverage and timeliness have not been established here; it does not participate in imports or source-health checks.
