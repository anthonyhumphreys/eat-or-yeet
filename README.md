# Eat or Yeet

A mobile-first packaged-food recall checker. Scan a barcode or enter label details, then compare them with official UK and US warnings. The app uses deterministic matching, with no AI or photo uploads. See [ADR 0001](docs/adr/0001-remove-ai.md).

## Result language

- **YEET**: a confirmed or probable warning match. Follow the linked official advice.
- **MAYBE YEET**: a possible or contextual match. Check the product and warning details.
- **No matching warning found**: no warning matched the evidence in the displayed coverage. This does not establish that food is safe.
- **NO CLUE**: insufficient evidence or missing, failed or stale source data.

The internal `EAT` enum remains for stored-result compatibility. It is not the public label. An unidentified barcode, an empty dataset or an incomplete refresh must not produce a reassuring negative result. Product, lot and date evidence must belong to the same product group.

## Stack and setup

Next.js 16 App Router, React 19, strict TypeScript, Tailwind CSS 4, shadcn/ui components, Cloudflare Workers, D1, Queues and R2, native BarcodeDetector with a ZXing fallback, Zod, Vitest and Playwright.

Requires Node.js 24+ and pnpm 10+. Choose the setup that matches how you contribute.

### Local development

You do not need a Cloudflare or Vercel account to contribute. Run:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

The launcher creates missing local secrets, applies D1 migrations, starts Wrangler and Next.js, and seeds fictional examples when enabled. Existing configuration is preserved. Local data stays in `.wrangler/state/`. Ctrl-C stops both servers. See [CONTRIBUTING.md](CONTRIBUTING.md) for checks and development data.

For a separately managed staging backend, set `BACKEND_ENV=staging`, an HTTPS `BACKEND_URL` and its `BACKEND_SECRET`. `pnpm dev` then starts only Next.js. Production targets are rejected by this launcher.

## Environment

| Variable | Purpose |
| --- | --- |
| `BACKEND_URL` | Private server-to-server Worker URL, shared by the selected Vercel environment |
| `BACKEND_SECRET` | Website credential; must agree in Next.js and the Worker |
| `BACKEND_ADMIN_TOKEN` | Separate operator credential; keep out of Vercel and browsers |
| `FSIS_UPLOAD_TOKEN` | Dedicated USDA importer credential; cannot call general backend operations |
| `BACKEND_ENV` | Local launcher selection: `local` or `staging` |
| `RATE_LIMIT_SALT` | Website identity, rate-limit and share hashing |
| `CRON_SECRET` | Website manual refresh route |
| `NEXT_PUBLIC_APP_URL` | Canonical website origin |
| `ALLOW_DEMO_DATA` | Fictional development incidents only; false in hosted stages |
| `FSIS_FETCH_MODE` | Worker setting: `snapshot` uses the external USDA fetcher |

All backend credentials stay server-side. The frontend build no longer deploys backend resources. See [Cloudflare deployment](docs/cloudflare-deployment.md) for provisioning, migration, secrets and cutover.

## Coverage and operations

Imports use official FSA warnings for the UK, and FDA food, beverage and dietary-supplement recall announcements, FDA food enforcement records and USDA FSIS recalls/public health alerts for the US. These sources have different scopes; the check shows its coverage.

