# Contributing to Eat or Yeet

Contributions to code, tests, documentation, accessibility and official-source parsing are welcome. For bugs, include reproduction steps and expected behaviour. Discuss changes to coverage, matching rules or architecture in an issue before starting substantial work.

## Account-free local setup

Use Node.js 24+ and the pnpm version in `package.json`:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

The launcher creates `.env.local` and `.dev.vars` when needed, generates separate credentials, applies local D1 migrations, starts Wrangler on port 8787 and Next.js on port 3000, and seeds fictional examples when enabled. Existing files and secrets are preserved. Worker credentials must agree with the Next.js environment. Stop both processes with Ctrl-C.

Local D1, R2 and Queue state lives in `.wrangler/state/`. Use `pnpm exec wrangler d1 execute DB --local --command 'SELECT table_name, COUNT(*) FROM records GROUP BY table_name'` to inspect row counts. Wrangler prints backend logs in the development terminal.

For a separately managed staging backend, set `BACKEND_ENV=staging`, its HTTPS `BACKEND_URL` and `BACKEND_SECRET`. The launcher starts only Next.js and does not mutate that backend. `pnpm dev:web` also starts Next.js alone. `.env.development.local` overrides `.env.local`; restart after configuration changes.

## Development data

The local default enables clearly marked fictional incidents. Examples include barcode `5000000000005`, batch `24182`, and product name `Northstar Peanut Bites`. Set `ALLOW_DEMO_DATA=false` in `.env.local` and restart to exclude demos from checks and disable further seeding. Previously seeded rows remain in the local database.

To reseed while the backend is running:

```sh
pnpm data:seed
```

The seed script loads `.env.local` and an optional `.env.development.local`; there is no need to create an empty overrides file.

Demo incidents do not establish healthy official-source coverage. A demo check can show matching evidence while its verdict remains `NO CLUE` until official coverage is available. Public warning lists exclude demo incidents. Use the existing test fixtures for controlled healthy, failed and stale source scenarios; there is no complete offline app fixture mode yet.

To exercise real ingestion on your local backend:

```sh
pnpm backend:run incidents.refreshAllInternal
```

This queues network requests to the official sources. Inspect completed ingestion runs in the Worker logs and D1 ingestion records; a queued job is not a successful import. Barcode enrichment and news feeds also make external requests. Never enable demo data on production.

## Checks

For code changes, run:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

The unit suite uses mocked dependencies and does not require cloud credentials. For UI or user-flow changes, install the browser and run the smoke tests too:

```sh
pnpm exec playwright install chromium
pnpm test:e2e
```

Playwright uses `pnpm dev:web` to start only Next.js unless an existing server is available. Start `pnpm dev` first for browser checks against your local backend. Some check/share responses are mocked; server-rendered warning pages still use your configured backend, and news can use the network. Keep the full development stack running. Browser tests do not verify live ingestion or physical camera hardware. Run `pnpm audit --prod` when changing dependencies. Documentation-only changes need link and command review.

## Infrastructure documentation

Start with the [architecture guide](docs/architecture.md) and [ADR 0002](docs/adr/0002-migrate-backend-to-cloudflare.md). Update these when changing storage, transaction guarantees, durable jobs or hosting boundaries. Operational commands belong in the [Cloudflare deployment guide](docs/cloudflare-deployment.md); dated cutover evidence and historical Convex measurements do not establish current live acceptance or capacity.

## Project conventions

- Use simple, explicit, strict TypeScript and follow nearby code. Explain new dependencies and abstractions.
- Read `AGENTS.md`. Before changing Next.js code, read the relevant installed guide in `node_modules/next/dist/docs/`.
- Preserve deterministic matching, source-health gates and the qualified result language in [README.md](README.md). An unmatched product is not proof that food is safe.
- Keep product, lot and date evidence within the same product group. Add regression coverage when changing matching or importer behaviour.
- Preserve privacy boundaries: no photo uploads or scan history, and no user-entered label details in public shares.
- Run `pnpm backend:generate` after changing operation exports. Run `pnpm backend:types` after changing Wrangler bindings. Commit the generated API, registry and binding types. New SQL schema changes need a numbered migration; do not rewrite an applied migration.

