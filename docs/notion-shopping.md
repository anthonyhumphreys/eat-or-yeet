# Owner-hosted Notion shopping-list review

This optional worker lets a Notion connection you own signal a small Node 24 service when a page is added or one of its configured shopping inputs changes. The worker reads only those configured properties from the selected data source, sends one item at a time to Eat or Yeet's `review_shopping_items` MCP tool, then updates four dedicated result properties. It does not run a model, scan the workspace, or periodically poll Notion.

The review is a discovery nudge. It can surface published notices that match the row's item name, brand, or valid barcode. It does not establish that a generic item is safe, and a row review does not monitor watched categories for future notices. Persistent category monitoring and notifications need a separate subscription/history design.

## Notion setup

Create a Notion internal connection and share exactly one shopping-list database with it. Grant the read-content and update-content capabilities needed to retrieve rows and edit existing rows. Select its `data_source_id` and parent `database_id`; the worker validates their relationship at startup and refuses pages from a different database.

Create or choose these properties. Use the actual stable property IDs in the worker config; a rename does not change an ID, while delete/recreate does. Types and IDs are checked on startup and when a page is read.

| Purpose | Notion type | Sent to Eat or Yeet? |
| --- | --- | --- |
| Item | Title or rich text (required) | Yes |
| Brand | Rich text (optional) | Yes |
| Barcode | Rich text (optional; must be a valid GTIN to be accepted) | Yes |
| Bought | Checkbox (optional) | Yes; bought rows are skipped |
| Related warnings | Rich text (worker output) | No |
| Review status | Select (worker output) | No |
| Reviewed at | Date (worker output) | No |
| Input fingerprint | Rich text (worker output) | No |

The Review status select must already contain the three configured labels for related warnings, no related warnings in covered data, and unable to review. The worker never creates schema or changes a property type. A blank item or bought row is skipped. Do not add a free-form page-body field to the input map.

The Notion connection's webhook subscription should include `page.created` and `page.properties_updated`. The worker filters property-update events against the configured item, brand, barcode and bought IDs. Result-only edits are ignored. Notion may aggregate or reorder deliveries, so each accepted signal causes a delayed retrieval of the current page rather than using fields from the event payload.

## Build and configure

Build from the repository root. The worker image installs only the pinned MCP client package rather than installing the whole web application:

```sh
docker build -f integrations/notion/Dockerfile -t eat-or-yeet-notion-shopping .
```

Create a mode-0600 JSON configuration file and mount it read-only at `/etc/eat-or-yeet/notion-worker.json`. A config has the following shape; replace every example ID and label with values from the owner's Notion database.

```json
{
  "listenHost": "0.0.0.0",
  "listenPort": 3000,
  "statePath": "/data/notion-shopping.sqlite",
  "notionDataSourceId": "DATA_SOURCE_ID",
  "notionDatabaseId": "DATABASE_ID",
  "notionProperties": {
    "item": { "id": "TITLE_PROPERTY_ID", "kind": "title" },
    "brand": { "id": "BRAND_PROPERTY_ID", "kind": "rich_text" },
    "barcode": { "id": "BARCODE_PROPERTY_ID", "kind": "rich_text" },
    "bought": { "id": "BOUGHT_PROPERTY_ID", "kind": "checkbox" },
    "relatedWarnings": { "id": "WARNINGS_PROPERTY_ID", "kind": "rich_text" },
    "reviewStatus": { "id": "STATUS_PROPERTY_ID", "kind": "select" },
    "reviewedAt": { "id": "REVIEWED_AT_PROPERTY_ID", "kind": "date" },
    "inputFingerprint": { "id": "FINGERPRINT_PROPERTY_ID", "kind": "rich_text" }
  },
  "reviewMcpUrl": "https://YOUR-EAT-OR-YEET-MCP/mcp/notion",
  "reviewToolName": "review_shopping_items",
  "region": "UK",
  "statusLabels": {
    "found": "Related warnings found",
    "none": "No related warnings found in covered data",
    "unable": "Unable to review"
  },
  "secretFiles": {
    "notionApiToken": "/run/secrets/notion_api_token",
    "notionWebhookVerificationToken": "/run/secrets/notion_webhook_verification_token",
    "reviewConnectionKey": "/run/secrets/eoy_connection_key"
  }
}
```

Mount the three secret files read-only from the owner's secret store. The worker requires mode 0400 or 0600 and never prints tokens. The Eat or Yeet key is the owner's scoped MCP connection key, not an application-wide key. Set `MCP_ENABLED=true` and `MCP_NOTION_ENABLED=true` on the Eat or Yeet deployment before using its private `/mcp/notion` endpoint. Configure `MCP_CONNECTION_KEYS` there as JSON containing only each connection's `id`, SHA-256 `sha256` digest of the raw key, UTC ISO `expiresAt`, and `dailyLimit`; the raw key belongs only in the worker's secret store. The endpoint must use HTTPS (localhost is allowed for development). Create an owner-writable persistent data volume at `/data`; SQLite stores hashed event IDs, page IDs, fingerprints, and timestamps only, and expires event IDs after 25 hours. Keep the volume private and back it up only under the owner's storage policy.

Run the container with the config and secrets read-only and port 3000 behind the owner's HTTPS reverse proxy. The reverse proxy should preserve the request body exactly, not log request bodies or authorization headers, and enforce an upload limit of at most 32 KiB. Use a health/restart policy that restarts the process after host reboot. No broad Notion search/list permission is needed.

