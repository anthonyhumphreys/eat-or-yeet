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

Calls have a 20-second deadline and a maximum of eight concurrent HTTP exchanges per process. Modern responses use JSON. Legacy responses retain their finite SSE wire format, buffered under the same deadline so the concurrency slot lasts through completion. Subscription streams are disabled. Cancellation stops waiting and aborts Open Food Facts requests. Convex work and shared cache loads already started may finish, consume allowance and write cache metadata; their late results do not produce a completed check.

## Budgets and privacy

Production requires Vercel's overwritten client address. Missing or malformed proxy identity fails closed. Browser cookies, MCP session IDs and claimed user/host IDs do not identify an agent user. Several hosts can share cloud egress, so the network limit is deliberately coarse.

| Operation bucket | Global per UTC day | Network per hour |
| --- | ---: | ---: |
| Product checks | 1,000 | 300 |
| Search and warning details | 3,000 | 900 |
| Coverage | 2,000 | 600 |

Both counters admit an operation in one atomic Convex mutation before application work. If either cap would be exceeded, neither counter changes. An over-limit network cannot exhaust other networks' daily allowance through denied requests. The integration namespace leaves website buckets untouched. Unavailable or malformed counters prevent service execution. Quota errors report a retry delay. Discovery, schema listing and unsupported methods use no Convex calls. Denied tool calls still need a quota query and consume shared I/O. Ingress still uses Vercel resources; configure the project's firewall before a public pilot and verify its actual rules rather than assuming these application limits protect every request.

Network identifiers are salted hashes. Counter rows expire within two days and use the existing cleanup. Production operation logs contain the tool name, duration and outcome only. They exclude observations, barcodes, network identifiers, provider bodies and protocol requests. A host may retain tool data under its own policies. No entered check history, model inference or public share is created.

At the full check ceiling, three calls per warm barcode check allow roughly 90,000 Convex calls per 30-day month. Browse and coverage can add roughly 300,000 calls if their own ceilings are exhausted, before cold pages, metadata and ordinary imports. These are abuse ceilings, not free-tier capacity guarantees or expected traffic. Measure ordinary import usage and pilot traffic before enabling broad access; October team I/O is already above the included allowance.

## Rollout and rollback

1. Review and merge the shared-service foundation first.
2. Deploy additive Convex functions before Next.js. `takeMany` accepts the new actions and optional unit cost; old check/share callers still increment by one. No schema or index migration is needed.
3. Keep production `MCP_ENABLED` unset or false. Test a controlled preview or local stack with current deterministic fixtures. Preview source imports must remain disabled.
4. Confirm trusted proxy handling, live coverage, the Oreo barcode case and a known recalled fixture. Complete actual host installation/rendering tests and agree the remaining hosting budget.
5. Enable the pilot separately. Disable `MCP_ENABLED` and redeploy to roll back access without interrupting website checks or source refreshes.

Local SDK round trips and browser regressions establish protocol and application behaviour. They do not establish ChatGPT, Codex, Grok, Muse or other account/client compatibility. The portable package and embedded UI are the next PR; marketplace submission and public announcement remain separate release gates.

For an enabled isolated local stack, run `pnpm test:mcp http://localhost:3100/mcp`. This drives both official-client protocol flows through the actual HTTP route, checks the four tools, uses the US Oreo case, and requires an inconclusive product result when source coverage is missing. It does not fake healthy source status or contact a host publishing account.
