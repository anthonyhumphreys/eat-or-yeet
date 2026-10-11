# Notion readiness — 11 October 2026

The public shopping-list template and customer setup implementation exist. Production testing was authorized with the integration flags enabled. Automatic reviews are not yet generally available.

## Verified configuration

- Public template: `3f57b822339680b99d06f6c687dd87e8`.
- Public OAuth connection created with approval of Notion's Developer Terms: `3f6d872b-594c-81f5-b79f-0037ef0c6e2b`.
- Any-workspace installation scope; canonical `www` callback; template duplication configured and saved.
- Read/update content only. Insert content and comments disabled; no user information requested.
- Actual OAuth client ID/secret saved in Vercel Production and Convex Production. Convex read-back matched the source credential without printing it.
- Encryption and private review keys present in production. Vercel sensitive values were not retrieved or replaced with placeholders.

## Remaining live checks

Webhook registration/verification, real consent and template-copy review, pause/resume, country change, reconnect/disconnect and multiple-workspace/user tests remain outstanding. Update this record only from observed results.

The application now withholds connection setup unless all required OAuth, backend and webhook settings exist. The template remains usable independently. A bounded, expiring encrypted verification capture supports webhook registration without logging its plaintext token or automatically trusting a received candidate. Follow the [runbook](./notion-managed-service.md).

## Evidence boundaries

Automated Notion fixtures cover OAuth/callback binding, encrypted credentials, signed-event validation, field discovery, result-loop suppression, quota handling, tenant isolation and pause/resume work retention. These are implementation tests, not a substitute for real Notion consent and delivery.
