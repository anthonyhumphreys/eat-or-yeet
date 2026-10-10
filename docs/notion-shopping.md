# Owner-hosted Notion shopping-list review

This optional worker lets a Notion connection you own signal a small Node 24 service when a page is added or one of its configured shopping inputs changes. The worker retrieves that row from the selected data source, extracts only configured shopping inputs, sends them to Eat or Yeet's `review_shopping_items` MCP tool, then updates four dedicated result properties. Other row properties returned by Notion stay in memory and are not forwarded or stored. It does not run a model, scan the workspace, or periodically poll Notion.

This worker does not require Notion AI. It uses a scoped Notion API connection and the Eat or Yeet MCP endpoint.

The review is a discovery nudge. It can surface published notices that match the row's item name, brand, or valid barcode. It does not establish that a generic item is safe, and a row review does not monitor watched categories for future notices. Persistent category monitoring and notifications need a separate subscription/history design.

## Notion setup

Create a runtime Notion internal connection and share exactly one shopping-list database with it. Grant the read-content and update-content capabilities needed to retrieve rows and edit existing rows. Select its `data_source_id` and parent `database_id`; the worker validates their relationship at startup and refuses pages from a different database. The runtime connection does not need insert-content capability or access to other databases.

Create or choose these properties. Use the actual stable property IDs in the worker config; a rename does not change an ID, while delete/recreate does. Types and IDs are checked on startup and when a page is read. The item name is required; other shopping inputs are optional.

| Purpose | Notion type | Sent to Eat or Yeet? |
| --- | --- | --- |
| Item | Title or rich text (required) | Yes |
| Brand | Rich text (optional) | Yes |
| Barcode | Rich text (optional; must be a valid GTIN to be accepted) | Yes |
| Bought | Checkbox (optional) | Yes; bought rows are skipped |
| Batch code | Rich text (optional) | Yes |
| Lot code | Rich text (optional) | Yes |
| Producer | Rich text (optional) | Yes |
| Country of origin | Rich text (optional) | Yes |
| Establishment number | Rich text (optional) | Yes |
| Approval number | Rich text (optional) | Yes |
| Retailer | Rich text (optional) | Yes |
| Use by | Date (optional) | Yes |
| Best before | Date (optional) | Yes |
| Production date | Date (optional) | Yes |
| Related warnings | Rich text (worker output) | No |
| Review status | Select (worker output) | No |
| Reviewed at | Date (worker output) | No |
| Input fingerprint | Rich text (worker output) | No |

The Review status select must already contain the three configured labels for related warnings, no related warnings in covered data, and unable to review. The worker never creates schema or changes a property type. A blank item or bought row is skipped. Do not add a free-form page-body field to the input map.

### Create a ready-to-configure database

The repository includes an owner-run schema provisioner at [`integrations/notion/template/provision.mjs`](../integrations/notion/template/provision.mjs). It creates a new shopping-list database below a page you select, reads back the database's data source and property IDs, and writes a complete worker config at a new local path. Notion generates the property IDs. The script records those stable IDs so renaming a property keeps the worker mapping intact; deleting and recreating a property requires a new config.

For automatic schema creation, create a separate temporary setup connection with read-content and insert-content capabilities and share only the selected parent page with it. Read access is needed to retrieve the new database and property IDs. Put that setup token in an owner-managed secret file outside the checkout with mode `0400` or `0600`, then run this command from the repository root:

```sh
node integrations/notion/template/provision.mjs \
  --parent-page YOUR_PARENT_PAGE_ID \
  --token-file /secure/path/notion_api_token \
  --output /secure/path/notion-worker.json \
  --region UK
```

The command creates a new database on each successful invocation, refuses to overwrite the output file, and never prints the token or Notion response body. If it reports that Notion created the database but config generation stopped, inspect the selected page and API state before trying again. After the schema is created, remove the setup connection's access to the parent page and delete its token. Create the separate runtime connection described above and share only the new database with it. The generated config has mode `0600`, includes all required input and output IDs, and contains secret-file paths rather than credentials. Before starting the worker, review the config, replace its example Eat or Yeet MCP URL, choose `UK` or `US`, and place the runtime connection token and other referenced secrets in the owner's secret store. Do not commit the generated config.

The optional packet inputs are `batchCode`, `lotCode`, `producer`, `countryOfOrigin`, `establishmentNumber`, `approvalNumber`, `retailer`, and the `useBy`, `bestBefore`, and `productionDate` dates. The worker passes configured values as one `packet` object, with dates nested under `packet.dates`. Related-notice discovery uses the item name, brand, and valid barcode; packet facts do not affect discovery or create a product verdict. They are retained for an explicit check and for detecting input changes before writeback. This workflow does not call the private `check_product` tool and never writes a product verdict into a shopping row; use an explicit product check separately when comparing an item with a specific notice.

