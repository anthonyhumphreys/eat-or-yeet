# Managed Notion installation operations

This runbook is for the service owner. Shoppers use [Add to Notion](../notion-shopping.md) and Notion's consent screen. The standalone API-token worker remains an optional operator-run setup in [its own runbook](./notion-shopping-worker.md).

## Release gate

Keep `NOTION_INSTALL_ENABLED` off until the public connection, copied template, signed webhook and multi-workspace acceptance tests pass. Local tests use controlled Notion responses and do not prove public consent or delivery. Enabling the website alone does not register the OAuth app or webhook.

## Register the Notion connection

Use the public Notion OAuth connection for customer installs. Keep the private test connection separate. Register the production callback URL exactly as:

`https://eatoryeet.app/api/notion/callback`

Grant only the page and database read/update capabilities required to discover the chosen template and maintain its existing rows. Configure the intended workspace installation scope. Publish a clean shopping-list template with the expected fields and no private test data. Verify the consent flow duplicates the template and returns its page ID.

Register one Notion webhook subscription at:

`https://eatoryeet.app/api/notion/webhook`

Subscribe to page-created and page-properties-updated events supported by the deployed Notion API version. Store the webhook verification token in the hosting secret store. Do not accept an unsolicited verification token or expose it in logs.

## Deploy the hosted routes

Deploy the matching Convex schema/functions and Next.js application. Set `NEXT_PUBLIC_APP_URL` to the canonical HTTPS origin for that environment. In Vercel, configure `NOTION_INSTALL_ENABLED`, `NOTION_CLIENT_ID`, `NOTION_CLIENT_SECRET`, `NOTION_INTEGRATION_ID`, `NOTION_SUBSCRIPTION_ID`, `NOTION_WEBHOOK_VERIFICATION_TOKEN` and `NOTION_CREDENTIAL_KEY`. The OAuth client details and encryption key also belong in the matching Convex environment for refresh and credential handling. Store `NOTION_REVIEW_CONNECTION_KEY` in Convex as the private operator key used by the website's review action. Never commit these values, put them in a URL, or expose them to browser code. Keep preview and production credentials separate. `NOTION_CREDENTIAL_KEY` must be a base64 encoding of 32 random bytes and match in Vercel and Convex.

The OAuth and webhook handlers run as Vercel Next.js routes. Convex stores the installation mapping, encrypted credentials, scoped sessions, event IDs, queued page reviews and bounded review counters. No per-customer environment key, SQLite database, NAS container or Vercel-hosted polling process is needed. Jobs begin from Notion page-change events and country changes. They read only configured fields from the bound list and write only result fields.

The private review key authorizes server-to-server calls to the existing Notion review tool. Keep it server-only and budget its use alongside per-installation and global limits. It is one operator credential, not a key issued to each shopper. Never put a Convex admin credential in a customer installation.

## Verify before enabling

On a controlled preview, test the public consent flow, country propagation, template-copy selection, cancel and retry paths, callback replay protection, signed webhook delivery, field discovery, first review, result-write loop suppression and management session recovery. Test two workspaces and two users in one workspace. Confirm a revoked or busy installation does not affect another one.

Exercise pause/resume, country change, daily-limit display, explicit status refresh, reconnect and disconnect while a review is in flight. Disconnect must stop new work, drain active writes, remove Convex connection state and revoke the Notion connection where supported. The shopping list must remain in Notion. If automatic revocation fails, show the shopper how to remove access in Notion.

Enable `NOTION_INSTALL_ENABLED` only after the preview checks pass and the production OAuth callback, template and webhook are registered. Monitor Vercel route failures, Convex job backlog, review limits and Notion API errors. Do not describe the integration as generally available before these checks pass.

## USDA hosting boundary

The NAS is used for the USDA snapshot importer because USDA blocks requests from the hosted runtime. It does not host customer Notion credentials, callbacks, webhooks or review queues. See [USDA snapshot sync](../usda-sync.md) for that separate process.
