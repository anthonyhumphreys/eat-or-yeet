# Managed Notion installation operations

Shoppers use [Notion setup](https://www.eatoryeet.app/integrations/notion). They do not need tokens, webhooks or a worker. The optional [self-hosted worker](./notion-shopping-worker.md) is a separate operator setup.

## Production connection

The Lexio Notion account owns the Eat or Yeet OAuth connection. It is installable in any workspace; each user authorizes their own copied list. It is not listed in the Notion Marketplace.

- Connection ID: `3f6d872b-594c-81f5-b79f-0037ef0c6e2b`.
- Redirect URI: `https://www.eatoryeet.app/api/notion/callback`.
- Webhook URL: `https://www.eatoryeet.app/api/notion/webhook`.
- [Public template](https://carnelian-airedale-eb7.notion.site/Eat-or-Yeet-shopping-list-3f57b822339680b99d06f6c687dd87e8): configured for duplication during OAuth.
- Capabilities: read/update content; no insert content, comments or user information.
- Webhook events: `page.created` and `page.properties_updated`, using the implementation's pinned `2025-09-03` API version.

Use the `www` URLs exactly. The bare domain redirects and is not the configured OAuth origin. The public template must contain the expected shopping-list fields and no private test data. The callback must return the duplicated template page ID; choosing arbitrary existing pages is not supported.

## Required environment settings

| Setting | Vercel Production | Convex Production |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | `https://www.eatoryeet.app` | Same canonical origin |
| `NOTION_INSTALL_ENABLED` | `true` for the authorized production pilot | Not used |
| `NOTION_CLIENT_ID` | OAuth connection ID | Same ID |
| `NOTION_CLIENT_SECRET` | Sensitive OAuth secret | Same secret |
| `NOTION_CREDENTIAL_KEY` | Sensitive base64 encoding of 32 random bytes | Same key |
| `NOTION_INTEGRATION_ID` | Connection ID | Not used |
| `NOTION_SUBSCRIPTION_ID` | Verified webhook subscription ID | Not used |
| `NOTION_WEBHOOK_VERIFICATION_TOKEN` | Sensitive token verified in Notion | Not used |
| `NOTION_REVIEW_CONNECTION_KEY` | Not used | Existing private review key |

The normal Convex URL and server secret must also be configured in Vercel. The setup button and hosted routes require the complete Vercel configuration. This checks configuration presence, not Notion availability or completion of live acceptance tests. Changing Vercel settings requires a new deployment before the application uses them.

Never copy values returned by `vercel env pull` for sensitive settings: these can be placeholders. Obtain an actual credential from its issuing service and save it directly in each required environment. Do not commit secrets or put them in browser code, URLs or ordinary logs. Keep preview credentials separate.

## Register and verify the webhook

Notion delivers its verification token to the webhook URL before activating a subscription. An unverified token must not automatically become the trusted signing key. See [Notion's verification flow](https://developers.notion.com/reference/webhooks).

1. Run `pnpm tsx scripts/notion-webhook-setup.ts prepare`. It creates a local RSA private key and public key under ignored `dist/notion-readiness/webhook-setup/`. The private key must stay on the operator's machine. The script refuses to overwrite existing keys.
2. Set `NOTION_WEBHOOK_SETUP_PUBLIC_KEY` in Vercel to the public PEM. Immediately before deployment, set `NOTION_WEBHOOK_SETUP_EXPIRES_AT` to a Unix timestamp in milliseconds no more than 15 minutes ahead. Leave `NOTION_WEBHOOK_VERIFICATION_TOKEN` unset. Deploy the application.
3. In Notion's connection **Webhooks** tab, create the subscription using the production webhook URL, pinned version and the two events above. Capture is deliberately temporary: it is disabled by default, rejects ordinary events, validates a bounded token-only body and cannot run after the deadline or once a signing key exists.
4. Retrieve the runtime log entry prefixed `notion_webhook_verification_candidate`. It contains RSA-OAEP ciphertext, never the plaintext token. Save only its base64 ciphertext to a private local file.
5. Run `pnpm tsx scripts/notion-webhook-setup.ts decrypt <candidate-file>`. The candidate is written to a local file with owner-only permissions. Paste it into Notion's **Verify subscription** form. If Notion rejects it, do not configure it as the signing key; resend and inspect a fresh candidate during another short capture window.
6. Only after Notion shows the subscription as verified, save that exact token as sensitive `NOTION_WEBHOOK_VERIFICATION_TOKEN` and save the subscription ID in Vercel. Remove both temporary capture settings. Redeploy and confirm a real signed event reaches the normal handler.
7. Delete local plaintext credential/token files and the capture private key after verifying storage. The encrypted capture log cannot be used to verify events without the private key or token.

Do not claim a webhook is active merely because a capture returned 202. Capture never changes the trust configuration or accepts a shopping-list event. The normal handler checks the HMAC signature, integration ID, subscription ID, workspace and authorized bot before queuing work.

## Live acceptance and release

Use a fresh copied template with synthetic packet details. Verify:

- Consent, UK/US propagation, template duplication, cancel/retry and callback replay protection.
- First review after an item change, packet fields retained, Bought skipped and result writes not causing a loop.
- Pause/resume, country change, limit/retry display and explicit status refresh.
- Reconnect and disconnect during a review: stop new work, drain writes, remove connection state and revoke access where supported. Preserve the list.
- Two workspaces and two users in one workspace. Revocation or a busy installation must not affect another installation.

Local fixture tests verify the implementation, including the pause/resume regression and tenant isolation. They do not prove real OAuth consent or webhook delivery. See the [readiness record](./notion-readiness.md) for the current evidence and outstanding checks. Production flags were enabled at the user's request for testing; do not describe the feature as generally available until live checks pass.

Convex stores encrypted credentials, scoped sessions and bounded event/review queues. Jobs read only configured fields in the bound list and write only result fields. Monitor route failures, backlog, review limits and Notion API errors. No customer API key, polling process or NAS container is needed. The NAS hosts the [USDA importer](../usda-sync.md), not customer Notion credentials.
