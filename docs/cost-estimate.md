# Running costs after removing AI

Updated 2026-10-07. USD per month, excluding taxes, domain registration and engineering/support time. These are planning estimates, not an account invoice or a load-test result.

## What changed

Model inference and packaging-image uploads now cost **$0**. The app uses barcode/manual input and deterministic rules. Matching reads a separate compact table in pages of 100, with a five-minute cache per server instance. Source health is checked on every request, and successful source-version changes invalidate that cache.

The full official dataset and USDA FSIS coverage can increase database traffic compared with the truncated MVP. Removing AI does not make database reads free.

Read-only live imports completed against all four sources:

| Source | Notices returned | Active notices | Compact projection, including resolved rows |
| --- | ---: | ---: | ---: |
| UK FSA | 1,361 | 1,361 | 5.15 MB |
| FDA enforcement | 1,066 | 1,066 | 2.11 MB |
| USDA FSIS, English notices | 1,241 | 101 | 4.13 MB |
| FDA announcements | 768 | 531 | 2.80 MB |

These are importer projections, not production database/index measurements. Check queries exclude resolved records. Active-only US bytes were not retained, so the cost model uses a rounded **5 MiB average regional snapshot** as an assumption. Full US projections total 9.04 MB before filtering. Source scope also differs: a complete source listing does not mean every food safety warning is covered.

## Scale model

Assumptions: one Vercel developer; US-region Convex; 10 checks per monthly active user; half the checks use barcode metadata; 2% create public links; eight CDN requests per check averaged over visits/assets; Flat Rate CDN enabled; 5 MiB average regional matching snapshot; about twenty paged calls per snapshot; a planning allowance of five other Convex calls, 6 KB database I/O and 4 KB egress per check; 20 ms active CPU and one second at 2 GB provisioned memory per check. Background imports contribute an assumed 1.5 GB monthly database I/O and 20,000 calls. Storage and action compute are assumed to fit included allowances. The snapshot size, cache hit rate and timings need production measurement.

| Monthly active users | Checks/month | 90% snapshot-cache hit rate | All snapshots fetched again |
| ---: | ---: | ---: | ---: |
| 100 | 1,000 | ~$20 | ~$22 |
| 1,000 | 10,000 | ~$22 | ~$40 |
| 10,000 | 100,000 | ~$40 | ~$210 |
| 100,000 | 1,000,000 | ~$220 | ~$1,730 |
| 1,000,000 | 10,000,000 | ~$2,170 | ~$17,630 |

The last column is a stress scenario showing why cache efficiency matters. It is not the expected steady-state bill. A 90% hit rate has not been demonstrated. Low-volume traffic may have poor hit rates but little absolute cost. Many cold server instances, a larger snapshot or repeated browse requests can raise costs. Shared persistent caching or indexed candidate retrieval becomes worth evaluating before the largest tier.

Convex Starter is modelled through 100,000 monthly checks and Professional thereafter. Using Professional earlier adds a $25 developer subscription and changes included allowances. A personal noncommercial prototype may fit free hosting; the table budgets Vercel Pro for a public service.

## Published prices used

Vercel Pro starts at $20/developer/month with $20 eligible usage credit. [Vercel pricing](https://vercel.com/pricing)

Flat Rate CDN must be enabled in the account. Its included tier covers 1M requests/1 TB; additional tiers cost $20 for 10M, $100 for 50M and $300 for 150M requests. It does not cover function compute or origin transfer. [Flat Rate CDN](https://vercel.com/docs/pricing/flat-rate-cdn)

The model uses iad1 CPU $0.128/hour, memory $0.0106/GB-hour and origin transfer $0.06/GB, plus function invocations at $0.60/million. [Regional rates](https://vercel.com/docs/pricing/regional-pricing/iad1), [function pricing](https://vercel.com/pricing)

Convex Starter has no base fee, with 1M calls, 1 GB I/O and 1 GB egress included; extra calls cost $2.20/million and I/O/egress are $0.22/$0.132 per GB. Professional is $25/developer, with 25M calls and 50 GB each I/O/egress included; extra rates are $2/million calls and $0.20/$0.12 per GB. [Convex pricing](https://www.convex.dev/pricing)

Non-US Convex usage carries a 30% regional surcharge. The table does not apply it. [Convex regions](https://docs.convex.dev/production/regions)

## Recalculate from observed traffic

Snapshot traffic in GB = checks × cache-miss fraction × snapshot bytes ÷ 1,000,000,000. On Professional, each additional snapshot GB can add approximately $0.32 across I/O and egress once allowances are exhausted, before calls and index overhead.

The estimate counts each fetched snapshot toward both I/O and egress. Convex query caching can reduce I/O; index overhead and extra mutations can increase it. The table subtracts each plan's included allowances, applies the Vercel usage credit to eligible usage and adds the applicable CDN tier.

At 10M monthly checks with 10% misses, doubling a 5 MiB snapshot to 10 MiB adds roughly $1,680/month in database traffic. Inference remains zero in both cases. The all-miss column also implies about 250M monthly Convex calls at the largest tier; it is a warning to improve data retrieval before that scale, not a capacity claim.

Measure regional compact bytes, snapshot misses/pages, database I/O/egress, API CPU/duration, metadata lookup rate and total CDN requests. Confirm the account's region, seats, plan, Flat Rate CDN and spend controls. None of those account settings was changed by this implementation.