## Adding a country

Adding a country changes coverage, so open an issue first. Name the official food-safety authorities, their public feeds or APIs, terms of use, and what each source covers and leaves out. Only use official sources. A country is added only once every source it needs imports successfully. Until then, the source-health gate returns `NO CLUE` rather than a negative result.

Country codes, such as `UK` and `US`, are currently hard-coded in several places. Search for `"UK" | "US"`, `v.literal("US")` and `z.enum(["UK", "US"])` to find them all. A new country needs:

1. **Region type and validators.** Add the code to `src/lib/location.ts` (`regionNames` drives the location select, URL `region` parameter and cookie), `src/lib/domain/schemas.ts` (`RegionSchema` and the check request schema), `src/lib/domain/types.ts`, `src/lib/incidents/types.ts`, `src/db/queries.ts`, and the backend validators in `backend/schema.ts`, `backend/shares.ts` and `backend/incidents.ts`. Changing the schema validator affects existing deployments, so call it out in the PR.
2. **Importers.** Add one `IncidentSource` per official source in `src/lib/incidents/<source>.ts`, following `fsa.ts` or `fsis.ts`. Fetch through `fetchOfficialJson`/`fetchOfficialText`. Validate payloads with Zod, check pagination and reject incomplete responses. Keep `originalSourceData`, set a stable `sourceId`, and resolve warnings only when the source explicitly says so. Write an accurate `scope`, because the app shows it as coverage. Then register the source in the `sources` array in `backend/incidents.ts` and add an authority match to `inferSourceKey`. The daily cron and `refreshAllInternal` pick it up automatically.
3. **Matching targets.** Split products, barcodes, lot codes and dates into same-group targets so evidence stays within a single product. Add parser tests with sample payloads in `tests/incident-importers.test.ts` and matcher regression cases in `tests/matcher.test.ts`.
4. **Public links and copy.** Add the authority's official URL handling to `src/lib/incidents/public-source.ts`, then update `officialUrls` and the source label ("Newest first · …") in `src/components/incidents/warning-explorer.tsx`. Also update `listActivePublicIncidents` in `src/db/queries.ts`, which fetches each region by name.
5. **Locale-specific helpers (optional).** Review the shop names in `src/lib/incidents/browse.ts`, the hazard terms in `src/lib/incidents/hazard.ts`, and the news feeds and region detection in `src/lib/news/rss.ts`. Add local publishers or terms where they help. Dates are currently formatted as `en-GB`.
6. **Docs and tests.** Update the coverage paragraph in [README.md](README.md). Extend the `e2e/smoke.spec.ts` region helpers, and add `backend/seed.ts` demo rows if they help. Regenerate `backend/api.ts` and `backend/registry.ts` when operation exports change.

Check it locally with `pnpm backend:run incidents.refreshAllInternal`. Confirm that every new source finishes a successful ingestion run in the ingestion ledger and that a check for the new country reports healthy coverage.

## Pull requests and deployments

Keep PRs focused. Explain the problem, resulting behaviour and checks run. Include screenshots for visual changes and sample source payloads for parsing changes. State anything unverified and call out schema changes or required environment variables.

Do not commit secrets, `.env.local`, `.env.development.local`, local `.wrangler/` state, production exports or test reports. Review your diff before submitting.

Community PRs do not need deployment credentials. Maintainers provision isolated staging resources, verify hosted behaviour and manage production cutover. `pnpm build` and `pnpm build:vercel` build only Next.js. Backend deployments are separate. Follow [Cloudflare deployment](docs/cloudflare-deployment.md) for migrations, secrets, restores and rollback.

The unit suite includes real SQLite domain tests and a Miniflare test of Worker authentication and D1 transaction rollback. Local HTTP servers and workerd must be allowed by your execution environment.
