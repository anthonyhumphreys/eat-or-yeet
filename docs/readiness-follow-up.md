> This record describes the previous Convex deployment. Cloudflare rollout and its separate acceptance checks are documented in [Cloudflare deployment](cloudflare-deployment.md).

# Readiness review follow-up

Updated 2026-10-07. Implementation is local; the public deployment has not been updated by this work.

## Decision and implementation

[ADR 0001](adr/0001-remove-ai.md) records the accepted decision to remove AI. Photo capture, `/api/analyse`, the vision helper, AI dependencies and OpenRouter configuration are removed. Barcode scanning and manual entry remain, with common fields first and optional label details behind an expandable section. Scanning fills the form so users can add batch/date evidence before checking.

## Review findings addressed

| Review finding | Result |
| --- | --- |
| Unidentified or incomplete evidence returns a reassuring result | GTIN validation, meaningful product identification, nonempty data and live source-health requirements gate negative results. The public label is “No matching warning found”. Missing retailer prefixes and partial product descriptions can produce conservative warning matches. |
| Incomplete or incorrectly expired recalls | Complete validated FSA, FDA enforcement, FDA announcement and USDA FSIS listings; explicit lifecycle handling; no arbitrary 180-day expiry. Previously imported FDA enforcement records absent from the ongoing list are reconciled by recall number. |
| Product A combines with product B's batch or missing date | Product groups and date constraints are retained. Missing, unparsed or contradictory evidence prevents confirmation. Producer/facility matches do not confirm a different named product. |
| Vulnerable runtime dependencies | Next.js and ESLint configuration updated to 16.3.6; production audit reports zero vulnerabilities. Development CLI moved out of runtime dependencies; compatible transitive patches consolidated. |
| Cookie rotation bypasses abuse limits | Signed browser and salted trusted-network limits apply together. Missing secrets or unsupported production proxy configuration fail closed. JSON bodies and upstream responses are bounded; failures return controlled errors. AI spending paths are removed. |
| Shares disclose entered identifiers or outlive their context | Generic share wording excludes entered product details and identifiers. Shares include check time, regions and scope, expire after 24 hours, and qualify the social preview. Legacy shares missing metadata do not expose old input-derived or reassuring copy. Canonical HTTPS origin is required in production. |
| Phone photos exceed hosting payload limit | Photo upload feature removed. |
| Full raw datasets fetched on every check | Separate compact matching records, indexed pages of 100, five-minute worker cache and successful-source-version invalidation. Health is checked on every request. |
| Unbounded cleanup can stop ingestion | Indexed cleanup batches run separately, with scheduled continuation. Each official source refresh runs independently; manual refresh returns 202 when queued. |
| Camera, sharing and accessibility failures | Camera startup/cancellation handling, visible manual fallback during permission requests, clipboard/network fallbacks, skip link and result focus implemented. |

Negative checks depend on the covered official sources and supplied label details. They do not establish that food is safe. Failures, partial imports and source refreshes older than 48 hours block a negative result. A source refresh in progress also temporarily blocks it.

## Verification completed

- `pnpm test`: 88 tests passed in 12 files.
- `pnpm lint`, TypeScript checks and `pnpm build`: passed.
- Desktop/mobile Playwright browser suite: 12 tests passed, including qualified result copy, focus, share failure handling and camera denial. These use controlled API responses and do not validate a newly deployed Convex backend.
- Production dependency audit: zero findings. Full audit retains one high-severity development-only `braces@3.0.3` finding in the ESLint chain, with no patched version listed at review time. [Advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
- Read-only live source imports: FSA 1,361 alerts; FDA enforcement 1,066 ongoing recalls; FSIS 1,241 English notices (101 active); FDA announcements 768 notices (531 active). Listing completeness checks and all required detail fetches passed. No Convex writes were made.
- Bounded desktop/mobile visual inspection and `git diff --check`: passed.

## Remaining launch work

1. Deploy the new Convex schema/functions to a preview first, then run a complete refresh. Existing incident rows alone do not populate the new matching table and health ledger.
2. Verify known warnings, negative eligibility, failed refreshes and sharing against that preview backend. Test physical barcode scanning on iPhone Safari and Android Chrome; browser camera denial tests do not verify camera hardware.
3. Configure the required production secrets, trusted hosting path and canonical origin; revoke the unused external AI credential. Confirm demo data is disabled and inspect billing limits, alerts and source freshness in the dashboards.
4. Deploy Convex before Next and inspect the initial successful imports before promoting. Begin with a bounded beta and measure latency, source health, snapshot cache misses and database traffic.

Production environment settings, provider spend controls and load capacity remain unverified. The hourly limiter permits a burst across hour boundaries, and shared network addresses pool users. See the deployment assumptions in [README](../README.md).

## Updated running costs

See [cost estimate](cost-estimate.md) for assumptions, current vendor prices and sensitivity. AI inference and packaging uploads cost zero. The planning model estimates roughly $40/month for 100,000 checks and $220/month for one million checks with a 90% matching-snapshot cache hit rate. That cache hit rate is an assumption, not a benchmark; the corresponding all-miss scenarios are about $210 and $1,730.
