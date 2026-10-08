# USDA snapshot sync

USDA's public FSIS Recall API returns an Akamai 403 from our Convex backend, a Vercel function in `iad1`, standard GitHub Linux/ARM/macOS runners, and a Cloudflare Worker in Amsterdam. Curl and Chrome on GitHub also fail. A fetch from the maintainer's home network succeeds. The exact upstream blocking rule is unknown.

The official CDC combined feed is reachable from hosted runners, but currently includes only 22 recent notices. It cannot replace a full check of active USDA recalls and public health alerts. The full API currently contains 1,241 English notices, including 101 active notices.

## Import from a connection that works

Use Node 24+, install this repository's dependencies, and sign in to Convex with a maintainer account. Run from the repository root:

```sh
pnpm data:sync:fsis          # selected development deployment
pnpm data:sync:fsis --prod  # explicit production target
```

The script fetches the full official API and validates every record before uploading its English records to temporary Convex storage. An admin-only action validates the snapshot again, imports through the existing source ledger and deletes the temporary file. No new public write endpoint or application secret is added. Upload URLs and dataset contents stay out of logs.

Only active notices and explicit closures of previously active notices are stored. Unused resolved history is checked but does not create database rows. A snapshot missing a previously active notice fails the refresh. Warnings never resolve merely because they disappear from a response.

Snapshots must be fetched within 15 minutes of import and remain subject to the existing source size limit. Import failures mark the source unhealthy; a successful import becomes stale after 48 hours. A queued upload is not proof of a successful import.

## Daily external sync

When an external fetcher is responsible for USDA, set this variable on the matching Convex deployment:

```sh
pnpm exec convex env set FSIS_FETCH_MODE snapshot --prod
```

This stops the built-in cron from making the known blocked USDA request and overwriting a successful external run with a failure. Other sources continue on the Convex schedule. Without an external update, USDA becomes stale after 48 hours and blocks negative results as before.

The NAS container below runs this daily from a home connection. A home fetch adds no hosting service, but an offline machine cannot update the data. Keep the repository current so the fetcher and deployed importer agree.

## NAS container

Use a Linux NAS with Docker Compose and an ARM64 or x86-64 CPU. The image contains Node and only the three dependencies needed for fetching and importing; it does not run the website or a second database. No inbound ports are exposed. The home connection must reach both USDA and Convex.

The worker imports immediately on startup, waits 24 hours after each successful import, and retries failures hourly. On shutdown, the container allows up to seven minutes for an import already in progress to finish. A small named volume stores the last attempt and success timestamps; source records are not persisted on the NAS. Logs are capped at two 5 MB files. The container runs as an unprivileged user with a read-only filesystem.

### Create a separate key

From an up-to-date checkout on your maintainer machine, create a revocable key for this production deployment:

```sh
mkdir -p deploy/fsis-sync/secrets
chmod 700 deploy/fsis-sync/secrets
pnpm exec convex deployment token create nas-fsis-sync --prod > deploy/fsis-sync/secrets/convex-deploy.key
chmod 444 deploy/fsis-sync/secrets/convex-deploy.key
```

The private `secrets` directory restricts host access; the readable file lets the container's unprivileged user access the mounted secret. Both Git and the Docker build exclude this directory. Transfer the file privately to the same path in the NAS checkout, retaining those permissions. Do not copy your personal Convex CLI login to the NAS.

A [Convex deployment key](https://docs.convex.dev/cli/deploy-key-types) grants administration rights to that deployment, including code deployment and data writes. This key is separate from the website's build key and can be revoked independently. [Compose mounts it as a secret file](https://docs.docker.com/compose/how-tos/use-secrets/); the key is not embedded in the image or Compose environment. The worker checks its deployment prefix against `FSIS_DEPLOYMENT`, currently `prod:silent-raven-365`, before fetching or writing anything.

### Start and check

Place the current repository checkout on the NAS, then run these commands from its root:

```sh
docker compose -f deploy/fsis-sync/compose.yaml up -d --build
docker compose -f deploy/fsis-sync/compose.yaml logs --tail 100 fsis-sync
docker compose -f deploy/fsis-sync/compose.yaml ps
```

On NAS interfaces that support Compose projects, select `deploy/fsis-sync/compose.yaml` in the repository checkout as the project file and build/start it. The build context needs the repository root, so retain the directory structure.

Look for `"status":"success"` with the imported record count in the logs. A running container alone does not prove that USDA access or the import works. You can check health immediately after the first import:

```sh
docker compose -f deploy/fsis-sync/compose.yaml exec fsis-sync node --import tsx scripts/fsis-sync-worker.ts --healthcheck
```

Exit code 0 means the most recent attempt succeeded and its success is less than 36 hours old. Missing status, an import failure or stale success returns 1. Docker checks this every five minutes, with ten minutes allowed for initial startup. Configure your NAS's container monitoring to alert on unhealthy status if it supports this; Docker health status itself does not send a notification. The app independently stops treating USDA coverage as complete after 48 hours without a successful import.

The restart policy brings the worker back after a crash or NAS restart. Normal request failures stay in the worker's hourly retry loop. If the first fetch is blocked on the NAS too, the logs will report HTTP 403 and the worker will be unhealthy; the original home-machine test does not guarantee every home network works.

### Update or stop

After pulling the latest repository changes, rebuild the image with `up -d --build`. To trigger a fresh import, restart the service:

```sh
docker compose -f deploy/fsis-sync/compose.yaml restart fsis-sync
```

For a one-off diagnostic import without starting the daily worker:

```sh
docker compose -f deploy/fsis-sync/compose.yaml run --rm fsis-sync --once
```

Stop the service with `docker compose -f deploy/fsis-sync/compose.yaml down`. The status volume is retained. If retiring the fetcher, revoke its separate key from a signed-in maintainer checkout:

```sh
pnpm exec convex deployment token delete nas-fsis-sync --prod
```

Keep the container's pinned dependency versions in `deploy/fsis-sync/package.json` aligned with the root package when upgrading Convex, tsx or Zod, and regenerate its npm lockfile.

To return to direct Convex fetching after upstream access is fixed:

```sh
pnpm exec convex env remove FSIS_FETCH_MODE --prod
```

Official references: [USDA Recall API](https://www.fsis.usda.gov/science-data/developer-resources/recall-api), [CDC combined food safety feed](https://catalog.data.gov/dataset/food-safety-information-rss-feed).
