# Contributing to Eat or Yeet

Contributions to code, tests, documentation, accessibility and official-source parsing are welcome. For bugs, include reproduction steps and expected behaviour. Discuss changes to coverage, matching rules or architecture in an issue before starting substantial work.

## Community and core contributors

Community contributors fork the repository, work on a branch and submit a pull request. You do not need a seat on our Convex team, a Vercel account or production credentials. Run your own local Convex backend for app and backend work. Unit tests can run without a backend.

Core contributors are maintainers with access to the shared Convex project and hosting accounts. They review PRs, verify hosted integration behaviour and manage deployments. They can also use the local setup below. Repository access does not automatically grant hosted-service access.

## Account-free local setup

Use Node.js 24+ and the pnpm version declared in `package.json`. From a clone of your fork:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` creates `.env.local` if needed, generates missing local secrets, starts account-free local Convex, deploys and watches backend functions, synchronises the local backend secret, seeds fictional examples when `ALLOW_DEMO_DATA=true`, and starts Next.js. No account, manual secret copying or second server terminal is required. Existing settings and secrets are preserved. Stop both servers with Ctrl-C.

Open <http://localhost:3000>. The first run needs internet access to download the Convex backend and dashboard. Local deployments are currently beta; data stays in `.convex/`. See [Convex local deployments](https://docs.convex.dev/cli/local-deployments).

The default setup uses your local backend even if you have logged into Convex elsewhere. An existing personal cloud development selector is honoured instead; that path requires its matching `CONVEX_SERVER_SECRET` to be configured already. Automatic secret synchronisation and seeding happen only for a local backend. Deploy keys, production selectors and self-hosted credentials are rejected by this launcher. Use `pnpm dev:web` to run only Next.js with a separately managed backend.

Do not copy a maintainer's credentials. If local startup reports a conflicting backend URL, check shell variables and `.env.development.local`, which takes precedence over `.env.local`. Keep the frontend and backend pointed at the same deployment. Restart after changing environment variables.

To inspect local data and function logs, run `pnpm exec convex dashboard` in another terminal. `pnpm dev:app` is the launcher's internal startup hook; `pnpm convex:dev` remains available for running Convex separately.

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
pnpm exec convex run incidents:refreshAllInternal
```

This queues network requests to the official sources. Inspect completed ingestion runs in the local dashboard; a queued job is not a successful import. Barcode enrichment and news feeds also make external requests. Never enable demo data on production.

## Checks

For code changes, run:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

The unit suite uses mocked dependencies and does not require Convex credentials. For UI or user-flow changes, install the browser and run the smoke tests too:

```sh
pnpm exec playwright install chromium
pnpm test:e2e
```

Playwright uses `pnpm dev:web` to start only Next.js unless an existing server is available. Start `pnpm dev` first for browser checks against your local backend. Some check/share responses are mocked; server-rendered warning pages still use your configured backend, and news can use the network. Keep the full development stack running. Browser tests do not verify live ingestion or physical camera hardware. Run `pnpm audit --prod` when changing dependencies. Documentation-only changes need link and command review.

## Project conventions

- Use simple, explicit, strict TypeScript and follow nearby code. Explain new dependencies and abstractions.
- Read `AGENTS.md`. Before changing Next.js code, read the relevant installed guide in `node_modules/next/dist/docs/`.
- Preserve deterministic matching, source-health gates and the qualified result language in [README.md](README.md). An unmatched product is not proof that food is safe.
- Keep product, lot and date evidence within the same product group. Add regression coverage when changing matching or importer behaviour.
- Preserve privacy boundaries: no photo uploads or scan history, and no user-entered label details in public shares.
- Commit relevant regenerated files in `convex/_generated/` when backend changes require them. Do not edit generated files by hand.

## Adding a country

Adding a country changes coverage, so open an issue first. Name the official food-safety authorities, their public feeds or APIs, terms of use, and what each source covers and leaves out. Only use official sources. A country is added only once every source it needs imports successfully. Until then, the source-health gate returns `NO CLUE` rather than a negative result.

Country codes, such as `UK` and `US`, are currently hard-coded in several places. Search for `"UK" | "US"`, `v.literal("US")` and `z.enum(["UK", "US"])` to find them all. A new country needs:

1. **Region type and validators.** Add the code to `src/lib/location.ts` (`regionNames` drives the location select, URL `region` parameter and cookie), `src/lib/domain/schemas.ts` (`RegionSchema` and the check request schema), `src/lib/domain/types.ts`, `src/lib/incidents/types.ts`, `src/db/queries.ts`, and the Convex validators in `convex/schema.ts`, `convex/shares.ts` and `convex/incidents.ts`. Changing the schema validator affects existing deployments, so call it out in the PR.
2. **Importers.** Add one `IncidentSource` per official source in `src/lib/incidents/<source>.ts`, following `fsa.ts` or `fsis.ts`. Fetch through `fetchOfficialJson`/`fetchOfficialText`. Validate payloads with Zod, check pagination and reject incomplete responses. Keep `originalSourceData`, set a stable `sourceId`, and resolve warnings only when the source explicitly says so. Write an accurate `scope`, because the app shows it as coverage. Then register the source in the `sources` array in `convex/incidents.ts` and add an authority match to `inferSourceKey`. The daily cron and `refreshAllInternal` pick it up automatically.
3. **Matching targets.** Split products, barcodes, lot codes and dates into same-group targets so evidence stays within a single product. Add parser tests with sample payloads in `tests/incident-importers.test.ts` and matcher regression cases in `tests/matcher.test.ts`.
4. **Public links and copy.** Add the authority's official URL handling to `src/lib/incidents/public-source.ts`, then update `officialUrls` and the source label ("Newest first · …") in `src/components/incidents/warning-explorer.tsx`. Also update `listActivePublicIncidents` in `src/db/queries.ts`, which fetches each region by name.
5. **Locale-specific helpers (optional).** Review the shop names in `src/lib/incidents/browse.ts`, the hazard terms in `src/lib/incidents/hazard.ts`, and the news feeds and region detection in `src/lib/news/rss.ts`. Add local publishers or terms where they help. Dates are currently formatted as `en-GB`.
6. **Docs and tests.** Update the coverage paragraph in [README.md](README.md). Extend the `e2e/smoke.spec.ts` region helpers, and add `convex/seed.ts` demo rows if they help. Commit the regenerated `convex/_generated/` files.

Check it locally with `pnpm exec convex run incidents:refreshAllInternal`. Confirm that every new source finishes a successful ingestion run in the dashboard and that a check for the new country reports healthy coverage.

## Pull requests and deployments

Keep PRs focused. Explain the problem, resulting behaviour and checks run. Include screenshots for visual changes and sample source payloads for parsing changes. State anything unverified and call out schema changes or required environment variables.

Do not commit secrets, `.env.local`, `.env.development.local`, local `.convex/` state, production exports or test reports. Review your diff before submitting.

Community PRs should not need deployment keys. Maintainers handle hosted previews and integration checks after review, then deploy accepted changes. Local `pnpm build` builds the frontend; `pnpm build:vercel` and `pnpm convex:deploy` affect hosted deployments and belong to the maintainer workflow. Core contributors should use their personal development deployment and follow [Convex deployment automation](docs/convex-deployment.md) for shared environments.
