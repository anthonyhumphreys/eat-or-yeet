# Managed Notion service

This runbook is for the operator. Shoppers use [Add to Notion](../notion-shopping.md) and native Notion consent. The standalone API-token worker remains in [its own runbook](./notion-shopping-worker.md).

## Release gate

The service is a bounded pilot. Code and local tests are complete; public OAuth consent, copied-template installation and multi-workspace webhook delivery still need live verification. Keep both the private service configuration and website `NOTION_INSTALL_ENABLED` disabled until that passes. Merging this PR does not enable it.

Register a separate public Notion connection. The approved internal test connection is scoped to one private test database and must stay separate. Select user-owned authorization, the intended workspace installation scope, read/update content capabilities, and the callback `https://<managed-host>/oauth/callback`. Configure a clean, published shopping template with one database and one data source. Use the supplied [template schema](../../integrations/notion/template/provision.mjs), hide optional fields in its default view, and remove personal rows before publication. The service discovers only under the returned copied page and binds stable property IDs.

Create one Notion webhook subscription for `page.created` and `page.properties_updated` at `https://<managed-host>/webhooks/notion`, with API version `2025-09-03`. Configure its verification token privately; the endpoint never adopts an unsolicited token. Delivery is checked against the public connection's integration and subscription IDs, workspace and bot recipients, and the bound database parent. When `data.parent.data_source_id` is present, it must match the selected source too. Missing, unknown and unrelated parents are ignored before queueing. See [Notion's webhook parent schema](https://developers.notion.com/guides/get-started/upgrade-guide-2025-09-03#updates-to-parent-data). Normal reviews query no whole workspaces. Setup, resume and country changes reconcile at most 1,000 unbought rows from the bound list.

## Private configuration

Use a directory outside the checkout, accessible only to the service operator. Configuration and each secret file must be regular files with owner-only permissions. The container runs as UID 1000, so prepare mount ownership for that user without making secrets group/world readable. Do not commit files containing credentials or put credentials in environment values, URLs, logs or shell arguments.

Write `notion-managed.json` there. This example contains placeholders, not usable credentials:

```json
{
  "enabled": false,
  "publicOrigin": "https://<managed-host>",
  "websiteOrigin": "https://eatoryeet.app",
  "listenHost": "0.0.0.0",
  "listenPort": 3000,
  "stateDirectory": "/data",
  "clientId": "<public-oauth-client-id>",
  "notionIntegrationId": "<public-connection-integration-id>",
  "notionSubscriptionId": "<registered-webhook-subscription-id>",
  "reviewMcpUrl": "https://eatoryeet.app/mcp/notion",
  "maxInstallations": 20,
  "dailyReviewsPerInstallation": 100,
  "dailyReviewsGlobal": 1000,
  "secretFiles": {
    "clientSecret": "/run/secrets/client_secret",
    "encryptionKey": "/run/secrets/encryption_key",
    "webhookVerificationToken": "/run/secrets/webhook_token",
    "reviewConnectionKey": "/run/secrets/review_key"
  }
}
```

The encryption key file contains a canonical base64 encoding of 32 cryptographically random bytes. Generate it directly into the private file and do not print it. Keep the key separate from the state database and backups. The remaining files contain the public OAuth client secret, registered webhook verification token and one operator-only private MCP connection key. A shopper never receives that MCP key. Match the endpoint's shared connection budget to the managed global budget and leave headroom for retries and deployment checks. API attempts, including failed review admissions, consume the managed budget.

The service accepts fixed HTTPS origins. HTTP localhost origins are permitted only outside production for local development. Its private review URL must use `/mcp/notion`. Access and refresh tokens are encrypted at rest as an authenticated pair and are renewed once on an expired-token response. An ambiguous rotation failure requires reconnect rather than repeating the token request.

## Deploy on the NAS

Use [deploy/notion/compose.yaml](../../deploy/notion/compose.yaml). Set `NOTION_PRIVATE_DIR` to the absolute private directory above, then run from the repository:

```sh
docker compose -f deploy/notion/compose.yaml build
docker compose -f deploy/notion/compose.yaml up -d
```

Run exactly one replica against its persistent named volume. The engine uses one installation database and isolated queue files, each with private permissions. It holds at most 1,000 pending pages and 5,000 deduplication rows per installation. Two shared review slots, shared Notion pacing and the daily counters bound work. Idle installations do not query recall data. Do not autoscale this local SQLite pilot across processes or use a network filesystem for its state.

Place an HTTPS reverse proxy before loopback port 3101. Preserve the configured public Host header. Keep the webhook body byte-for-byte intact for signature verification, cap request bodies at 32 KiB, and do not log authorization query strings, request/response bodies or cookies. Request timeouts must permit disconnect to drain an already-dispatched Notion write. The service ignores forwarded-host claims and rejects a mismatched Host. HTTPS ingress, persistent OAuth credentials and publication of the template are operator release actions and require the corresponding authorization.

Watch `/health`, container restarts, free disk and failures reported on the management page. The health route reports process availability and feature state; it does not claim that each list, source or MCP connection is healthy. Configure an operator alert for repeated failures and a small periodic synthetic review in a dedicated pilot list. Do not record grocery text in alert payloads. Alert delivery is operator configuration, not implemented by the container.

Set the website's `NOTION_SERVICE_URL` to the same fixed public origin and `NOTION_INSTALL_ENABLED=true` only after acceptance. Those settings are server-side. The service's own `enabled` flag must also be true. No Convex table or per-shopper environment key is needed for installations or queue transitions.

## Acceptance

Record the actual consent screens, API version and first review time. The client uses Notion API `2025-09-03`. Test an ordinary account without Notion AI, two workspaces and two authorizing users in one workspace. Add Milk, Oreo with barcode `044000061494`, and Eggs. Verify bought-row skips, qualified source failures and input edits. Confirm result writes do not loop.

Also test cancellation, missing/altered templates, callback replay, expired cookies, repeated authorization, lost sessions, rotating tokens, revocation of one installation, country changes, exhausted budgets, restart and disconnect during a write. For session recovery/reconnect, choose the existing list in native consent. The service retains the original binding; Notion can create another copy if the user explicitly chooses duplication again. Verify that behaviour before launch and adjust help copy to the observed screens.

Run the project checks and the focused `notion-managed-*`, `notion-worker-embedding` and `notion-installation-config` tests. They use controlled Notion/review responses and real HTTP/SQLite processing, so they do not replace live consent or delivery checks. Keep a failing acceptance gate in the installation plan until it is resolved.

## Pause, rollback and restore

To stop new installs, turn the website flag off. To stop all managed processing, stop the container; changing the website flag alone does not pause existing lists. To keep only the unavailable help page running, set the service configuration `enabled=false` and restart. Paused customer queues are retained for resume; disconnect removes an installation's queue, credentials and sessions after writes drain. If Notion revocation fails, the user is told to remove permission in Notion as well.

Keep any private state backup encrypted, owner-only and no longer than seven days, including NAS snapshots. Test restoration before enablement. Never restore a historical credential database directly into an enabled service: it may contain an installation that disconnected after the backup. Stop the container, restore private operator configuration/key as needed, remove restored `installations.sqlite` and its WAL/SHM files and every `queue-*.sqlite*` file from the private state volume, then restart with customer setup disabled. Test a fresh Notion authorization before reenabling and have pilot users reconnect their existing lists. This deliberately requires fresh consent after a disaster restore and prevents old backups restarting disconnected users' reviews. Normal restarts retain current state and queues.

Track actual Notion/MCP requests per review and Convex/Vercel usage during the pilot. The configured caps bound cost; they are not a promise of unlimited free capacity. Raising enrollment, adding replicas or notifications needs a separate capacity and authentication decision.
