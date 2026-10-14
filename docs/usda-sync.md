# USDA snapshot sync

USDA's public FSIS Recall API returns an Akamai 403 from our Convex backend, a Vercel function in `iad1`, standard GitHub Linux/ARM/macOS runners, and a Cloudflare Worker in Amsterdam. Curl and Chrome on GitHub also fail. A fetch from the maintainer's home network succeeds. The exact upstream blocking rule is unknown.

The official CDC combined feed is reachable from hosted runners, but currently includes only 22 recent notices. It cannot replace a full check of active USDA recalls and public health alerts. The full API currently contains 1,241 English notices, including 101 active notices.

## Import from a connection that works

Use Node 24+ and this repository's dependencies. Supply the intended `BACKEND_URL` and its dedicated `FSIS_UPLOAD_TOKEN` privately, then run:

```sh
pnpm data:sync:fsis
# A production invocation also requires BACKEND_ENV=production.
pnpm data:sync:fsis --prod
```

The script validates the complete official archive before sending its English records to `/admin/fsis`. The Worker checks the dedicated token, writes a temporary private R2 object, validates the snapshot again, records the import in D1 and deletes the object on success or failure. The upload token cannot call general backend or operator operations. Credentials and source records stay out of logs.

Only active notices and tracked closures create database records. Missing previously active notices fail the refresh. Snapshots must be fetched within 15 minutes and fit the existing size limit. Failed or stale coverage blocks negative results after the same 48-hour freshness gate.

`FSIS_FETCH_MODE=snapshot` is already configured in Wrangler. Other source refreshes run on the Worker schedule. An external importer is still required; the migration does not bypass USDA's hosted-IP block.

## NAS container

Use a Linux NAS with Docker Compose and an ARM64 or x86-64 CPU. The image contains Node and only the two dependencies needed for fetching and importing; it does not run the website or a second database. No inbound ports are exposed. The home connection must reach both USDA and the Cloudflare Worker.

The worker imports immediately on startup, waits 24 hours after each successful import, and retries failures hourly. On shutdown, the container allows up to seven minutes for an import already in progress to finish. A small named volume stores the last attempt and success timestamps; source records are not persisted on the NAS. Logs are capped at two 5 MB files. The container runs as an unprivileged user with a read-only filesystem.

### Create a separate key

Generate a separate 32-byte token and provision the same value as the production Worker's `FSIS_UPLOAD_TOKEN`. On your maintainer machine:

```sh
mkdir -p deploy/fsis-sync/secrets
chmod 700 deploy/fsis-sync/secrets
openssl rand -hex 32 > deploy/fsis-sync/secrets/fsis-upload-token
pnpm exec wrangler secret put FSIS_UPLOAD_TOKEN --env production < deploy/fsis-sync/secrets/fsis-upload-token
chmod 444 deploy/fsis-sync/secrets/fsis-upload-token
```

Transfer the file privately to the same path on the NAS. The private directory restricts host access and the readable file lets the unprivileged container user read the mounted secret. Git and the Docker build exclude this directory. Set `FSIS_BACKEND_URL` to the intended production Worker URL in the NAS Compose environment. Compose requires an explicit URL and has no production default.

The token only authorizes USDA snapshot uploads, and can be rotated independently of the website and operator credentials. The worker rejects insecure target URLs and malformed tokens before fetching.

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

Stop the service with `docker compose -f deploy/fsis-sync/compose.yaml down`. The status volume is retained. Rotate the Worker's `FSIS_UPLOAD_TOKEN` when retiring or replacing the NAS fetcher.

Keep tsx and Zod versions aligned with the root package and regenerate the NAS npm lockfile when upgrading them. To return to direct fetching after upstream access is fixed, change `FSIS_FETCH_MODE` in the selected Wrangler environment and redeploy.

Official references: [USDA Recall API](https://www.fsis.usda.gov/science-data/developer-resources/recall-api), [CDC combined food safety feed](https://catalog.data.gov/dataset/food-safety-information-rss-feed).
