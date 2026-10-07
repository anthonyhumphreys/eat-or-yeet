# No-AI readiness and costs

Updated 7 October 2026. Changes are implemented locally.

## Accepted architectural decision

ADR 0001 removes AI extraction, photo uploads, the analysis API, AI dependencies and OpenRouter configuration.

Barcode scanning and manual entry remain. Common fields appear first; additional label details are optional. Scanning fills the form so users can add batch and date evidence before checking.

Official-source rules determine results. Missing evidence or unhealthy data preserves uncertainty. The negative public label is “No matching warning found”, qualified by check time and coverage.

The accepted ADR is recorded in `docs/adr/0001-remove-ai.md`.

## Review fixes delivered

- Validated barcodes and negative-result eligibility.
- Preserved product, batch and date associations; prevented cross-product confirmation.
- Completed validated imports for FSA, FDA enforcement, FDA announcements and USDA FSIS, with explicit resolution handling.
- Added source-health records and a 48-hour freshness gate.
- Replaced raw matching responses with compact paginated records and a five-minute cache.
- Separated ingestion from bounded cleanup.
- Added trusted-network throttling, bounded request/response parsing and controlled failure responses.
- Sanitised public shares, added check time and coverage, shortened expiry to 24 hours and required a production HTTPS origin.
- Patched runtime dependencies.
- Fixed camera cancellation, manual fallback, sharing failures, skip navigation and result focus.

## Verification

88 unit tests and 12 desktop/mobile browser tests passed. TypeScript, lint and the production build passed.

Read-only live imports succeeded:

| Source | Notices returned | Active |
| --- | ---: | ---: |
| FSA | 1,361 | 1,361 |
| FDA enforcement | 1,066 | 1,066 |
| USDA FSIS, English notices | 1,241 | 101 |
| FDA announcements | 768 | 531 |

Production dependencies have zero audit findings. The development ESLint chain retains an unpatched high-severity `braces` advisory. [Advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)

## Monthly running costs

AI inference and packaging uploads cost **$0**. Database traffic remains the main scaling uncertainty.

Planning estimates use one paid Vercel developer, US-region Convex, ten checks per monthly active user and a 5 MiB average regional matching snapshot. That snapshot size and a 90% cache hit rate are assumptions requiring production measurement.

| Monthly active users | Checks/month | 90% snapshot-cache hits | Every check reloads snapshot |
| ---: | ---: | ---: | ---: |
| 100 | 1,000 | ~$20 | ~$22 |
| 1,000 | 10,000 | ~$22 | ~$40 |
| 10,000 | 100,000 | ~$40 | ~$210 |
| 100,000 | 1,000,000 | ~$220 | ~$1,730 |
| 1,000,000 | 10,000,000 | ~$2,170 | ~$17,630 |

These calculations use published [Vercel pricing](https://vercel.com/pricing), [Flat Rate CDN tiers](https://vercel.com/docs/pricing/flat-rate-cdn), [iad1 compute rates](https://vercel.com/docs/pricing/regional-pricing/iad1) and [Convex pricing](https://www.convex.dev/pricing).

Taxes, domains and engineering/support time are excluded. The last column is a stress scenario, not an expected bill or capacity guarantee. Improve shared caching or indexed candidate retrieval before the largest scale.

Full assumptions and sensitivity calculations are recorded in `docs/cost-estimate.md`.

## Before public sharing

1. Deploy the Convex changes to preview and run a complete import.
2. Verify real checks and sharing against that backend.
3. Test physical scanning on iPhone Safari and Android Chrome.
4. Confirm production secrets, canonical origin, demo-data settings and spending alerts; revoke the unused AI credential.
5. Deploy Convex before Next, inspect source health and begin with a bounded beta.

Production settings and load capacity remain unverified. A negative check describes the covered warnings and supplied evidence; it does not establish that food is safe.