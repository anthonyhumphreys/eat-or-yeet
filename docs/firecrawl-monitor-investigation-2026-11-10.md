# Firecrawl Monitor investigation

10 November 2026. Repository baseline: `origin/main` at `4d57332`.

The implementation and rollout steps are in [FDA Monitor imports](firecrawl-monitor.md).

Firecrawl Monitor is a strong candidate for detecting FDA announcement changes and triggering targeted imports. The useful design is Monitor → webhook → fresh original-byte retrieval → existing deterministic parser. Change detection and record extraction can use separate requests; Monitor does not need to return the original bytes itself. Keep a periodic full reconciliation while measuring detection coverage and delivery reliability.

## Live validation

The account accepted Monitor requests and returned a validated FDA listing of **821 notices**. A temporary monitor watched the listing, a recent Fresh to You notice, and an updated announcement dated 13 February 2026. AI judging was disabled.

| Check | Result | Monitor credits |
| --- | --- | ---: |
| First manual check | Three `new` pages, all HTTP 200 | 3 |
| Repeat without changes | Three `same` pages, all HTTP 200 | 3 |
| Controlled browser-only edit to the updated announcement | One `changed` page with the expected diff; two `same` pages | 3 |

The controlled edit appended a test paragraph only inside Firecrawl's temporary browser. It changed no content on FDA's servers. Keeping the same target ID preserved comparison history across the monitor configuration update.

The existing original-byte retrieval and FDA parser matched direct FDA retrieval across every normalized field for both sampled notices. They produced four product targets for the recent notice and 27 for the updated notice. After the change signal, another original-byte retrieval of the updated notice matched direct retrieval again. The simulated paragraph did not enter the parsed record. This supports using the diff as a trigger while obtaining recall data from a separate validated retrieval.

Check results were read through the Monitor API. Live webhook delivery, signature verification, natural FDA edits over time, and full-archive detection coverage remain outside this smoke test. Deletion was verified and the account returned zero remaining monitors. No application data or production configuration was changed. The [sanitized live results](../reports/firecrawl-monitor-2026-11-10.json) retain the check summaries and parser comparisons.

## What the screenshot offers

