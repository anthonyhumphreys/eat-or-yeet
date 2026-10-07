Reviewed 7 October 2026. Repository HEAD: 5b7aab6. Public deployment inspected at https://eat-or-yeet.vercel.app.

The app is a working MVP, but it is not ready for unrestricted public sharing as a food recall checker. I recommend fixing the safety, dependency, and privacy findings before inviting public users.

The architecture has sensible foundations. AI transcribes packaging, deterministic rules produce verdicts, warnings link to official sources, server mutations require a secret, and sharing requires an explicit action. Those choices are worth keeping.

## What was verified

| Check | Result |
|---|---|
| Unit tests | 18 passed |
| TypeScript | Passed |
| ESLint | Passed |
| Production build | Passed |
| Deployed browser smoke tests | All 10 passed across desktop Chrome and emulated mobile Chrome |
| Live photo analysis | Passed. A synthetic packaging label returned the expected fields in about 6.6 seconds |
| Dependency audit | Failed. 30 findings: 2 critical, 10 high, 15 moderate, 3 low |
| Local production browser tests | 8 passed, 2 failed because Convex rejected the missing production-mode signing secret |

The local signing secret is in `.env.development.local`, which `next start` does not load. That explains the local failures. The deployed manual check succeeds.

The existing photo smoke test mocks both API responses. The separate live synthetic-label check verified an actual extraction request, but does not establish accuracy on real packaging.

No application code or deployment settings were changed.

## Findings that block public launch

### 1. Unrecognised or incomplete evidence can produce “EAT”

Locations: `src/lib/matching/matcher.ts:181`, `src/lib/matching/matcher.ts:196`, `src/app/api/check/route.ts:28`.

Reproduced on the deployed app:

- Barcode `123` returned EAT.
- An unrecognised barcode returned EAT without identifying a product.
- `Mozzarella Pearls & Pesto Orzo Salad` returned EAT.
- The full name `Tesco Finest Mozzarella Pearls & Pesto Orzo Salad` returned MAYBE YEET against the known warning.

The matcher requires exact normalised text equality. A missing retailer prefix can therefore turn a recalled product into an unmatched result.

Local fixtures also returned EAT for an identified product against an empty incident array, and for unmatched OCR evidence with confidence 0.05. There is no dataset freshness gate or extraction-confidence gate.

Required change: validate barcodes, distinguish unidentified products from adequate negative checks, and return NO CLUE or an unavailable result when evidence or source coverage is insufficient. Display “No matching warning found” as the primary negative result. “EAT” currently implies more confidence than the implementation supports.

### 2. Recall coverage is incomplete and resolution handling is unreliable

Locations: `src/lib/incidents/fda.ts:44`, `src/lib/incidents/fsa.ts:110`, `src/lib/incidents/fda-announcements.ts:197`, `convex/incidents.ts:90`.

Each refresh fetches only:

- 100 FDA enforcement records.
- 100 FSA alerts.
- 50 FDA announcements.

The official FDA endpoint reported 1,066 ongoing records during this review. The enforcement importer reads the newest 100 without pagination. Previous daily imports retain some older records, but that does not establish complete coverage.

The enforcement query only requests ongoing recalls. Once an imported record becomes completed or terminated and disappears from that query, the importer never updates its status. Those records have no expiry.

FSA and announcement records instead receive an arbitrary 180-day expiry. Shelf-stable recalled food can remain in homes beyond that window.

