# Usage analytics

PostHog project **302332**, Eat or Yeet, belongs to Lexio Apps Ltd. The [usage and reliability dashboard](https://eu.posthog.com/project/302332/dashboard/1015397) uses explicit event counts. The generated starter dashboard uses automatic pageviews, people and sessions and does not apply to this implementation.

## Configuration

Set these server environment variables in Vercel **Production** only, then deploy:

```dotenv
POSTHOG_ENABLED=true
POSTHOG_HOST=https://eu.i.posthog.com
POSTHOG_PROJECT_TOKEN=<project capture token>
```

The project capture token permits event ingestion, not administration. Do not use a personal API key or expose an administrative key. The implementation does not install a PostHog SDK or load third-party analytics scripts. Vercel previews refuse capture even if the variables are accidentally inherited. Local tests use a fixture token and intercept requests; leave analytics off for ordinary development.

`POSTHOG_ENABLED=false` stops all capture and hides the initial website banner. The footer still lets visitors view or decline their preference. Deploying an environment change is required. Neither setting changes integration availability.

## Consent and privacy

Website events require the current `v1.accepted` consent cookie, configured analytics, and no browser privacy signal. The first-party ingestion route also requires a matching Origin and rejects DNT/GPC headers. Accept and decline have equal prominence; the footer lets people withdraw. The cookie lasts 180 days. A localStorage timestamp notifies other tabs of a changed choice; it is not an analytics identifier. Pending browser requests are aborted on withdrawal, though an already received event cannot be recalled.

The embedded result app starts with analytics off. Its choice lasts for the mounted view only. Its app-only `record_app_event` tool requires `consent: true` and strict allowlisted properties; compliant MCP Apps hosts hide it from the model. This metadata is a host behavior hint, not authentication or proof of a human choice. The UI permits withdrawal during a pending check and honors DNT/GPC. The iframe retains its network-blocking CSP; reports use the existing host bridge.

Server tool metrics describe operations, not individual users. They do not use browser storage and have no account, workspace, network, session or conversation identifier. Each event, including browser events, receives a new random `distinct_id`. Person profiles are disabled, IP is null, GeoIP is disabled, and browser request headers are never forwarded. The server's connection to PostHog necessarily exposes the server's network address, not the shopper's. PostHog may add service metadata to events; verify this after SDK or ingestion changes.

No raw inputs, barcodes, shopping text, warning slugs, share tokens, product results, credentials, email addresses, full URLs, user agents, error messages, screen recordings, console logs or automatic clicks enter our capture payloads. Rate limits use the existing hashed network subject solely within our own service, with a separate analytics budget. Capture runs after the response, has a two-second timeout and no retry, and cannot prevent a food check.

## Event contract

| Event | Properties in addition to fixed safety settings |
| --- | --- |
| `website_page_viewed` | `source=website`, allowlisted `page` category |
| `website_check_started` | `source=website`, `method`, `region` |
| `website_check_finished` | Above plus broad `outcome`, including `error` |
| `app_opened` | `source=embedded_app`, self-reported `host=chatgpt/other` |
| `app_tool_requested` | Above plus one of the four public `tool` names |
| `$mcp_tool_call` | `source=public_mcp/notion_mcp`, `$mcp_server_name`, `$mcp_tool_name`, `$mcp_duration_ms`, `$mcp_is_error`, allowlisted `outcome` |

Every event also has `$process_person_profile=false`, `$geoip_disable=true`, `$ip=null`, `environment=production` and `analytics_version=1`. Durations are rounded to 100 ms and capped at 120 seconds. Server metrics cover executed service operations, not all HTTP requests or SDK-rejected malformed arguments. All fields are constructed explicitly; do not spread request objects into analytics.

The dashboard measures counts and average durations. These are derived measures, not approved Data Catalog metrics. Never interpret distinct IDs as people, create user funnels or report retention from this data. Optional events undercount actual use. Public MCP includes ChatGPT tool calls alongside other assistants because a stateless shared endpoint cannot reliably identify the caller. Embedded host labels are self-reported. App opens and tool calls may represent the same food check; do not add their counts together as unique checks. Tests, retries and bot calls can count too.

## Retention and requests

See [PostHog event retention](https://posthog.com/docs/data/events-retention) and its [data-processing terms](https://posthog.com/dpa). EU Cloud is used. The free-plan query window is one year, and paid plans currently expose seven years. These windows are **not automatic deletion guarantees**; this setup has no custom event deletion schedule. Do not promise 30- or 90-day erasure. Withdrawal stops future optional collection, not prior unlinked counts. There is no browser or account key to locate someone's historical analytics events. Treat any future change adding identifiers, replay or new properties as a privacy change requiring updated consent and documentation.

## Verification

1. Run lint, typecheck, unit tests, build, and `e2e/analytics-consent.spec.ts` plus `e2e/mcp-app.spec.ts` with a fixture token. Intercept `/api/analytics` during browser tests.
2. On the deployed website, decline first and confirm no analytics request. Accept through the footer, inspect the small first-party payload, then withdraw and confirm future requests stop. Test GPC/DNT and cross-tab changes.
3. Read the v2 app resource over MCP. Use the official bridge fixture to verify app-only calls, consent, schema validation and no model-context updates. A real ChatGPT installation must separately verify host visibility and the new consent controls; local bridge tests cannot establish that.
4. Execute a synthetic coverage call and an explicitly consented page/app event. Confirm arrival in PostHog, fresh IDs, profile suppression and absence of input, IP, GeoIP, URL and session properties. Expect a few setup events in the dashboard.
