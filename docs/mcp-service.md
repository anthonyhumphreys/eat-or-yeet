# Hosted MCP pilot

The Node route at `/mcp` exposes four read-only tools. It is disabled unless `MCP_ENABLED=true`. The website keeps its separate quota buckets and browser response format.

| Tool | Behaviour |
| --- | --- |
| `check_product` | Requires `UK` or `US` and explicit product evidence. Barcode alone is valid. Uses the existing deterministic matcher and current source health. |
| `search_warnings` | Searches the complete eligible regional snapshot before pagination. Discovery results are not product verdicts. |
| `get_warning` | Reads a public warning record by slug. Returns complete affected groups per page and consumer advice. A published record may be historical; this tool does not establish its current applicability. |
| `get_coverage` | Reads fresh source status without traversing warning pages. |

Inputs reject extra properties, including nested properties. Dates use `YYYY-MM-DD`. Outputs whitelist public data and identify submitted evidence separately from barcode enrichment. A no-match result does not mean food is safe. Missing source coverage prevents reassurance.

## Transport

The official `@modelcontextprotocol/server` 2.3.1 Web handler runs directly in Next.js. A separate hosting adapter is unnecessary. Tests use the matching official client for both 2026-07-28 discovery and the legacy initialize/list/call flow. Each HTTP request creates a fresh server, with no sticky routing, persistent sessions, Redis or legacy HTTP+SSE endpoint.

Send one JSON-RPC envelope per POST. The route rejects batches and caps the envelope at 32 KiB; tool arguments are capped at 16 KiB. Validated structured output is capped at 64 KiB. Large identifying groups fail explicitly instead of losing codes or dates. The HTTP response has a separate 256 KiB bound for protocol overhead and discovery schemas.

GET and DELETE return 405. OPTIONS supports an explicitly allowed browser origin. Server clients may omit Origin. The canonical `NEXT_PUBLIC_APP_URL`, the platform's `VERCEL_URL`, and optional comma-separated `MCP_ALLOWED_ORIGINS` define allowed hosts/origins. Production origins require HTTPS. Local loopback HTTP is supported only outside production.

Calls have a 20-second deadline and a maximum of eight concurrent HTTP exchanges per process. Modern responses use JSON. Legacy responses retain their finite SSE wire format, buffered under the same deadline so the concurrency slot lasts through completion. Subscription streams are disabled. Cancellation stops waiting and aborts Open Food Facts requests. Warning searches check cancellation before and after each cached page read, so an in-flight backend/cache load may finish but no subsequent page is started. The signal is not part of the persistent page-cache key. Other Worker/D1 work and shared cache loads already started may finish, consume resources and write cache metadata; their late results do not produce a completed check.

Complete warning searches support snapshots of up to 5,000 rows (50 backend pages of 100 rows) per revision attempt. A single request makes at most two attempts, bounded to 100 pages and 10,000 rows total, including a retry after a dataset revision change. A larger snapshot fails with a recoverable `snapshot_limit` error and returns no partial results. Search results remain complete within the supported cap.

## Budgets and privacy

Production requires Vercel's overwritten client address. Missing or malformed proxy identity fails closed. Browser cookies, MCP session IDs and claimed user/host IDs do not identify an agent user. Several hosts can share cloud egress, so the network limit is deliberately coarse.

| Operation bucket | Global per UTC day | Network per hour |
| --- | ---: | ---: |
| Product checks | 1,000 | 300 |
| Search and warning details | 3,000 | 900 |
| Coverage | 2,000 | 600 |

Both counters admit an operation in one atomic D1-backed mutation before application work. If either cap would be exceeded, neither counter changes. An over-limit network cannot exhaust other networks' daily allowance through denied requests. The integration namespace leaves website buckets untouched. Unavailable or malformed counters prevent service execution. Quota errors report a retry delay. Discovery, schema listing and unsupported methods use no backend calls. Denied tool calls still need a quota query and consume Worker/D1 resources. Ingress still uses Vercel resources; configure the project's firewall before a public pilot and verify its actual rules rather than assuming these application limits protect every request.

Network identifiers are salted hashes. Counter rows expire within two days and use the existing cleanup. Production operation logs contain the tool name, duration and outcome only. They exclude observations, barcodes, network identifiers, provider bodies and protocol requests. A host may retain tool data under its own policies. No entered check history, model inference or public share is created.

At the configured ceilings, a 30-day month admits up to 30,000 checks, 90,000 browse/detail operations and 60,000 coverage reads. These are application admission limits, not billable Worker requests or D1 statement counts. Imports, retries, cold pages, metadata, website traffic and private integrations add work. Measure the Cloudflare baseline using [current cost guidance](cost-estimate.md); legacy Convex call/DAU estimates do not apply.

## Rollout and rollback

1. Use the shared services and operation contracts already in the repository. See [architecture](architecture.md) and [ADR 0002](adr/0002-migrate-backend-to-cloudflare.md).
2. Apply any new numbered D1 migrations and deploy the compatible Worker before Next.js. `takeMany` admits applicable counters atomically; preserve website and integration namespaces.
3. For a new environment, leave `MCP_ENABLED` unset or false until its pilot is accepted. Test a controlled preview or local stack with current deterministic fixtures. Staging source imports remain disabled. Do not infer the deployed flag from its default.
4. Confirm trusted proxy handling, live coverage, the Oreo barcode case and a known recalled fixture. Complete actual host installation/rendering tests and agree the remaining hosting budget.
5. Enable the pilot separately. Disable `MCP_ENABLED` and redeploy to roll back access without interrupting website checks or source refreshes.

Local SDK round trips and browser regressions establish protocol and application behaviour. They do not establish ChatGPT, Codex, Grok, Muse or other account/client compatibility. The portable package and embedded UI are implemented. Host-specific evidence is recorded in [the host guide](agent-hosts.md) and operator publication records; marketplace approval and public announcement remain separate release gates.

For an enabled isolated local stack, run `pnpm test:mcp http://localhost:3100/mcp`. This drives both official-client protocol flows through the actual HTTP route, checks the four tools, uses the US Oreo case, and requires an inconclusive product result when source coverage is missing. It does not fake healthy source status or contact a host publishing account.