The Notion connection's webhook subscription should include `page.created` and `page.properties_updated`. The worker filters property-update events against every configured shopping-input property ID, including packet details and dates. Result-only edits are ignored. Notion may aggregate or reorder deliveries, so each accepted signal causes a delayed retrieval of the current page rather than using fields from the event payload.

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
    "batchCode": { "id": "BATCH_CODE_PROPERTY_ID", "kind": "rich_text" },
    "lotCode": { "id": "LOT_CODE_PROPERTY_ID", "kind": "rich_text" },
    "producer": { "id": "PRODUCER_PROPERTY_ID", "kind": "rich_text" },
    "countryOfOrigin": { "id": "COUNTRY_OF_ORIGIN_PROPERTY_ID", "kind": "rich_text" },
    "establishmentNumber": { "id": "ESTABLISHMENT_NUMBER_PROPERTY_ID", "kind": "rich_text" },
    "approvalNumber": { "id": "APPROVAL_NUMBER_PROPERTY_ID", "kind": "rich_text" },
    "retailer": { "id": "RETAILER_PROPERTY_ID", "kind": "rich_text" },
    "useBy": { "id": "USE_BY_PROPERTY_ID", "kind": "date" },
    "bestBefore": { "id": "BEST_BEFORE_PROPERTY_ID", "kind": "date" },
    "productionDate": { "id": "PRODUCTION_DATE_PROPERTY_ID", "kind": "date" },
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

The provisioner fills in the actual Notion IDs and secret-file paths; the MCP URL remains an example until you replace it with your deployment's private endpoint.

Mount the three secret files read-only from the owner's secret store. The worker requires mode 0400 or 0600 and never prints tokens. The Eat or Yeet key is the owner's scoped MCP connection key, not an application-wide key. Set `MCP_ENABLED=true` and `MCP_NOTION_ENABLED=true` on the Eat or Yeet deployment before using its private `/mcp/notion` endpoint. Configure `MCP_CONNECTION_KEYS` there as JSON containing only each connection's `id`, SHA-256 `sha256` digest of the raw key, UTC ISO `expiresAt`, and `dailyLimit`; the raw key belongs only in the worker's secret store. The endpoint must use HTTPS (localhost is allowed for development). Create an owner-writable persistent data volume at `/data`; SQLite stores hashed event IDs, page IDs, fingerprints, and timestamps only, and expires event IDs after 25 hours. Keep the volume private and back it up only under the owner's storage policy.

Run the container with the config and secrets read-only and port 3000 behind the owner's HTTPS reverse proxy. The reverse proxy should preserve the request body exactly, not log request bodies or authorization headers, and enforce an upload limit of at most 32 KiB. Use a health/restart policy that restarts the process after host reboot. No broad Notion search/list permission is needed.

The verification token is generated by Notion and appears in the one-time verification POST body. Set up this handoff before starting the worker, which requires the stored token. Use an owner-controlled temporary setup endpoint at the intended HTTPS URL to acknowledge the challenge and inspect its body privately. Place the token in the secret store, remove the setup endpoint and inspection, then start the worker at that URL before enabling event delivery. The worker also acknowledges repeated challenges but never adopts, logs or persists their token. Never expose request-body inspection publicly or keep it enabled after setup. If a controlled handoff is unavailable, do not enable the webhook; use a separately tested owner-operated setup method first.

The service URL is `POST /webhooks/notion`. Notion's verification requests contain a `verification_token`; subsequent deliveries must include `X-Notion-Signature`. The worker checks `sha256=<hex>` HMAC-SHA256 over the exact raw body using the stored verification token, before parsing events. Invalid signatures receive 401. Oversized bodies receive 413. Only `page.created` and `page.properties_updated` page events are queued. Queue entries and event-ID deduplication are durable across restarts; a 3-second debounce makes bursts collapse to one latest-row read. The worker retains no item text in SQLite or logs.

## Test with a local backend

Run Eat or Yeet locally with the private Notion MCP endpoint enabled and a short-lived scoped connection key. Run the Notion worker separately on Node 24, using a private configuration and secret files outside the checkout:

```sh
NOTION_WORKER_CONFIG=/secure/path/notion-worker.json node integrations/notion/main.mjs
```

When Next.js uses port 3000, set the worker's `listenHost` to `127.0.0.1`, `listenPort` to `3001`, and `reviewMcpUrl` to `http://localhost:3000/mcp/notion`. Set `statePath` to an owner-writable private file path. The Notion API calls and Eat or Yeet checks run from this machine. Notion still needs a reachable HTTPS URL to deliver webhook events; point a temporary tunnel or reverse proxy only at the worker's port 3001 and register its `/webhooks/notion` URL. Complete the verification-token handoff above before enabling events. Stop the tunnel and disable the test subscription after the test.

