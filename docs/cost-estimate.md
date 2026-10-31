# Running costs on Vercel and Cloudflare

Updated: 31 October 2026. Production moved from Convex to Cloudflare on 14 October. This guide identifies cost drivers and required measurements; it does not claim a measured monthly bill, a saving or a free-tier capacity.

## Current cost drivers

| Component | Work to measure |
| --- | --- |
| Vercel | Next.js requests, active CPU, memory, response transfer, persistent-cache traffic and embedded MCP app delivery |
| Cloudflare Workers | Authenticated HTTP operations, nested SELF invocations, scheduled events, Queue consumers and CPU |
| D1 | Rows read and written, index maintenance, stored records, transaction retries and job-outbox updates |
| Cloudflare Queues | Publication, delivery and retry operations, including recovery after expired leases |
| Private R2 | Snapshot/batch writes, reads, deletions, abandoned objects and storage duration |
| Existing NAS | Importer hosting, electricity and connection costs for USDA FSIS snapshots and FDA listings |
| Firecrawl | FDA announcement detail pages, completed batch credits, failed submissions and capped individual Alexandria recovery |
| Optional PostHog | Consented event ingestion under the selected account plan |

There are no application model-inference or photo-upload costs. Hosting, source imports, retries and background jobs still consume resources. Account plans, credits, rates and spend controls must be checked in the relevant provider account before producing a price forecast.

## What the migration changes

Convex function calls and database I/O are no longer the active backend billing units. The [historical usage report](convex-usage.md) and [archived October cost model](archive/cost-estimate-2026-10-07.md) retain their original observations and assumptions. Their DAU ceilings, included allowances, regional surcharge and monthly totals do not transfer to D1/Workers.

The backend preserves compact warning projections, revision-keyed persistent pages, a bounded prepared matcher cache and fingerprinted unchanged-import checks. These reduce repeated work, but one application operation can still perform several D1 statements, nested Worker calls and outbox updates. Do not price traffic by substituting a Worker request rate for a Convex call rate.

Imports prepare private R2 batches and commit at most 25 notices per batch through the Queue. The minute recovery cron runs even when staging source refreshes are disabled. Delivery retries, superseded imports, weekly archive checks and changed notices all add work. The external importer supplies USDA snapshots and FDA listings; Cloudflare retrieves FDA detail pages through Firecrawl. FSA and openFDA bulk fetching run on Workers.

The accepted full staging FDA import used 818 credits for 818 pages. At roughly 816–827 pages daily, budget about 24,480–24,810 detail credits per 30 days, plus any Alexandria recovery (at most 100 reserved credits per UTC day per environment). The one-time million-credit sponsorship expires on 30 October 2027; it does not change Free-plan concurrency or request limits. See the [Firecrawl operations guide](firecrawl.md) for verified balance details and assumptions.

## Measurement plan

Measure an ordinary production source-refresh cycle and a full week that includes archive rechecks. Record background usage separately from representative traffic:

1. Cold and warm regional browse/search requests, coverage reads, identified barcode checks, unknown products and explicit public-share creation.
2. Worker requests and CPU, including SELF invocations; D1 rows read/written, storage and transaction retries; Queue operations, retries and oldest pending work; R2 operations and stored bytes.
3. Vercel active CPU, memory, request counts and actual encoded response bytes. Include MCP discovery and UI resources even when they perform no backend operation.
4. Enabled managed Notion review traffic, token refresh, webhook deduplication and cleanup. Keep private integration usage separate from public MCP and website traffic.
5. Cache state, dataset size, source freshness, deployment version and observation period. Exclude private inputs and credentials from logs and retained measurements.

Build a forecast from the measured background baseline plus per-flow usage at the expected traffic mix. Apply the account's verified pricing, included usage and temporary credits separately. Retain headroom for cache misses, bots, retries, deployments and staging. Report credits as temporary offsets rather than a permanent reduction in operating cost.

The [cutover record](cloudflare-cutover-2026-10-14.md) establishes migration checks and successful imports, not a load test or billing baseline. Local regression tests do not establish production capacity. Follow [architecture](architecture.md), [ADR 0002](adr/0002-migrate-backend-to-cloudflare.md) and [deployment](cloudflare-deployment.md) when changing the workload or hosting boundaries.