The verification token is generated by Notion and appears in the one-time verification POST body. The worker acknowledges that challenge but does not log or persist it. The owner must capture that one-time body through an access-controlled, temporary reverse-proxy inspection method, place the token in the secret store, disable inspection, then restart the worker before enabling the subscription. Never expose request-body inspection publicly or keep it enabled after setup. If this capture method is unavailable, do not enable the webhook; use a separately tested owner-operated setup method first.

The service URL is `POST /webhooks/notion`. Notion's verification requests contain a `verification_token`; subsequent deliveries must include `X-Notion-Signature`. The worker checks `sha256=<hex>` HMAC-SHA256 over the exact raw body using the stored verification token, before parsing events. Invalid signatures receive 401. Oversized bodies receive 413. Only `page.created` and `page.properties_updated` page events are queued. Queue entries and event-ID deduplication are durable across restarts; a 3-second debounce makes bursts collapse to one latest-row read. The worker retains no item text in SQLite or logs.

## What the worker sends and writes

For a row it forwards only `{id, name, brand?, barcode?, bought}` to `review_shopping_items`, in the owner's configured region. The service currently does not accept packet-detail fields, so this worker does not send them. A specific warning can contain batch or date limits; shoppers still need to compare the official notice with their package.

Before writeback, the worker fetches the row again and compares a SHA-256 fingerprint of the item, brand, barcode, and bought flag. It checks the bought flag and fingerprint before every write retry, including after a rate limit. A newer input causes the old result to be discarded and the latest row to be reviewed. Only the configured Related warnings, Review status, Reviewed at, and Input fingerprint property IDs are included in PATCH requests. Notice URLs are restricted to HTTPS, and output is length-bounded.

Notion requests are paced to about three per second with no more than two in flight. The worker respects `Retry-After` for bounded 429/529 retries. Longer server or MCP quota delays are persisted as due work for up to 24 hours, avoiding rapid repeated requests. A Notion or private MCP 401/403 pauses processing; a deleted/renamed output property, invalid property type, or changed data-source/database relationship also pauses the worker until the owner fixes configuration and restarts it. Transient failures retain bounded pending state for retry. It does not poll the workspace or use an unbounded retry loop.

## Native Notion Custom Agent alternative

Custom Agents can be configured by the owner to trigger on page creation and relevant shopping-input changes, connect to the same MCP server, and write through Notion's native tools. Whether the user's Notion plan, workspace administrator, connection authentication, and trigger filtering support the required setup must be verified in that workspace. This repository has not run a live Notion Custom Agent compatibility test.

Give the agent access only to the selected shopping database and the required MCP tools. Configure the agreed watched categories explicitly in the agent instructions. Treat a matching watched category as a reason to prioritize relevant recall notices, then review each matching row using `review_shopping_items` with its name, brand, and valid barcode. Do not blanket-exclude a broad category or suppress a product-specific warning because the category is broad. Do not call a generic item safe when no warning matches. Write only the four result properties, preserve the shopper's inputs, skip blank/bought rows, and cite the official notice link for each nudge.

The trigger may fire after the agent's own result write. Do not turn that into a loop: before it calls the MCP tool or writes, it must re-read the row and confirm the current item/brand/barcode/bought values still match the exact values it reviewed; before any write, re-read once more and discard the result if they changed. It may write only if the configured Input fingerprint value is different from the last completed review value, and must update that fingerprint with the result. A no-code agent must not claim it has validated the worker's SHA-256 scheme unless an actual supported action can compute and compare that hash. If the plan cannot reliably filter result-only edits or enforce this current-input guard, use the owner-hosted webhook worker instead.

This is a per-row review when the user edits or adds an item. It does not subscribe a person to future warnings for a saved category, keep a warning history, or send ongoing notifications; those require a separate opt-in monitoring design.

## Operator checks

1. Share one test database with the Notion connection and start with a disposable test row.
2. Confirm an input edit generates one review after the debounce, and a change to a result property generates none.
3. Edit the item while a review is in progress and confirm the older result is discarded.
4. Mark a test row bought and confirm no MCP call or output write occurs; verify a blank item behaves the same way.
5. Revoke the Notion connection or remove a configured property in a test copy and confirm the service pauses without repeated requests.
6. Inspect owner-side logs to verify they contain neither item names, request bodies, webhook signatures, nor credentials.

The automated tests exercise these behaviors using injected local clients. They do not validate a real Notion subscription, the owner's reverse proxy/secret store, or the live MCP deployment.

## Primary references

- [Notion Webhooks](https://developers.notion.com/reference/webhooks) — one-time verification token and raw-body signature format.
- [Notion event types and delivery](https://developers.notion.com/reference/webhooks-events-delivery) — `page.created`, `page.properties_updated`, `data.updated_properties`, event ordering, aggregation, and retries.
- [Retrieve a data source](https://developers.notion.com/reference/retrieve-a-data-source) — API access under version `2025-09-03`.
- [Notion request limits](https://developers.notion.com/reference/request-limits) — 429/529 handling and `Retry-After`.
- [Notion Custom Agents](https://www.notion.com/help/custom-agents) and [MCP connections](https://www.notion.com/help/mcp-connections-for-custom-agents) — plan, trigger, and connection setup.
