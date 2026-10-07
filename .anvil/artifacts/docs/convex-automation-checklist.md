# Automate Convex deployments

1. Generate a production deploy key in the existing Convex deployment, with `deployment:deploy` permission. Save it in Vercel as `CONVEX_DEPLOY_KEY`, scoped only to Production.
2. Generate a separate preview deploy key. Save it under the same Vercel variable name, scoped only to Preview.
3. Set Vercel's Build Command to `pnpm build:vercel`, then redeploy.

The script builds Next with the correct backend URL, deploys Convex functions, schema, indexes and crons, then allows Vercel to publish. [Official setup guide](https://docs.convex.dev/production/hosting/vercel)

## Application configuration

`CONVEX_SERVER_SECRET` must match between Vercel and the corresponding Convex deployment. Configure preview defaults separately.

Vercel also needs `RATE_LIMIT_SALT`, `CRON_SECRET` and the environment's HTTPS `NEXT_PUBLIC_APP_URL`. Keep production demo data disabled.

## Initial data

Code deployment does not import recalls. Run `incidents:refreshAllInternal` in the intended Convex dashboard deployment, then verify successful ingestion runs.

Afterward, Convex automatically refreshes sources daily at 04:17 UTC and runs cleanup at 05:17 UTC. No additional scheduled GitHub or Vercel job is needed.

Dashboard credentials and hosted deployment success have not been verified.