US coverage also omits USDA FSIS. The FDA explicitly directs consumers to FSIS for USDA-regulated product recalls. [FDA recall guidance](https://www.fda.gov/food/buy-store-serve-safe-food/food-recalls-what-you-need-know)

Required change: paginate imports, reconcile status changes, document supported sources and lookback coverage, and add freshness monitoring. Until coverage expands, describe the US option as FDA coverage.

The configured development deployment's latest ingestion runs completed without recorded errors. That confirms execution, not completeness.

### 3. Independent product and batch matches can falsely become “confirmed”

Locations: `src/lib/incidents/fsa.ts:41`, `src/lib/incidents/fda-announcements.ts:127`, `src/lib/matching/matcher.ts:129`.

Importers flatten all products, barcodes, and lots in a notice into one target array. The matcher then confirms any identity plus any matching batch or lot.

A fixture with product A's barcode and product B's lot returned confirmed YEET. The matcher cannot preserve which lot belongs to which product.

Another fixture returned confirmed YEET despite missing a required date. It simultaneously instructed the user to supply that date to confirm the match.

FSA date descriptions are generally retained only as batch notes, and are discarded when no batch code exists. The Tesco notice's affected dates were present in its raw source data but absent from its match targets.

Required change: preserve product-to-batch relationships and date constraints. Missing required evidence must prevent confirmation.

### 4. The pinned Next.js version has a critical advisory

Locations: `package.json:27`, `src/app/s/[id]/opengraph-image.tsx:13`.

Next.js 16.3.3 falls within the affected range for the critical Node.js `next/og` ImageResponse remote-code-execution advisory. The patch is 16.3.6. The advisory's conditions involve attacker-controlled SVG content, attributes, or styles. This app renders user-influenced share content through ImageResponse, so the dependency should be patched before wider sharing. Exploitability was not demonstrated. [Next.js security advisory](https://github.com/advisories/GHSA-vcvr-r3jv-pc5j)

The audit also flags Next.js transitive dependencies and packages brought in through the shadcn CLI dependency. Package findings do not prove that every vulnerable path is reachable in this app.

Required change: upgrade Next.js and its matching ESLint configuration, resolve remaining relevant runtime advisories, and move development tooling out of production dependencies where appropriate.

### 5. Cookie limits do not prevent anonymous spending abuse

Locations: `src/lib/security/anonymous.ts:26`, `src/lib/security/rate-limit.ts:11`, `src/lib/ai/extract.ts:35`.

The photo allowance is 10 requests per browser per hour. Omitting or deleting the cookie creates a new identity and resets the allowance. Signing the cookie prevents tampering but does not prevent replacement.

The extraction call has no explicit output-token cap, request abort deadline, or app-wide photo budget.

Required change: combine browser limits with trusted network-level throttling and bot controls for expensive actions. Add output limits, an abort deadline, a photo-disable switch, and provider spending caps. Preserve manual checks when photo analysis is disabled.

Provider-level controls may already exist, but they were not verified.

### 6. Public-share reasons leak evidence excluded by the privacy promise

Locations: `src/lib/security/share-token.ts:36`, `src/app/api/share/route.ts:30`, `src/app/privacy/page.tsx:12`.

The share token copies the first matching reason verbatim. That reason can contain a barcode, batch, or lot.

A live barcode-and-lot check produced a signed share payload containing:

`Barcode 00794711005484 matches the warning.`

The share route stores that reason unchanged. I inspected the signed payload without creating a new public link.

Required change: create share-specific wording that excludes evidence codes. Add tests for the whole persisted share payload.

Shares also lack the original check time and dataset region. An EAT share can remain available for 30 days after a new warning appears. Include those details, require rechecking, and put the safety qualification into the social-preview image itself.

### 7. Accepted photo sizes exceed Vercel's request limit

Locations: `src/app/api/analyse/route.ts:30`, `src/components/scanner/photo-picker.tsx:14`.

The app accepts photos up to 8 MB, but Vercel Functions limit request payloads to 4.5 MB. Larger phone photos can fail before the route handles them. [Vercel payload limit](https://vercel.com/docs/errors/function_payload_too_large)

Required change: resize and encode photos before upload, enforce a lower client limit with room for multipart overhead, and handle non-JSON server errors. Verify HEIC/HEIF with real iPhone photos.

## Scaling and follow-up work

`convex/incidents.ts:50` returns every active regional incident, including raw source payloads, on each check. The Next.js Convex helper uses uncached HTTP fetches.

Measured against the configured development deployment:

| Region | Active incidents | JSON response |
|---|---:|---:|
| UK | 59 | 482,767 bytes |
| US | 300 | 832,316 bytes |

Return only matching fields, or match against indexed candidates inside Convex. A short-lived cache must include source freshness and deliberate invalidation.

`convex/incidents.ts:112` collects and deletes all expired shares and rate-limit rows in one mutation. Convex limits transaction reads and writes to 16 MiB and scanned documents to 32,000. A sufficiently large cleanup fails, and cleanup runs before ingestion. Batch cleanup and separate its failures from recall refreshes. [Convex limits](https://docs.convex.dev/production/state/limits)

Other follow-ups:

- `src/components/scanner/scan-flow.tsx:74`: additional photos replace previous observations instead of combining evidence.
- `src/components/scanner/barcode-camera.tsx:24`: camera startup needs cancellation handling and real iPhone Safari testing.
- `src/components/verdict/verdict-view.tsx:75`: public-link network and clipboard failures need error handling.
- `src/app/layout.tsx:39`: add a skip link and verify focus after result changes.
- `src/app/privacy/page.tsx:10`: separate app image retention from upstream provider retention. Code does not enforce zero-retention routing; account settings were not inspected. [OpenRouter retention controls](https://openrouter.ai/docs/guides/features/zdr)

## Monthly running-cost estimates

These are planning budgets for the current implementation, not invoices or load-tested capacity guarantees.

Assumptions:

- 10 checks per monthly active user.
- 25% of checks use one photo extraction.
- An even UK/US split and the current dataset sizes.
- One paid Vercel developer seat, Fluid Compute in the deployment's `iad1` region, and Flat Rate CDN enabled.
- Convex Starter for small usage, Professional when its allowances make sense.
- Ordinary photo inference costing $0.001–$0.005 per request.
- Roughly 1 MB uploaded photos and 15 seconds per extraction for compute planning.
- Roughly six CDN requests per check, including page and asset traffic.
- No attack traffic, extraordinary retries, or substantial additional browsing.

| Monthly active users | Checks/month | Photos/month | Planning budget, USD/month |
|---:|---:|---:|---:|
| 100 | 1,000 | 250 | $20–30 |
| 1,000 | 10,000 | 2,500 | $25–45 |
| 10,000 | 100,000 | 25,000 | $60–200 |
| 100,000 | 1,000,000 | 250,000 | $450–1,800 |
| 1,000,000 | 10,000,000 | 2,500,000 | $4,500–18,000 |

Exclude VAT, currency conversion, credit-purchase fees, domains, optional monitoring, support, and engineering time. Existing paid seats can reduce incremental costs; other projects can consume shared allowances.

The largest uncertainties are photo token usage, provider routing, Convex query-cache effectiveness, dataset growth, and actual traffic patterns. Correcting the incomplete recall imports will also increase data volume unless queries improve.

### Pricing basis

Vercel Pro starts at $20 per developer/month and includes $20 in eligible usage credit. Current Flat Rate CDN tiers include 1 million requests and 1 TB with Pro, then cost an additional $20 for 10 million requests, $100 for 50 million, or $300 for 150 million. Compute and Fast Origin Transfer remain separate costs. [Vercel pricing](https://vercel.com/pricing), [CDN tiers](https://vercel.com/docs/pricing/flat-rate-cdn)

In `iad1`, CPU costs $0.128/hour, memory $0.0106/GB-hour, and Fast Origin Transfer $0.06/GB. Memory billing continues while waiting for AI responses; uploaded photo bytes count toward origin transfer. [Regional rates](https://vercel.com/docs/pricing/regional-pricing/iad1), [Transfer accounting](https://vercel.com/docs/manage-cdn-usage)

Convex Starter has no fixed fee and meters usage beyond its free allowances. Professional costs $25 per developer/month. US Professional allowances include 25 million function calls, 50 GB of database I/O, and 50 GB of egress; additional I/O costs $0.20/GB and egress $0.12/GB. [Convex pricing](https://www.convex.dev/pricing)

The current OpenRouter model catalog reports GLM 5.3 Flash pricing of $0.15 per million input tokens and $0.50 per million output tokens. Providers differ and cheaper routes exist. A 4,000-input/1,000-output-token request is approximately $0.0011 before fees or extra reasoning. The budget allows more for reasoning and retries; it is not a hard cap. [OpenRouter model catalog](https://openrouter.ai/api/v1/models), [Model providers](https://openrouter.ai/z-ai/glm-5.3-flash)

### Why the current queries matter

At one million checks, the measured regional response sizes imply approximately 660 GB of Convex-to-server transfer.

On Convex Professional, that alone is about $73 in egress overage. If database reads incur a comparable volume, they add roughly $122. Query caching can reduce database I/O, but repeatedly returning the full dataset still incurs transfer.

At the assumed photo share, one million checks also means 250,000 extractions: approximately $250–1,250 in inference. Barcode and manual checks do not call an AI model.

The local environment contains older Neon configuration, but current application code uses Convex. Neon is excluded from these estimates; any existing Neon bill should be checked separately.

## Recommended launch gates

1. Patch dependencies and rerun required checks.
2. Fix negative verdict eligibility, grouped product/batch matching, date handling, and confidence handling.
3. Complete and reconcile imports, expose freshness, and block negative verdicts when coverage is unavailable.
4. Fix share sanitisation and historical-result presentation.
5. Add effective spending controls and phone-photo preprocessing.
6. Test those cases on a preview deployment and real iPhone Safari and Android Chrome.
7. Begin with a bounded beta, measuring extraction cost, latency, failure rate, source freshness, and database transfer.

Production environment inspection was denied by the Vercel connector, and no Vercel CLI was available. Production spending controls, demo-data settings, OpenRouter retention settings, and billing usage therefore remain unverified. No load test or exploit test was performed.