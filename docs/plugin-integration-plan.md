# Eat or Yeet agent and bot integration plan

Updated: 15 October 2026

Infrastructure: production moved to Cloudflare on 14 October. See [architecture](architecture.md) and [ADR 0002](adr/0002-migrate-backend-to-cloudflare.md). Historical PR sequencing below is retained; live host and Notion acceptance remain separate from backend migration.

Status: Shared services/contracts ([PR #2](https://github.com/anthonyhumphreys/eat-or-yeet/pull/2)), the bounded default-off MCP pilot ([PR #3](https://github.com/anthonyhumphreys/eat-or-yeet/pull/3)) and the portable plugin/MCP Apps editor ([PR #4](https://github.com/anthonyhumphreys/eat-or-yeet/pull/4)) are implemented and locally verified. Notion shopping review and its single-installation worker passed a live owner pilot on 10 October. The managed Add to Notion flow now uses same-app Vercel routes with D1 state and Cloudflare Queue jobs; it is implemented and locally tested. The earlier Convex pilot verified the core managed journey; repeat live consent and delivery on Cloudflare and complete multi-workspace acceptance before general availability. See [MCP pilot controls](./mcp-service.md) and [embedded app verification](./mcp-app.md).

The [spec review](./agent-spec-review.md) records implementation evidence and remaining acceptance work. The template has mocked API verification and the relay has source/configuration checks. The live owner Notion pilot passed on 10 October; customer onboarding, n8n and installed-host acceptance remain open.

Build one hosted MCP service around the existing deterministic checker. Package it for ChatGPT and Codex, connect compatible agent hosts to the same endpoint, and add messaging bots as small channel adapters when there is demand. Keep the richer ChatGPT experience, Grok and Meta Muse as the proposed coordinated public launch. Broader client compatibility can be tested alongside that work; it does not require a separate backend for each provider.

The initial agent release should expose four read-only tools and a usable ChatGPT result/editor interface. Stage public sharing, Notion shopping-list reviews and native ChatGPT extensions as separate additions. Each has behaviour and compatibility requirements beyond the core checker.

## Scope and product behaviour

Support barcode checks, manual identifying details, warning search, warning details and source coverage for UK and US food. Region is required for checks and searches. Remember an explicitly chosen country within the current interaction; language, host location and browser locale may suggest a choice but must not silently select one. Do not require a second country-of-purchase question after the user has chosen the region. Retailer remains optional evidence when a warning makes it relevant. Country of origin is a separate packaging fact.

A useful barcode alone should trigger a check. Ask for batch, lot or date information only when it would resolve uncertainty. The service may enrich identity using the current curated product and Open Food Facts paths. Neither an unknown barcode nor the word "Oreo" establishes a complete identity match.

Keep all product-check decisions in the existing matcher. Hosts can put facts explicitly supplied by the user into tool arguments; they must leave unknown fields empty. Do not introduce model inference, photo extraction or uploads into Eat or Yeet. Camera scanning continues through the website. See [ADR 0001](./adr/0001-remove-ai.md) and [product principles](../PRODUCT.md).

The public result is qualified. Map internal `EAT` to "No matching warning found", never "safe to eat". Preserve possible matches, unresolved restrictions and `NO_CLUE`. A source-health failure must prevent reassurance. An infrastructure failure that prevents a check returns an error, not an invented verdict. Identity, batch and date restrictions must remain within the same affected product group.

Accounts, check history, general notifications, saved products and new countries are outside the core release. The Notion follow-up adds an opt-in review when someone adds or changes a shopping-list item. A separate category-watch addition will support agreed recurring interests and new-recall alerts for shopping agents. Until that addition is installed, an item review does not promise future monitoring. The host may retain conversation/tool data under its own policies; explain that boundary in the privacy page. Store no entered label details in logs, public shares or analytics.

## Host routes and distribution

The sources below were checked on 9 October 2026. They establish documented routes, not tested compatibility or access to our publishing accounts.

| Target | Implementation route | Distribution and acceptance gate |
| --- | --- | --- |
| ChatGPT and Codex | Hosted MCP, a portable Agent Plugins package and optional MCP Apps UI | Test a custom connection, then install the complete package. OpenAI public submission covers the shared plugin directory. Verify publisher identity, domain ownership and account permissions. [Packaging](https://developers.openai.com/plugins/build/plugins), [submission](https://developers.openai.com/plugins/deploy/submission). |
| Grok and Grok Bot | The same public HTTPS MCP endpoint | Custom connectors are documented. Business/Enterprise admin setup and Team Bots are team distribution routes; do not present them as an unrestricted public bot marketplace. Verify the actual installation route in our account. [Connectors](https://docs.x.ai/grok/connectors), [Team Bots](https://docs.x.ai/grok-bot/team-bots). |
| Meta Muse | Hosted MCP connector | Prepare the platform's connector submission and complete-workflow review. Confirm current intake and publisher eligibility before promising availability. [Connector guidelines](https://muse.ai/platform/docs). |
| Claude | Custom remote MCP connector | Test web/desktop setup and applicable workspace admin controls. Calls originate from Anthropic's cloud. Its API MCP connector is a separate beta integration route. [Custom connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp), [API connector](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector). |
| Cursor | Remote MCP configuration or a plugin package | Provide a configuration recipe; public Marketplace distribution is a separate review. Validate portable packaging rather than assuming OpenAI-specific extensions work. [MCP](https://prod.cursor.com/help/customization/mcp), [plugins](https://prod.cursor.com/docs/plugins). |
| Gemini CLI and Gemini API | Remote Streamable HTTP MCP | Publish a CLI recipe. The Interactions API's remote MCP support is an application/API route, not a Gemini consumer chat listing. API callers pay their own model usage. [CLI](https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md), [API](https://ai.google.dev/gemini-api/docs/function-calling#remote-mcp-model-context-protocol). |
| n8n | MCP Client connected directly to Eat or Yeet | Provide one workflow example. An n8n server wrapper is unnecessary for consuming our tools. Check the installed node/version and credentials. [MCP Client](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-langchain.mcpClient). |
| Notion shopping lists | Managed public OAuth connection, copied shopping template and Vercel routes and Cloudflare review jobs | Customer flow is Add to Notion, native consent/template copy, then open the active list. No Notion AI, customer API keys or customer hosting. Cloudflare live consent/delivery and production tenant acceptance remain release gates. Native Custom Agents and the standalone worker are optional advanced routes. [Installation plan](./notion-installation-plan.md), [Notion template authorization](https://developers.notion.com/guides/get-started/authorization). |
| Discord, Slack and Telegram | Native commands/webhooks calling the shared application service | Each channel needs its own installation, inbound authentication, retry and response handling. MCP does not replace these APIs. Start with Discord if a native bot is wanted; add other channels as separate follow-ups. [Discord commands](https://docs.discord.com/developers/interactions/application-commands), [Slack request verification](https://docs.slack.dev/authentication/verifying-requests-from-slack/), [Telegram Bot API](https://core.telegram.org/bots/api). |

Manual MCP connections and public listings are different deliverables. Record the tested host, client version, account tier, transport, UI support and installation path. Text-only operation is a valid baseline outside ChatGPT.

## Shared application services

```mermaid
flowchart TD
    Website[Website routes] --> Services[Check and warning services]
    Agents[ChatGPT, Codex and other agent hosts] --> MCP[Hosted MCP endpoint]
    MCP --> Services
    ChatUI[MCP Apps interface] --> MCP
    Install[Add to Notion and native consent] --> Notion[Managed shopping-list worker]
    Notion --> MCP
    Shopping[Agent choosing groceries] --> MCP
    Watches[Opt-in category watches - follow-up] --> Services
    Watches --> Alerts[Owner's notification channel]
    Bots[Native bot command adapters] --> Services
    Services --> Matcher[Existing deterministic matcher]
    Services --> Cache[Existing revision-based dataset and product caches]
    Cache --> Worker[Authenticated Cloudflare Worker]
    Worker --> D1[(D1 warnings and source ledger)]
```

Keep the current Next.js Node runtime, Vercel project, Cloudflare backend and independent NAS USDA/FDA importer. Do not duplicate warning imports for integrations or expose the NAS to agent hosts. The MCP handler calls application services directly, avoiding a request back through `/api/check` and its browser cookies.

| Boundary | Current implementation | Boundary to preserve |
| --- | --- | --- |
| Check orchestration | `src/lib/checks/service.ts`, `src/app/api/check/route.ts` | Share the deterministic checker; keep browser cookie/network quotas and HTTP response shape in the website route. |
| Public contracts | `src/lib/integrations/contracts.ts`, `serialize.ts` | Strict, versioned public schemas; do not expose internal records or change browser defaults for an agent host. |
| Warning search/detail | `src/db/queries.ts`, `src/lib/incidents/search.ts`, `public-source.ts` | Read complete eligible revision-keyed pages through the Worker and validate official links. |
| MCP transport/tools | `src/app/mcp/route.ts`, `src/lib/integrations/mcp/` | Keep transport validation, limits and formatting around shared services. |
| Quotas | `src/lib/security/rate-limit.ts`, `backend/rateLimits.ts` | Keep website/integration budgets separate and admit applicable counters in one atomic D1-backed mutation. |
| UI/package | `apps/eat-or-yeet/`, `plugins/eat-or-yeet/` | Bundle the embedded interface separately and retain validated, allowlisted plugin packaging. |

Keep these as explicit functions and schemas. There is no need for a generic provider framework, model SDK or new database. A public REST/OpenAPI adapter is optional later, when a specific client cannot use MCP or an externally hosted bot needs it. It must call the same services and use scoped server credentials, never a public backend administrative token.

## Transport and SDK decision

Use `@modelcontextprotocol/server` 2.3.1 directly with the existing Zod 4. The installed SDK provides a Web-standard `createMcpHandler`, so an additional adapter adds no benefit here. Local official-client tests cover current per-request metadata/discovery and older `initialize` clients. Do not build process-local session storage, Redis or a legacy HTTP+SSE endpoint. [Web serving](https://ts.sdk.modelcontextprotocol.io/v2/serving/web-standard), [protocol compatibility](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/protocol-versions.md).

There is a current dependency mismatch: OpenAI's TypeScript MCP Extensions package peers on `@modelcontextprotocol/sdk` ^1.29.0 and `@modelcontextprotocol/ext-apps` ^1.7.5, while the current MCP Apps 2.x stack targets SDK v2. Use standard MCP Apps for the first UI. Gate sidebar, native settings, mentions and rich-form extensions on a supported dependency set and real client tests. Do not force peer overrides. If native extensions become essential before compatibility is available, evaluate an isolated v1 endpoint sharing the same services, including its migration cost and support window, before choosing it. [OpenAI peers](https://github.com/openai/mcp-extensions/blob/main/typescript/package.json), [MCP Apps SDK](https://github.com/modelcontextprotocol/ext-apps), [SDK support policy](https://github.com/modelcontextprotocol/typescript-sdk).

Before installing dependencies, recheck current versions and read the installed Next.js route documentation. Prove protocol discovery, schemas, POST responses, expected unsupported-method behaviour, origin/host checks, request deadlines and cancellation in the actual hosting runtime. Test both protocol generations without sticky routing. If the Web adapter fails, choose a supported adapter or a small separate Node service; do not cast Requests to Node IncomingMessage objects.

## Portable tools and output

| Tool | Input | Output |
| --- | --- | --- |
| `check_product` | Explicit UK/US region and bounded observation fields; barcode alone is valid | Public status/label/qualification, submitted evidence and separately identified enrichment, check time, current coverage, matched warning references, reasons, unresolved restrictions and truncation. |
| `search_warnings` | Region, optional bounded text/hazard/category/retailer filters, page size and opaque cursor | Public summaries, official and website links, current source status, total/continuation information and completeness. |
| `get_warning` | Public slug; continuation for affected groups when necessary | Consumer advice, affected product groups with their own codes/dates, authority, source and notice dates. |
| `get_coverage` | Region | Required sources, scope, status, last successful refresh and current health-check time. |

Require region instead of reusing `CheckRequestSchema`'s UK default. Reject unknown properties at every nested tool boundary. Normalise omitted optional fields to the existing empty observation. Use validated, unambiguous calendar dates for the public contract; ask for clarification rather than infer an ambiguous date. Preserve the existing browser's input behaviour.

Return concise text plus validated structured content. Use public slugs and ISO dates, and whitelist fields. Omit internal record IDs, original source payloads, internal scores that imply safety probabilities, cookies and secrets. Expose total match count when the matcher returns only its first ten results. Do not truncate a group's identifying codes away while leaving a misleading complete-looking match.

Declare reads and external access accurately. Barcode checks can contact Open Food Facts, even though they create no user check record. Internal cache/quota bookkeeping does not make a check a user-visible publication action. Keep malformed arguments, quota exhaustion, unavailable dependencies and domain inconclusiveness distinct. Returning no search results is never an authoritative product check.

### Search that is complete and bounded

The website currently traverses cached public dataset pages and filters the full regional list in memory. It has no indexed public search API. Reuse that complete eligible snapshot for the initial search service, filter before slicing, and share filter semantics with the website. Do not search just the first displayed page or pass a raw backend cursor through filtered results.

Factor out the cached public-page snapshot loader, retaining start/expiry fields internally and omitting them from the public summary unless needed. Bind a signed opaque cursor to region, normalised filters, dataset revision, offset, `asOf` and expiry. Give it a maximum ten-minute TTL, shortened to the next notice start/end boundary in the snapshot. Reject expired cursors, changed filters or revisions with a recoverable restart response. Apply current eligibility boundaries on every request; a boundary crossing must restart pagination rather than shift an offset silently. Test this even when the dataset revision has not changed. Start with at most 20 summaries per page, a 200-character query and a 64 KiB serialised output target. Treat these as implementation limits to verify with real notices. Paginate large affected-group lists and report completeness explicitly.

Reuse revision-keyed pages; pass an already fetched version/status through the service rather than querying it twice. If full-snapshot filtering becomes too expensive in measured traffic, add a search projection/index in a later PR. Do not pre-emptively pay for another full table index or cache every arbitrary query indefinitely. Keep authoritative checking independent of any search scan budget.

## Anonymous access, privacy and cost controls

Public checking and browsing can start without user accounts. Declare anonymous access explicitly and verify each host's no-auth behaviour. Authenticated private features would require the host's supported MCP OAuth contract. Public sharing is a separate write decision. [OpenAI authentication guidance](https://developers.openai.com/plugins/build/auth).

The owner pilot uses a revocable, connection-scoped read-only MCP key with its own quota. Custom Notion agents require the host's supported authentication. The customer Add to Notion flow instead uses public Notion OAuth and service-held encrypted credentials. Customers never configure MCP keys. Keep a managed service credential server-only and enforce per-installation and shared budgets; never embed a key in a template or use a backend administrative credential. The existing 20-key static configuration is not customer enrollment storage. [Managed installation](./notion-installation-plan.md), [Notion connection authentication](https://www.notion.com/help/mcp-connections-for-custom-agents).

Assistant calls often share cloud egress addresses and may not preserve browser cookies. A claimed host/user ID or MCP session ID is not an authenticated identity. Do not apply the website's anonymous-cookie quota as if it identified an assistant user. Use separate MCP operation buckets, a coarse trusted-network ceiling and a service-wide daily budget. Batch applicable counters in the existing atomic mutation; namespace them so exhausting the pilot budget does not exhaust browser buckets. Each hosted stage consumes Cloudflare resources; keep staging resources and credentials separate from production.

The backend validators and TypeScript quota helpers support website and MCP operations, global/network scopes and hourly/daily windows. Preserve compatibility when extending them. The existing table already stores action as a string, so this needs no extra index or duplicate table. Build the global daily key from a fixed MCP namespace and server-calculated UTC day, with short expiry; network buckets can remain hourly. Test atomic consumption across both windows and unchanged legacy website keys/counts. These controls limit integration work, but their enforcement still consumes D1 reads/writes and Worker requests.

Apply the enable flag and cheap envelope/origin checks before application work. Allow documented server clients without an Origin header; reject invalid supplied origins and untrusted host/proxy claims. Bound tool arguments to the existing 16 KiB check budget, plus a separately bounded protocol envelope. Cap outputs, deadlines and concurrent expensive work. Fail closed when quota enforcement is unavailable. Use hosting ingress protection for discovery/resource abuse, while keeping ordinary discovery and static UI resource reads free of backend calls. Worker-local counters are only supplementary protection.

Propose a small pilot budget of 1,000 checks per day across all MCP hosts, plus separately capped browse/coverage operations. That permits at most 30,000 checks in a 30-day month. This is an application admission ceiling, not a Worker/D1 capacity or price forecast. Tune it after shared-egress tests and a normal production import cycle.

Retain the current product metadata cache, revision-keyed persistent warning pages and bounded prepared matcher cache. Check source health and current notice boundaries on every product check. Do not cache final verdicts across health changes. The 48-hour freshness gate remains; Workers refresh FSA/openFDA daily while the NAS supplies USDA/FDA announcement snapshots.

The earlier Convex samples demonstrate reduced application work, but they do not establish Cloudflare billing or capacity. A production Worker/D1 baseline is still needed. Before broad publication, measure ordinary daily imports, the weekly archive-check cycle, cold/warm checks, search CPU and Vercel active CPU. Include protocol/discovery and embedded UI requests in hosting usage. Retain 20% operating headroom or agree a small overage budget separately. See [current cost and measurement guidance](./cost-estimate.md).

Log operation, latency, result category, dependency failures and aggregate quota/cache metrics. Do not log barcodes, observations, share handles, protocol bodies or personal identifiers. Redact provider/HTTP error bodies too. Disable verbose adapter logs in production. Publish short-lived quota identifiers and retention rules in the privacy policy. No paid analytics service, Redis instance, always-running bot process or model inference is required for the first release.

## ChatGPT interface and package

Use standard MCP Apps resources and the host bridge. Keep every tool useful without rendering. Start with a compact result and an editor for missing evidence; extend to warning detail and coverage views. Reuse brand tokens and presentational primitives, while keeping website navigation, cookies and data-fetching hooks outside the bundle. Version UI resource URIs and use a minimal CSP. A shared protocol does not establish UI support in each host: require actual ChatGPT rendering tests and retain text-only Codex/other-host operation unless their UI is verified. [MCP Apps UI guidance](https://developers.openai.com/plugins/build/chatgpt-ui).

The result shows the server-produced label, region, check time, coverage and official advice. Evidence editing keeps the previous result visibly tied to the previous input until a fresh check succeeds. Opening or remounting a component must not automatically check a product or publish a share. Send committed result summaries/public warning references to model context, not every draft keystroke. Persist harmless preferences only, with no check-history list.

Include invalid barcode/date, unknown product, missing evidence, checking, warning/possible match, qualified no match, stale/missing coverage, dependency error, quota limit and interrupted-request states. Test narrow/wide layouts, light/dark, keyboard focus, screen readers, long codes and several affected groups. Keep a website fallback when UI is unavailable.

Package `plugins/eat-or-yeet/plugin.json`, `mcp.json`, checking/onboarding skills and brand assets using the portable Agent Plugins schemas. Put OpenAI presentation fields under `extensions.com.openai`. Validate referenced paths and build a reproducible credential-free ZIP. Include exactly one remote MCP URL in the first submitted package. Local registered-app mappings are testing configuration; exclude `apps`/`.app.json` references and lifecycle hooks from the public submission ZIP because the current submission flow rejects them. [Package format](https://developers.openai.com/plugins/build/plugins), [submission restrictions](https://developers.openai.com/plugins/deploy/submission).

Native sidebar/panel entrypoints, settings, public-warning mentions, deep links and richer forms are an optional subsequent PR after the SDK gate clears. Feature-detect capabilities. Composer mentions are desktop-only in current guidance, and extension availability varies by plan/client. Keep region/edit controls in the portable UI as fallbacks. [Extensions](https://developers.openai.com/plugins/build/extensions).

## Separate additions

### Notion shopping-list recall nudges

The normal installation is **Add to Notion → native consent and template copy → open the active shopping list**. Vercel handles the OAuth and webhook routes; D1 stores installation state and the transactional outbox delivers review jobs through Cloudflare Queues. Shoppers do not create API connections, run containers, configure webhooks or need Notion AI. Reuse an explicitly selected warning country and ask only when none is selected. The [managed installation plan](./notion-installation-plan.md) describes the customer route. The [customer overview](./notion-shopping.md) and operator runbooks have separate audiences.

Start with an explicitly selected shopping-list database, one UK/US region and an item-name property. Support optional brand, barcode and packet-detail properties, plus a bought/archived flag. A plain checkbox list in a page is a later compatibility task. Review new items and relevant input changes; skip blank or already bought items.

For a generic item such as "milk", show related published warnings and ask the shopper to check the packet. Example copy is "Related UK milk warnings found. These affect specific products and batches; check the brand and packet details." Include actual notice titles, official links, dates, source coverage and the review time. This is discovery, not a product verdict. A row update creates an inline nudge; it does not guarantee a Notion push notification.

Add a read-only `review_shopping_items(region, items[])` tool in this follow-up, with at most 20 bounded items per call. Load the regional snapshot and current source health once per batch. Use deterministic product-name/category relevance and a small tested alias list. A chocolate recall for undeclared milk must not appear merely because the user added milk. Existing broad categories and full-text hazard matches are insufficient. Return the relationship reason, a bounded set of links and a continuation path. Unknown terms or unavailable coverage return an explicit incomplete review. Supplied brand/barcode details can narrow discovery. Offer `check_product` as a separate explicit packet-check action, preserving unresolved batch/date restrictions; do not write a product verdict into the shopping-list row.

Write only dedicated result properties, such as "Related warnings", "Review status" and "Reviewed at". Keep the shopper's item, quantity and bought flag intact. Use qualified states such as "Related warnings found", "No related warnings found in covered data" and "Unable to review". Never label a generic shopping item safe. Forward only the configured item fields to Eat or Yeet, not the page body or unrelated workspace content.

The managed public OAuth/template installation is the customer route. The following remain optional advanced routes:

- **Native Notion Custom Agent.** Configure a page-added or relevant-property-change trigger on the selected database, consume Eat or Yeet MCP and write results through Notion's native tools. Notion triggers start the run; MCP does not. Limit the agent's writable destinations and review its tool permissions during setup. The owner pays any Notion agent credits; Eat or Yeet still runs no model. Test the actual plan, administrator settings and supported key authentication before offering this recipe. [Triggers](https://www.notion.com/help/custom-agents), [custom MCP permissions](https://www.notion.com/help/mcp-connections-for-custom-agents), [credits](https://www.notion.com/help/buy-and-track-notion-credits-for-custom-agents).
- **User-owned webhook workflow.** Provide a deterministic n8n recipe for an owner willing to run it. Subscribe to Notion API page-created/property-updated events, verify the raw request signature, fetch the current row, call the same review tool and update result properties. Tokens stay in the owner's secret store. Grant access only to the selected database and the content capabilities needed for existing-row updates. This avoids model credits but still has hosting and maintenance costs. Use API webhooks rather than assuming an installed n8n Notion Trigger is webhook-based. [Webhook verification](https://developers.notion.com/reference/webhooks), [event delivery](https://developers.notion.com/reference/webhooks-events-delivery), [capabilities](https://developers.notion.com/reference/capabilities).

For API webhooks, inspect changed-property IDs and ignore result-only updates. Custom Agent documentation does not establish filtering by which property changed; require a tested input-fingerprint/status guard that prevents writeback loops. Use the deterministic workflow if native-agent execution cannot meet that gate. Debounce edits, deduplicate event IDs and unchanged inputs, fetch the latest row after delayed events, and discard results if relevant inputs changed during the request. Bound concurrency, respect Notion rate-limit retries and retain only minimal deduplication state for the retry window. Stop cleanly when access is revoked or the configured properties disappear. [Notion request limits](https://developers.notion.com/reference/request-limits).

Reuse regional revision caches and deduplicate identical items within a batch. Check current health and notice eligibility on every review, including cache hits. Apply installation and global integration budgets, with bounded batch size included in quota accounting. The customer release now includes managed OAuth/token storage, tenant-safe queues, management and disconnect as one complete successor to the tested engine. Keep this default-off until a real template-to-first-review installation and isolation tests pass. A future opt-in refresh when warnings change still needs a separate budget and subscription design. Do not poll whole workspaces.

### Shopping agents and opt-in category watches

Support the collaborator's example: a shopper who frequently buys milk can agree to watch milk recalls, receive a relevant new-notice alert, and have their shopping agent avoid affected products when choosing groceries. Reuse the shopping discovery service for category relevance and the deterministic checker for individual products. The current plugin can guide a purchasing agent through those reads; it has no checkout or notification tools.

Before recommending a product or finalising a cart, check its known brand/barcode and any available packet restrictions in the explicitly selected region. Exclude a confirmed affected product. A possible match or unresolved batch/date restriction requires a closer packet check or an alternative; do not silently treat it as cleared. Recheck material cart changes and source freshness before checkout. Preserve an inconclusive result if coverage is unavailable. Every replacement needs its own check. A milk-category notice alerts the shopper to specific affected products; it does not exclude all milk or apply a chocolate allergen warning to milk purchases.

When category watches are implemented, use the existing Vercel API with D1 state and Cloudflare Cron/Queue jobs. A watch is persistent only after the user explicitly agrees to its region, category and delivery preferences. The agent may suggest a category from shopping context, but must obtain that consent before creation. Store the agreed selectors, not purchase history, and provide pause, removal and expiry controls. The feature has no project NAS dependency.

Use Cloudflare Cron Triggers and Queue jobs to check regional revision and coverage at a bounded interval, then reuse the changed snapshot across watches. Avoid per-item or whole-workspace polling. Deduplicate by watch, public warning and affected-group content revision; coalesce related notices. Alert on newly relevant or materially changed recalls, including official advice, affected products/batches/dates, source link, region and review time. Handle withdrawn notices and a transition to incomplete coverage explicitly. Optional delivery adapters may send alerts through a user-selected external channel; keep any channel credentials scoped to that adapter, honour quiet preferences, and bound retries, concurrency and retained deduplication state. A category alert is advisory discovery, while product exclusion uses the returned match evidence.

Implement this as one follow-up PR containing the watch contract and consented D1 state, bounded Vercel API handlers, a Cloudflare Queue worker, shopping-agent instructions, optional delivery adapters and tests for opt-in/removal, relevance, duplicate imports, changed/withdrawn notices, coverage failures and cart decisions. Enforce per-user/connection limits and a global work budget. Actual recurring delivery requires an enabled service and a selected delivery route; the public plugin must not promise alerts before that gate is met. Reuse the existing hosting and data services, with no NAS deployment dependency.

### Explicit public sharing

Add `create_public_share` only after confirming each release host's write/auth and approval behaviour. OpenAI recommends authentication for write actions; our current browser uses a short-lived signed capability rather than an account. Establish whether the proposed sanitised anonymous publication is acceptable before exposing it through an installed plugin. The read-only release remains useful while that decision is unresolved.

Reuse the existing 15-minute signed result capability and 24-hour public expiry. Treat a share handle as authority to publish only that fixed sanitised snapshot, never arbitrary model-supplied result copy. Reject `NO_CLUE`, invalid/expired handles and unrequested publication in host/UI flows. A model-supplied `confirmed: true` is not proof of user approval.

Add atomic retry idempotency in `backend/shares.ts`, scoped to the validated capability and an idempotency key. Store only a keyed digest, public share ID and expiry, with existing temporary-data cleanup. Do not store the handle or entered evidence. Retries return the same link. Mark the tool as a write and use an explicit UI action/host approval; check/search tools never create a share automatically. Keep the browser share path compatible and test lost-response retries.

### Native messaging bots

Start with `/check region:US barcode:044000061494` and warning/coverage commands. Use deterministic command fields and follow-up controls; there is no need to buy a model to interpret free text. Provide an optional-field form for label details. Default to private/ephemeral replies where the channel supports them; do not broadcast entered details or send unsolicited alerts.

For Discord, use an HTTP interactions endpoint, verify signed raw requests and application identity, handle PING, and respect initial-response deadlines with the supported deferred-response lifecycle. Avoid a Gateway process and broad message-reading permissions. Deduplicate interaction IDs with short-lived records. Verify retry handling and completion within the host lifecycle before shipping; do not depend on fire-and-forget promises. [Discord interactions](https://docs.discord.com/developers/interactions/receiving-and-responding).

Slack needs its own signed-request/timestamp checks, installation credentials, acknowledgement and response flow. Telegram needs its webhook secret and update-ID deduplication. Each adapter uses verified platform identity for hashed per-user/workspace quotas and calls shared services directly when hosted in the same app. Retain credentials in deployment secret storage. If delayed jobs require temporary entered evidence, specify and disclose a short processing TTL before adding durable storage. [Slack verification](https://docs.slack.dev/authentication/verifying-requests-from-slack/), [Telegram webhooks](https://core.telegram.org/bots/api#setwebhook).

## PR split and sequencing

Use four core PRs with complete, reviewable outcomes. Keep the transport experiment inside the MCP PR, and combine implementation, tests and relevant docs in each PR. Do not create separate PRs for each tool, schema file, quota helper, manifest or copied host recipe. Split again only if a concrete independent behaviour or review size warrants it.

| PR | Scope and reviewable result | Dependencies and release behaviour |
| --- | --- | --- |
| 1. Shared services and public contracts | Extract check orchestration, add whitelisted output mapping and strict agent schemas, implement complete cached warning search/cursors, and add parity/grouping/search tests. Website check responses, errors and quotas remain compatible. No public endpoint yet. | First. Merge independently; no new public behaviour or provider account required. |
| 2. Hosted MCP with bounded anonymous access | One `/mcp` endpoint with all four read tools, protocol-generation support, input/output validation, isolated atomic quotas, limits, redacted metrics and a default-off `MCP_ENABLED` flag. Include Inspector/transport tests and a live custom ChatGPT smoke test. | PR 1. Spike adapter/SDK compatibility first, then finish this vertical slice. Keep production's flag unset; disabled handling precedes discovery/work. Enable only on the controlled development/preview pilot. No separate quota follow-up that would leave an unprotected endpoint. |
| 3. Portable ChatGPT UI and installable plugin | Inline result/evidence editor, warning and coverage views, static bundle/resources/CSP, checking/onboarding skills, portable manifest, ZIP validation and host/UI tests. Test installation in ChatGPT and Codex with a text-only fallback. | PR 2. Keep package and UI together so the installed plugin is testable. Include no unsupported native extension shim or public sharing tool. |
| 4. Host compatibility and release preparation | Actual Grok/Muse pilot checks, Claude/Cursor/Gemini/n8n recipes and smoke results, privacy/support documentation, review cases, walkthrough/package tooling, measured capacity report and rollback runbook. Record Notion's authentication/plan requirements and manual core-tool compatibility if available; its shopping-list workflow belongs in the follow-up. Small necessary compatibility fixes belong here with their tests. | Start documented client checks after PR 2; finalise after PR 3. Parallelise host validation and submission preparation. Provider permissions/review waits are tracked release tasks, not empty code PRs. |

PRs 1–3 form a dependency chain. PR 4 can proceed alongside UI work once the tool contract is stable. Keep dependent branches based on the preceding branch, retarget/rebase after it merges, and describe each PR's own delta. Do not make a giant cross-platform PR or break up tightly coupled safety work just to reach a line-count target.

Follow-up PRs are independent additions, not prerequisites for the read-only launch:

| Addition | PR boundary | Depends on |
| --- | --- | --- |
| Notion review engine and operator pilot, PR #7 | Deterministic related-warning service, batch tool, private MCP authentication/quotas and single-installation durable worker, template and operator runbook. Live automatic writeback is verified. This is an internal engine, not customer-ready installation. | Shared services and MCP. Review and merge independently; no customer installation promise. |
| Managed Add to Notion installation | Public OAuth/template onboarding, automatic database/property binding, encrypted credential lifecycle, D1/Queue-backed tenant-safe processing and quotas, management/pause/reconnect/disconnect and short customer help in one feature PR. | PR #7. One-time public connection/template setup and live multi-workspace acceptance. Default-off until the full customer journey works. |
| Shopping-agent category watches | Opt-in region/category preferences, revision-triggered refresh, deduplicated notification delivery and product-exclusion instructions/tests in one feature PR. Use existing Vercel routes with D1 state and Cloudflare Queue jobs; deliver notices through the selected notification channel. Alert on category relevance and use product/packet evidence when excluding cart items. | Notion shopping discovery and a selected delivery channel. No purchase-history ingestion or separate NAS service in this slice. |
| Public sharing | Capability-backed write tool, atomic idempotency, cleanup, host approval/auth verification and UI button with regressions in one PR | PR 2; UI portion after PR 3; resolved host write/auth gate |
| Discord bot | Commands, verified webhook, deferred completion, deduplication, channel quotas, installation docs and tests in one PR | PR 1 services and established integration quota patterns |
| Slack or Telegram | One PR per requested channel because installation, trust and reply semantics differ | Shared services and quota patterns; no need to wait for Discord |
| Native ChatGPT extensions | Sidebar/panel entrypoints, settings and supported mentions/forms with capability fallbacks in one cohesive PR | PR 3 and verified SDK/client compatibility; split a form feature only if it changes the transport |
| External REST/OpenAPI adapter | Versioned transport over the same services, scoped authentication and contract tests | A concrete non-MCP client requirement |

Expect roughly two engineering weeks for the core services, MCP, UI and host QA, with transport/search complexity as the main uncertainty. Notion shopping-list reviews, native bots and public-write support add scope. Marketplace reviews, publisher verification and the SDK gate do not have a dependable completion date. Re-estimate after PR 2's transport and usage measurements.

## Verification and release gates

Each implementation PR runs lint, type checking, focused unit tests and a production build. Run the full unit/browser suite when shared website behaviour changes and before release. Audit newly introduced production dependencies and document any outstanding findings rather than claiming an unrelated existing advisory is fixed.

Use account-free local Wrangler/D1 and deterministic source fixtures for ordinary tests. Keep demo data out of public listings. Host tests use a private tunnel or controlled preview with deliberately current source status; do not enable daily imports on every cloud preview. [OpenAI connection testing](https://developers.openai.com/plugins/deploy/connect-chatgpt).

The regression matrix covers:

- Oreo barcode `044000061494` in US, using fixed product/source fixtures and a qualified unmatched result when appropriate. Test barcode-only checks and expired/unknown metadata; no fallback to an unhelpful form solely because optional fields are absent.
- A known recalled barcode, including `100001000297` in the recorded FDA fixture, plus missing/matching/wrong batch/date restrictions. Do not require a historical recall to remain active in the live source forever.
- Unknown barcode, insufficient evidence, ambiguous dates and attempts to combine evidence across affected groups.
- Missing/stale/failed source coverage with warm caches, dependency outages, revision changes, notice start/expiry boundaries and cold page failures.
- Search matches beyond the first page, complete pagination, cursor tampering/filter changes/revision expiry and large grouped details.
- Cookie-free/shared-egress calls, quota exhaustion, fail-closed counters, protocol generations, cancelled work, remounts and duplicate requests.
- Actual installed host tool selection, region clarification, qualified copy, official advice links and unsupported UI fallback.
- For managed Notion installation, the template-to-first-review journey without Notion AI or technical steps, OAuth state replay/cookie binding, missing templates, duplicate callbacks, two workspaces/users, credential rotation, session recovery, reconnect and disconnect during processing. Verify isolated queues/pauses and per-installation/global budgets.
- For Notion review behaviour, generic milk versus allergen-only milk mentions, brand/barcode narrowing, UK/US separation, stale coverage, blank/bought rows, batch limits and duplicate items. Test input edits during a run, duplicate/out-of-order events, result-write loops, revoked keys/access, property renames and rate-limit retries. Verify that only configured input fields leave Notion and only dedicated result properties change.

For OpenAI review, prepare five positive cases covering barcode-only checking, a grouped restriction clarification, complete warning search/detail, coverage and evidence editing. Prepare three negative cases for an unknown identity, stale coverage and attempts to publish or infer safety without a supported authorised action. Supply an accessible walkthrough, release notes and any required test credentials privately. Complete domain verification at the portal's challenge URL. [Review requirements](https://developers.openai.com/plugins/deploy/submission).

Prepare complete primary-platform integrations in parallel and retain the proposed coordinated ChatGPT/Codex, Grok and Muse announcement. OpenAI and Muse require their documented submission/review paths. Grok's release deliverable is a tested manual/custom or team-managed MCP installation guide; no third-party public connector directory or listing approval has been established. Actual installation availability is a gate for each route. There is no cross-provider atomic publish operation. If publisher access or intake blocks a primary host, resolve the release scope explicitly before announcing a date; do not invent a listing or describe custom/team setup as a public marketplace release.

Apply additive D1 migrations and deploy the compatible Worker before Next.js. Confirm live source health, a known fixture/live warning, Oreo checking, trusted proxy behaviour and measured resource use. Enable the MCP pilot independently from the website. Disable it through `MCP_ENABLED` if its quotas, errors or cost exceed the agreed budget; preserve website checks and source refreshes. Give native bot adapters their own enable switches. Keep the canonical submitted MCP URL stable; OpenAI's current update flow does not support self-serve URL changes. [Submission/update flow](https://developers.openai.com/plugins/deploy/submission).

The core service, MCP, plugin and embedded interface implementation is ready for review. The single-installation Notion engine passed a live pilot. Managed Add to Notion uses Vercel and Cloudflare and is not generally available pending Cloudflare live acceptance and multi-workspace checks; passing the owner pilot does not complete the customer release. Continue host acceptance independently. Shopping-agent category watches remain a separate addition and can use the existing Vercel/Cloudflare deployment; current checking skills already require affected-product exclusion and qualified replacement checks.