The screenshot promotes `/v2/monitor`, a hosted schedule and change-detection service. Page monitors watch explicit URLs; website monitors crawl for pages. A page check scrapes every named URL, normally with `maxAge: 0`, and compares against its previous snapshot. Moving that work to Firecrawl changes who operates the polling loop. [Page monitoring](https://docs.firecrawl.dev/features/monitoring-page).

The advertised reduction in LLM tokens has little direct relevance here: the existing FDA pipeline parses HTML deterministically and does not send complete announcements to a language model.

## How it fits the existing import

The current flow is a validated FDA food/supplement listing uploaded to Cloudflare, followed by one Firecrawl batch containing every expected detail URL. The Worker persists the vendor job ID, retrieves results in bounded pages, validates original bytes and canonical URLs, and prepares the existing durable import batches only after all expected details pass. See [integration design](firecrawl.md), [batch transport](../src/lib/incidents/firecrawl-batch.ts), and [import orchestration](../backend/incidents.ts).

Four constraints determine whether Monitor can take over any of that work:

1. **Announcement fidelity.** The accepted transport requests only `rawBase64`. The [cutover comparison](firecrawl-cutover-2026-10-31.md) found that rendered HTML omitted correction paragraphs. Firecrawl's public request validator forbids combining `rawBase64` with other formats. Its change-tracking guide requires Markdown and compares Markdown content. These constraints prevent combining the two operations in one request, but allow Monitor to trigger a separate original-byte retrieval. Test detection coverage independently from extraction fidelity. [API validator](https://github.com/firecrawl/firecrawl/blob/main/apps/api/src/controllers/v2/types.ts), [change tracking](https://docs.firecrawl.dev/features/change-tracking).
2. **Listing completeness.** Our structured listing checks totals and canonical notice identities. Earlier direct-versus-Firecrawl trials returned inconsistent historical notice sets, as recorded in [the integration notes](firecrawl.md). Monitoring the visible listing cannot establish full archive parity, and unchanged listing metadata does not prove unchanged announcement text. A crawl checks discovered pages, which is a different population from the validated food/supplement listing. [Website monitoring](https://docs.firecrawl.dev/features/monitoring-website).
3. **Source freshness.** [Dataset status](../src/lib/incidents/dataset-status.ts) requires the latest import to succeed within 48 hours. A quiet webhook cannot renew that success. A future replacement would need complete per-URL evidence for a current listing, processing every relevant change before recording a successful run. A small parallel monitor must leave the existing health ledger alone.
4. **Existing write savings.** Unchanged imported records already use fingerprints to avoid unnecessary archive and matching-data writes. Targeted imports could additionally avoid decoding, parsing, staging, and traversing the full archive for each update. Their benefit should be measured across the complete import, rather than inferred from database writes alone. See [import state](../backend/lib/import_state.ts) and [cost tests](../tests/backend-import-cost.test.ts).

The OpenAPI schema accepts generic scrape options on monitor targets, including the raw format. Documented check results expose diffs, scrape IDs, and optional extracted JSON snapshots. Returning original bytes in those results would be convenient, but is unnecessary for the proposed two-request design. [Monitor API schema](https://github.com/firecrawl/firecrawl-docs/blob/main/api-reference/v2-openapi.json), [check results](https://docs.firecrawl.dev/api-reference/endpoint/monitor-check-get).

## Proposed integration

Use the validated structured listing to maintain the known announcement URLs. Monitor changes on those detail pages, and use listing changes to request fresh listing discovery through the existing working transport. Monitoring the listing alone would cover new announcements but would miss edits confined to existing detail pages.

For each new or changed notice, enqueue a fresh `rawBase64` retrieval and run the existing URL validation and FDA parser with current validated listing metadata. Add a dedicated incremental import path: the current full-import run assumes every expected notice is present and must not be marked successful by importing only a changed subset. Track event progress separately from complete-source reconciliation, and prevent older or overlapping jobs from overwriting newer results.

Initially retain the full daily reconciliation as the comparison and recovery path. After live parity and reliability measurements, assess whether it can run less frequently. That would trade some reconciliation freshness for less application-side full-archive work; it requires an explicit source-health design. The absence of webhooks remains insufficient evidence of a successful check.

## Credit comparison

Monitor charges one credit per URL per check, even when nothing changes. Optional judging adds one credit per changed page judged; format add-ons can add further charges. [Monitor pricing](https://docs.firecrawl.dev/features/monitoring#pricing).

The following calculations use **821 detail pages**, the validated listing retrieved during this investigation, and a 30-day month. Judging, extra formats, failures, repeat runs, and subsequent original-byte retrievals are excluded.

| Approach | Credits per 30 days |
| --- | ---: |
| Existing daily detail batch | 24,630 |
| Monitor all 821 pages daily, replacing that batch | 24,630 |
| Monitor all 821 pages every six hours | 98,520 |
| Monitor all 821 pages hourly | 591,120 |
| Monitor one listing page hourly | 720 |
| Existing daily batch plus one hourly listing monitor | 25,350 |

Formula: `URLs × checks per day × 30`. Watching fewer URLs lowers cost by lowering monitored coverage. Watching the listing alone misses body-only edits. A Monitor signal followed by a fresh original-byte scrape adds retrieval cost. Keeping the daily baseline during a trial makes all monitoring credits additional spend.

Monitor eligibility was confirmed with the supplied account key. The sponsorship expiry recorded in [the integration notes](firecrawl.md) remains relevant to a longer-term operating budget.

## A bounded pilot

A practical next pilot is seven days with one monitor checking the listing and five selected detail URLs hourly: **1,008 base monitoring credits**, plus explicit manual runs and change-triggered original-byte retrievals. The implementation uses one shared cadence for all selected URLs. Compare detected notice URLs and timestamps against every validated listing. For detail-page events, exercise the original-byte retrieval and parser in staging, including correction paragraphs, product tables, and status changes. Retain the daily full import and its listing transport during that comparison. A listing-only experiment establishes discovery latency; detail-page coverage needs its own evidence. This longer-running pilot has not been enabled.

Use explicit canonical URLs and disable meaningful-change judging with `judgeEnabled: false`; an AI relevance decision should not decide which recall corrections enter the importer. A goal enables judging by default unless explicitly disabled. [Goals and judging](https://docs.firecrawl.dev/features/monitoring#goals-and-judging).

Before connecting Monitor to ingestion, the implementation would need:

- A dedicated Worker webhook route with its own authentication. The current [Worker routes](../backend/worker.ts) expect existing RPC or upload credentials. Verify the raw request body's HMAC using a configured Firecrawl webhook secret, validate the monitor and URL allowlists, and keep processing in the durable queue. [Webhook security](https://docs.firecrawl.dev/webhooks/security).
- Durable receipt before returning `2xx`, within Firecrawl's ten-second deadline. Its three retries occur after one, five, and fifteen minutes; exhausted delivery must be recoverable from check history. [Webhook delivery](https://docs.firecrawl.dev/webhooks/overview#timeouts-retries).
- Payload validation against the API reference: `data` is an array; top-level `id` identifies the check, so it cannot deduplicate all page events by itself. Use monitor/check/URL identity for page processing and a separate identity for completion. [Page webhook](https://docs.firecrawl.dev/api-reference/endpoint/webhook-monitor-page), [completion webhook](https://docs.firecrawl.dev/api-reference/endpoint/webhook-monitor-check-completed).
- Original-byte revalidation through the existing parser before publishing any changed record. A removed or undiscovered page must not automatically terminate a warning. Inspect all paginated check results and failures; preserve the current full-import gate until a replacement proves equivalent coverage.

Use the pilot to measure missed changes, detection latency, delivery recovery, and total credit and application costs. Original-response extraction remains unchanged. Evaluate whether Markdown detects the relevant edits before allowing its results to suppress scheduled detail retrievals. These are acceptance conditions for retiring full daily retrieval, rather than reasons to reject Monitor as a change-trigger service.

## Verification

The six existing suites for Firecrawl retrieval, batch retrieval, Worker orchestration, FDA announcement parsing, dataset status, and import write costs passed: **72 tests**. These verify the current baseline; they do not test Monitor.

Public Monitor documentation, the downloaded OpenAPI schema, and Firecrawl's public API validator were inspected. The supplied key was loaded from the worktree's ignored `.env.local`; credentials were not copied into the report. The checks reported nine monitoring credits and three standalone original-byte retrievals were made. The account balance decreased by 13 credits during testing, one more than those base charges; the available per-request metadata did not attribute that difference.

The stored changed-page Markdown could also be retrieved using its scrape ID after the monitor was deleted. That is useful for diagnostics and recovery, while the original-byte request supplies the independently validated record.

The account's control API rate limit was three requests per minute. Calls were spaced after rejected requests. A paused monitor rejected manual execution with HTTP 409, so the test used an active weekly schedule for its bounded manual runs and was then deleted. Production provisioning, reconciliation, and failure recovery must account for these observed behaviors.
