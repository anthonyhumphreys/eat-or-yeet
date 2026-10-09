# Convex deployment automation

Vercel Git integration already deploys the frontend. Set its Build Command to `pnpm build:vercel` to include the backend. The repository script runs the installed Convex CLI with `--cmd 'pnpm build'` and explicitly supplies `NEXT_PUBLIC_CONVEX_URL`.

The CLI builds Next first, then deploys Convex functions, schema, indexes and crons. Vercel only publishes after the whole command succeeds. This is not an atomic rollback of frontend and backend. Keep schema changes compatible with the currently running frontend. [Convex Vercel deployment guide](https://docs.convex.dev/production/hosting/vercel)

## One-time dashboard setup

1. In the existing Convex project's production deployment settings, generate a production deploy key with `deployment:deploy` permission. Add it to Vercel as `CONVEX_DEPLOY_KEY`, scoped to Production only.
2. Generate a separate preview deploy key in Convex project settings. Add it under the same Vercel variable name, scoped to Preview only. Each branch receives an isolated backend; never share the production key with previews. [Convex preview deployments](https://docs.convex.dev/production/multiple-deployments)
3. Set Vercel's Build Command to `pnpm build:vercel`. Remove any Build Command override that still calls only `pnpm build`.
4. Configure the app environment for each target. Set `CONVEX_SERVER_SECRET` in both Vercel and the corresponding Convex deployment. For previews, configure it as a Convex project default as well as a Vercel Preview variable. Vercel also needs `RATE_LIMIT_SALT`, `CRON_SECRET` and a valid HTTPS `NEXT_PUBLIC_APP_URL` for that environment. Keep `ALLOW_DEMO_DATA` disabled in production.
5. The build script sets `NEXT_PUBLIC_CONVEX_URL` to its target automatically. Any separately configured runtime URL must agree with that deployment. Do not copy the local development deployment selector or credentials into production.
6. Redeploy after setting the variables and Build Command. Check both Vercel and Convex deployment logs.

Configure deploy keys directly in the dashboards. Do not commit them or paste them into the thread. No dashboard settings or credentials were changed by this repository update.

## Data refreshes are separate from deployment

Deploying code does not import official recall data. After the first successful deployment, invoke `incidents:refreshAllInternal` from the intended Convex dashboard deployment. Inspect the queued ingestion runs and wait for every required source to report success. A fresh preview also needs its own import.

The deployed Convex cron then queues all source refreshes daily at 04:17 UTC. Cleanup runs at 05:17 UTC. No GitHub Actions schedule or Vercel Cron is needed for these jobs. Code deploys on pushes; source refreshes run on the Convex schedule.

The app blocks reassuring negative results until the required source health is available. Queuing a refresh is not evidence that it finished.

## First rollout verification

Check a known warning and an adequately identified unmatched product in both regions, public sharing, and the ingestion ledger. Verify the new compact matching table has populated. The local test suite does not replace this hosted integration check.

For a legacy deployment that already has incident records but no matching projections, run `incidents:backfillMatchDataInternal` once. The daily cron imports current data without repeating this migration. See [Convex usage](convex-usage.md) for storage, caching and preview cleanup guidance.

This script is prepared but remains inactive until Vercel's Build Command and environment variables are configured. The ordinary Git-connected frontend deployment can still run in the meantime.
