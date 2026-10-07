# Eat or Yeet

A mobile-first packaged-food recall checker. Scan a barcode or enter label details, then compare them with official UK and US warnings. The app uses deterministic matching, with no AI or photo uploads. See [ADR 0001](docs/adr/0001-remove-ai.md).

## Result language

- **YEET**: a confirmed or probable warning match. Follow the linked official advice.
- **MAYBE YEET**: a possible or contextual match. Check the product and warning details.
- **No matching warning found**: no warning matched the evidence in the displayed coverage. This does not establish that food is safe.
- **NO CLUE**: insufficient evidence or missing, failed or stale source data.

The internal `EAT` enum remains for stored-result compatibility. It is not the public label. An unidentified barcode, an empty dataset or an incomplete refresh must not produce a reassuring negative result. Product, lot and date evidence must belong to the same product group.

## Stack and setup

Next.js 16 App Router, React 19, strict TypeScript, Tailwind CSS 4, shadcn/ui components, Convex Cloud, native BarcodeDetector with a ZXing fallback, Zod, Vitest and Playwright.

Requires Node.js 24+, pnpm 10+ and a Convex account.

```bash
pnpm install
cp .env.example .env.local
pnpm exec convex dev --once
```

Generate separate random secrets for `CONVEX_SERVER_SECRET`, `RATE_LIMIT_SALT` and `CRON_SECRET`, and put them in `.env.local`. Set the same server secret on the development Convex deployment:

```bash
pnpm exec convex env set CONVEX_SERVER_SECRET
pnpm dev
```

Next loads `.env.development.local` only in development. Values needed by both `pnpm dev` and `pnpm start` belong in `.env.local`, or must be supplied by the hosting environment. Keep development and production credentials separate.

Fictional data is opt-in and does not establish source health. Set local `ALLOW_DEMO_DATA=true`, then:

```bash
pnpm exec convex env set ALLOW_DEMO_DATA true
pnpm data:seed
```

Never enable demo data in production.

## Environment

| Variable | Purpose |
| --- | --- |
| `CONVEX_DEPLOYMENT` | Convex CLI deployment selection |
| `CONVEX_DEPLOY_KEY` | Vercel build credential, scoped separately to production/preview |
| `NEXT_PUBLIC_CONVEX_URL` | Matching Convex deployment URL |
| `CONVEX_SERVER_SECRET` | Server-only mutations/refreshes; must agree in Next and Convex |
| `RATE_LIMIT_SALT` | Required signing/hash secret for identity, rate limits and shares |
| `CRON_SECRET` | Protects manual incident refresh |
| `NEXT_PUBLIC_APP_URL` | Canonical deployed HTTPS origin |
| `ALLOW_DEMO_DATA` | Fictional development incidents only |

There are no model credentials. Remove obsolete OpenRouter variables and revoke unused credentials in the provider dashboard during rollout.

## Coverage and operations

Imports use official FSA warnings for the UK, and FDA recall announcements, FDA food enforcement records and USDA FSIS recalls/public health alerts for the US. These sources have different scopes; the check shows its coverage.

Importers check pagination and reject incomplete responses. Warnings are not assumed resolved after an arbitrary age. Only explicit source resolution removes a warning from active matching. Original payloads remain for audit; checks read a separate compact matching table.

Each source has an ingestion ledger. A missing source, a latest failed/incomplete attempt or a successful refresh older than 48 hours blocks a negative result. Source health is checked on every request. Next caches compact datasets for up to five minutes per server instance and invalidates them when the successful source versions change. Convex refreshes each source independently every day. Cleanup runs separately in bounded batches.

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/incidents
```

The route returns HTTP 202 when jobs are queued; this does not mean an import succeeded. Watch completed/failed runs in Convex and investigate before treating coverage as healthy. External alerts and billing caps require hosting-account configuration; local code does not enable them.

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

For Git-triggered Vercel builds, use `pnpm build:vercel` as the Vercel Build Command. This invokes Convex deployment and supplies the matching backend URL to Next. Dashboard credentials, preview isolation and the first import are covered in [Convex deployment automation](docs/convex-deployment.md). Local `pnpm build` remains a frontend-only build.

Deploy the Convex schema/functions to a preview/development deployment first. Run a complete import to populate the compact matching table and source ledger; old incident rows alone do not satisfy the health gate. Verify both regions, a known warning, insufficient evidence, a failed refresh, camera denial and public sharing against the preview.

Configure production secrets and canonical origin. Deploy Convex before Next, run and inspect the initial source refresh, and confirm rate limits/spend alerts in the dashboards. Do not promote while required source health is missing or failing.

```bash
pnpm convex:dev
pnpm convex:deploy
```

Deployment is separate from this local implementation. See the revised cost assessment for assumptions and remaining production checks.
