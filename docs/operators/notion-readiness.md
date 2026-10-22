> Live pilot evidence below is from the previous Convex backend on 11 October 2026. Production moved to Cloudflare on 14 October. The cutover preserved the credential key and third-party credentials and had no active installations to drain; it did not repeat live Notion OAuth or signed-event acceptance. See [the cutover record](../cloudflare-cutover-2026-10-14.md) and [migration acceptance](notion-managed-service.md#cloudflare-migration-acceptance).

# Notion readiness — 11 October 2026

The public shopping-list template and customer setup implementation exist. Production testing was authorized with the integration flags enabled. Automatic reviews are not yet generally available.

## Verified configuration

- Public template: `3f57b822339680b99d06f6c687dd87e8`.
- Public OAuth connection created with approval of Notion's Developer Terms: `3f6d872b-594c-81f5-b79f-0037ef0c6e2b`.
- Any-workspace installation scope; canonical `www` callback; template duplication configured and saved.
- Read/update content only. Insert content and comments disabled; no user information requested.
- Actual OAuth client ID/secret saved in Vercel Production and Convex Production. Convex read-back matched the source credential without printing it.
- Encryption and private review keys present in production. Vercel sensitive values were not retrieved or replaced with placeholders.
- Webhook verified and active in Notion, with subscription `3f6d872b-594c-81e4-8095-009947c07910`, API version `2025-09-03`, and only `page.created` / `page.properties_updated` enabled.
- Verified signing token and subscription ID saved in Vercel Production. Both temporary capture settings removed; the production redeployment rejects unsigned ordinary requests with 401.

## Observed production tests

A fresh private template copy in Anth's Space was authorized through the hosted UK setup flow using explicit user approval. It reached **Reviews active**. A synthetic milk item received **Related warnings found**, a review timestamp and fingerprint through a real signed event. The entered batch value remained intact.

The management page changed to **Reviews paused**, then returned to **Reviews active** after resume. Changing the warning country to US completed and returned to **Reviews active**. These checks establish the observed control states; queued work retention is a separate check.

Cancelling reconnect consent left the existing installation active. Retrying reconnect with the already authorized private list succeeded, retained the same installation and database, and preserved the US setting. The public template's instructions were updated and checked anonymously on the published page.

After an active US input edit, the row received a new fingerprint, review time and US source coverage. Two item reviews were charged in total for the UK and US reviews; result-only writes did not start additional reviews during observation. The temporary local OAuth secret, signing token and capture private key were deleted after live use confirmed production storage.

An edit to the bought US item produced an accepted signed event and drained without another review charge or timestamp change. Disconnect completed with **Notion list disconnected** and **Notion access was revoked**; the installation, sessions, fingerprints and event/job/quota records were removed. Reloading the private Notion list confirmed the item and entered packet details remained accessible.

## Remaining live checks on Cloudflare

Repeat the complete consent → copied-list → signed event → review → disconnect journey against the Cloudflare deployment. Verify queue recovery and tenant isolation on D1/Queues before treating the earlier pilot as release evidence for this backend.

Already-queued work across pause/resume, callback replay and multiple-workspace/user tests remain outstanding as live checks. Those boundaries remain covered by automated fixtures. Update this record only from observed results. Edits first received while paused intentionally do not start new reviews.

The application now withholds connection setup unless all required OAuth, backend and webhook settings exist. The template remains usable independently. A bounded, expiring encrypted verification capture supports webhook registration without logging its plaintext token or automatically trusting a received candidate. Follow the [runbook](./notion-managed-service.md).

## Evidence boundaries

Automated Notion fixtures cover OAuth/callback binding, encrypted credentials, signed-event validation, field discovery, result-loop suppression, quota handling, tenant isolation and pause/resume work retention. These are implementation tests, not a substitute for real Notion consent and delivery.