Use a dedicated private database containing Milk, Oreo with barcode `044000061494`, and a bought item. Confirm an input edit updates the four result fields, an output-only edit does not trigger another review, and the bought item remains untouched. Local source coverage may be incomplete; an `Unable to review` result with coverage qualifications is expected in that case and must not become a safety claim.

## Optional n8n webhook relay

[`integrations/notion/template/notion-webhook-relay.n8n.json`](../integrations/notion/template/notion-webhook-relay.n8n.json) is an importable n8n workflow for owners who prefer to expose their existing n8n instance as the Notion webhook URL. It relays the request to the worker. The worker remains the only component that verifies Notion's signature, fetches rows, filters input changes, deduplicates event IDs, debounces edits, keeps durable work, calls Eat or Yeet, checks current inputs and writes results. The relay adds no second queue or retry engine.

In n8n, use **Workflow menu → Import from File** and select the JSON. The imported workflow is inactive. Replace `https://YOUR-WORKER-HOST/webhooks/notion` with the worker's HTTPS URL, save, publish, and use the displayed production webhook URL in the Notion webhook subscription. Use an owner-controlled HTTPS reverse proxy or ingress in front of n8n that limits request bodies to 32 KiB and does not log request bodies, signatures or authorization headers. Do not use n8n's test URL for the live Notion subscription: test executions display request data in the editor.

The workflow enables n8n's **Raw Body** option, sends its binary `data` field as an n8n Binary File body, and copies `X-Notion-Signature` from the request. This preserves the original bytes for the worker's HMAC check. Its HTTP Request node captures the response status and JSON body even for non-2xx responses, and Respond to Webhook returns that status and body (including worker 401 and 503 responses). It sets JSON and `Cache-Control: no-store` response headers. Redirect following is disabled. No credentials or secrets are embedded in the workflow; the Notion API token, webhook verification token, and scoped MCP key remain in the worker's private secret files.

The workflow disables saving successful, failed, manual, and per-node execution data. Verify those settings on your n8n version before activation, and ensure your instance's execution retention and logging configuration does not retain payloads. The request exists in memory while the workflow runs. The imported workflow and its raw-body relay have not been exercised against a live n8n instance; verify an owner-side copy using a signed sample that includes non-ASCII text and whitespace, and confirm the worker returns the same 202, 401, and 503 statuses through n8n before enabling Notion delivery.

For initial Notion webhook verification, first point the relay at an owner-controlled temporary capture endpoint, then create the subscription using the n8n production URL. Keep it pending while you retrieve the one-time `verification_token`. Inspect it privately, store it in the worker's secret store, remove the capture handler and any inspection, start the worker, point the relay to that worker, then complete verification in Notion. Never leave body inspection exposed or active. After verification, subsequent requests are HMAC-verified by the worker. Notion requires deleting and recreating a verified subscription to change its URL.

## What the worker sends and writes

For a row it forwards `{id, name, brand?, barcode?, bought, packet?}` to `review_shopping_items`, in the owner's configured region. The packet contains only configured facts: optional batch code, lot code, producer, country of origin, establishment number, approval number, retailer, and optional use-by, best-before, and production dates. Dates are grouped under `packet.dates`. Configured packet fields may be sent as `null` when empty; unconfigured properties are omitted. Related-notice discovery uses the item name, brand, and valid barcode. Packet details do not alter discovery or establish that an item is affected or safe. Compare any batch/date limits in an official notice with the package, using an explicit product check when needed. The worker does not call the separate private `check_product` tool or write a product verdict to the row.

Before writeback, the worker fetches the row again and compares a SHA-256 fingerprint of the configured item, brand, barcode, bought flag, and packet details. It checks the bought flag and fingerprint before every write retry, including after a rate limit. A newer input causes the old result to be discarded and the latest row to be reviewed. Only the configured Related warnings, Review status, Reviewed at, and Input fingerprint property IDs are included in PATCH requests. Notice URLs are restricted to HTTPS, and output is length-bounded.

Notion requests are paced to about three per second with no more than two in flight. The worker respects `Retry-After` for bounded 429/529 retries. Longer server or MCP quota delays are persisted as due work for up to 24 hours, avoiding rapid repeated requests. A Notion or private MCP 401/403 pauses processing; a deleted/renamed output property, invalid property type, or changed data-source/database relationship also pauses the worker until the owner fixes configuration and restarts it. Transient failures retain bounded pending state for retry. It does not poll the workspace or use an unbounded retry loop.