FDA drug enforcement records are imported for browsing under Medical (and Baby, for infant medicines). These are published reports, not verified current recalls: [FDA does not update drug-enforcement status after publication](https://open.fda.gov/apis/drug/enforcement/). They use a separate `reported` status, carry an unverified-current-status notice and never become the top alert. Pack checks, MCP/Notion warning tools and their source-health gate cover food sources only. Set `OPENFDA_API_KEY` on the Cloudflare production Worker, not just Vercel, to lift openFDA's shared 1,000-requests-a-day limit.

Importers check pagination and reject incomplete responses. Warnings are not assumed resolved after an arbitrary age. Only explicit source resolution removes a warning from active matching. Original payloads remain for audit; checks read a separate compact matching table.

Each source has an ingestion ledger. A missing source, a latest failed/incomplete attempt or a successful refresh older than 48 hours blocks a negative result. Source health is checked on every request. Next caches compact datasets for up to five minutes per server instance and invalidates them when the successful source versions change. The Worker refreshes each source independently every day. Cleanup runs separately in bounded batches.

USDA currently blocks requests from our hosted runtimes. `pnpm data:sync:fsis --prod` fetches the complete official archive from a working connection and imports it through an admin-only snapshot action. The [NAS container](docs/usda-sync.md#nas-container) runs this daily from a home connection, retries failures hourly and reports import health. Only active notices and tracked closures create rows. External sync mode keeps the failed direct fetch out of the daily cron; source freshness still expires after 48 hours. See [USDA snapshot sync](docs/usda-sync.md) for setup and limitations.

Public browsing shows 50 warnings per page and reads only the selected country. Its separate cache revalidates every minute. Publisher news loads independently and caches validated articles per publisher for 30 minutes. Failed refreshes retain that publisher's last successful feed, with stories still subject to the 180-day age limit. These caches do not change the source-health checks used for food-check results.

On a first visit, a region prompt suggests UK or US from Vercel's request country hint, or the browser's timezone and regional language setting when that hint is unavailable. The user confirms their warning region, and the existing region cookie remembers that choice. Suggestions do not change coverage automatically. The header selector remains available to change the region; check flows do not repeat the question after a choice.

Once a region is chosen, scanning a barcode runs the check immediately. Product lookup supplies a name and brand when available. Label details are optional from the result, including when the barcode could not be identified or a batch needs checking. A failed request offers a retry without requiring label entry.

A barcode with a product name and brand from lookup can identify a one-word name such as Oreo. Short names can flag possible warnings but cannot confirm a specific pack from a batch alone. An inconclusive check distinguishes missing product evidence from incomplete warning data. Failed, missing or stale source data still blocks a negative result; the result explains the unavailable source and offers another check without asking for label details.

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/incidents
```

The route returns HTTP 202 when jobs are queued; this does not mean an import succeeded. Watch completed/failed runs in D1 and investigate before treating coverage as healthy. External alerts and billing caps require hosting-account configuration; local code does not enable them.

## Privacy and limits

The app accepts no photos and stores no scan history. A barcode lookup may send the barcode to Open Food Facts. Lookup metadata supplies only name and brand, never inferred producer or country of origin. Unknown lookup responses are cached briefly.

Checks and share creation are limited by both a signed browser cookie and a salted network identifier. Stored records contain hashes, action, time bucket and counts. Production trusts the Vercel client-address path. Before moving hosts, implement a documented trusted-proxy integration; an arbitrary forwarded header is insufficient.

Public links require an explicit action. They contain generic result copy, official warning details where applicable, check time and coverage, exclude user-entered label details, and expire after 24 hours. They are historical checks and should be rerun. Legacy shares missing metadata do not display reassuring or input-derived copy.

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
pnpm audit --prod
```

Browser tests use deterministic fixtures. Importer tests cover pagination and parsing separately. Passing tests does not verify live production imports, every physical phone or spend controls.

## Rollout

Keep Next.js on Vercel. `pnpm build:vercel` builds only the frontend. Deploy the matching Worker and apply D1 migrations separately before changing Vercel's `BACKEND_URL` and `BACKEND_SECRET`.

The migration restores opaque identifiers and creation timestamps from a private Convex export. Validate all tables before writing, check table counts and foreign keys after restoring, then disable the operator restore flag. A fresh source import is still required whenever the restored source ledger is stale or incomplete.

Verify both regions, a known warning, insufficient evidence, stale and failed source coverage, public sharing, quotas and queued jobs before promotion. Keep the original backend and Vercel deployment for rollback. Preview deployments must use staging credentials and keep hosted Notion consent disabled until a separate live acceptance run succeeds.

Commands and the production cutover sequence are in [Cloudflare deployment](docs/cloudflare-deployment.md).

## Notion shopping integration

The managed Add to Notion flow uses same-app Vercel OAuth/webhook routes and Cloudflare installation state and review jobs. It provides native consent and copied-list setup without Notion AI, customer API keys or customer hosting. Production pilot tests have verified consent, signed events, reviews and disconnect. Automatic reviews are not yet generally available; outstanding live checks are recorded in the [readiness record](docs/operators/notion-readiness.md). Connection setup is withheld unless all required settings are present. The NAS runs the separate USDA snapshot importer, not customer Notion services. See the [customer overview](docs/notion-shopping.md), [installation plan](docs/notion-installation-plan.md), [managed service runbook](docs/operators/notion-managed-service.md) and optional [standalone worker runbook](docs/operators/notion-shopping-worker.md).

Connected lists require stored Notion identifiers and encrypted credentials. Our backend decrypts credentials to run reviews; pausing retains them and disconnect removes the connection. We do not save profile names, emails or shopping text as a history, but configured item fields can contain personal information supplied by a shopper. The public [privacy notice](https://www.eatoryeet.app/privacy) and [terms](https://www.eatoryeet.app/terms) describe these boundaries. Using the template without connecting gives Eat or Yeet no access to the Notion account or list.

## Analytics

Optional website and embedded-app analytics requires affirmative consent. Explicit MCP operation metrics contain no user identifiers or request contents. PostHog is disabled by default and blocked in Vercel previews. See [analytics setup and privacy boundaries](docs/operators/analytics.md).