## Native Notion Custom Agent alternative

Custom Agents can be configured by the owner to trigger on page creation and changes to every configured shopping input, including packet facts and dates, connect to the same MCP server, and write through Notion's native tools. Whether the user's Notion plan, workspace administrator, connection authentication, and trigger filtering support the required setup must be verified in that workspace. This repository has not run a live Notion Custom Agent compatibility test.

Give the agent access only to the selected shopping database and the required MCP tools. Configure the agreed watched categories explicitly in the agent instructions. Treat a matching watched category as a reason to prioritize relevant recall notices, then discover related notices using `review_shopping_items` with the row's name, brand, and valid barcode. Packet facts (batch/lot codes, producer, country of origin, establishment and approval numbers, retailer, and dates) do not change notice discovery; use them only during an explicit product check against a specific notice. Do not blanket-exclude a broad category or suppress a product-specific warning because the category is broad. Do not call a generic item safe when no warning matches. Write only the four result properties, preserve the shopper's inputs, skip blank/bought rows, and cite the official notice link for each nudge.

The trigger may fire after the agent's own result write. Do not turn that into a loop: before it calls the MCP tool or writes, it must re-read the row and confirm the current item, brand, barcode, bought flag, and every configured packet fact/date still match the exact values it reviewed; before any write, re-read once more and discard the result if any changed. It may write only if the configured Input fingerprint value is different from the last completed review value, and must update that fingerprint with the result. A no-code agent must not claim it has validated the worker's SHA-256 scheme unless an actual supported action can compute and compare that hash. If the plan cannot reliably filter result-only edits or enforce this current-input guard, use the owner-hosted webhook worker instead.

This is a per-row review when the user edits or adds an item. It does not subscribe a person to future warnings for a saved category, keep a warning history, or send ongoing notifications; those require a separate opt-in monitoring design.

## Operator checks

1. Share one test database with the Notion connection and start with a disposable test row.
2. Confirm an input edit generates one review after the debounce, and a change to a result property generates none.
3. Edit the item while a review is in progress and confirm the older result is discarded.
4. Change one configured packet field or date and confirm it triggers review; verify an unconfigured field does not leave Notion. Mark a test row bought and confirm no MCP call or output write occurs; verify a blank item behaves the same way.
5. Revoke the Notion connection or remove a configured property in a test copy and confirm the service pauses without repeated requests.
6. Inspect owner-side logs to verify they contain neither item names, request bodies, webhook signatures, nor credentials.

The automated tests exercise these behaviors using injected local clients. They do not validate a real Notion subscription, the owner's reverse proxy/secret store, or the live MCP deployment.

A manual live pilot on 10 October 2026 created a private shopping database, read Milk and Oreo (`044000061494`) through the connected Notion tools, called the actual local `/mcp/notion` endpoint using the worker's `McpReviewClient`, rechecked the inputs, and wrote and read back the four result fields. Both US reviews returned `Unable to review` with incomplete local source coverage; the bought row stayed untouched. This verifies the live read → MCP → writeback path. It does not yet verify a real webhook subscription, automatic event delivery, the runtime Notion REST connection, or a native Notion Custom Agent. The four Notion test suites passed all 54 checks in the same pilot.

## Primary references

- [Notion Webhooks](https://developers.notion.com/reference/webhooks) — one-time verification token and raw-body signature format.
- [Notion event types and delivery](https://developers.notion.com/reference/webhooks-events-delivery) — `page.created`, `page.properties_updated`, `data.updated_properties`, event ordering, aggregation, and retries.
- [Retrieve a data source](https://developers.notion.com/reference/retrieve-a-data-source) — API access under version `2025-09-03`.
- [Notion request limits](https://developers.notion.com/reference/request-limits) — 429/529 handling and `Retry-After`.
- [Notion Custom Agents](https://www.notion.com/help/custom-agents) and [MCP connections](https://www.notion.com/help/mcp-connections-for-custom-agents) — plan, trigger, and connection setup.
- [Create a Notion database](https://developers.notion.com/reference/create-database), [retrieve a data source](https://developers.notion.com/reference/retrieve-a-data-source), and [connection capabilities](https://developers.notion.com/reference/capabilities) — owner-run schema setup, returned property IDs, and separate setup/runtime permissions. The provisioner and worker pin API version `2025-09-03`.
- [n8n Webhook](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/), [HTTP Request](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/), and [Respond to Webhook](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.respondtowebhook/) — raw body, binary relay, status response, and body limits.
- [n8n workflow settings](https://docs.n8n.io/workflows/settings/) and [import/export](https://docs.n8n.io/workflows/export-import/) — execution data retention settings and JSON import.
