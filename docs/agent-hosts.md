# Agent host compatibility and release guide

Status: **ready for review**, not a release sign-off. These recipes describe documented host setup. A local MCP protocol test does not prove that a host product, plan, account, or model can connect or present the optional UI.

The endpoint intended for client configuration is `https://eatoryeet.app/mcp`. Production currently keeps MCP disabled by default. Do not submit, connect, or tell external hosts to use that URL until the release gate enables it after review. For local host acceptance, use a reachable test deployment and a dedicated test account where required. Never put tokens in checked-in configuration examples.

## Scope and evidence

The server currently exposes four anonymous, read-only MCP tools: `check_product`, `search_warnings`, `get_warning`, and `get_coverage`. The private, authorization-gated Notion shopping tool is outside this public compatibility claim. Consumer bot adapters and coordinated agent workflows are follow-up work; there is no implemented native bot or multi-agent connector to claim here.

| Layer | Verified evidence | What it does not establish |
| --- | --- | --- |
| Runtime tested locally | Node v24.10.0, Next.js 16.4.0, `@modelcontextprotocol/server` 2.3.1, `@modelcontextprotocol/client` 2.3.1, `@modelcontextprotocol/ext-apps` 2.0.3, Zod 4.6.5 (working-tree lockfile pins) | Compatibility with any released host app/version or deployment environment |
| Protocol smoke | SDK client exercised modern `2026-07-28` discovery and the legacy initialize/list/call path against local Next HTTP. The four tool descriptors were discovered. GET and DELETE returned 405. | Real host authentication, model tool selection, account tier, iframe/UI behavior, public production availability |
| Fixture exercise | Oreo US barcode `044000061494` returned an inconclusive result because coverage was missing. FDA fixture barcode `100001000297` is available for controlled missing/matching/wrong batch/date cases. | A current live-source recall result, a safety conclusion, or validation of the historical recall against today's upstream feed |
| OpenAI portable package | Root `plugin.json` and `mcp.json` ZIP passed schema validation in the existing package check. | OpenAI directory approval, a ChatGPT/Codex live connection, publication, or UI rendering |
| MCP Apps resource | Built HTML is approximately 630 KiB. Local modern/legacy HTTP resource responses were approximately 668 KiB each without Content-Encoding. Official AppBridge browser tests pass on mobile and desktop. | Host display, bridge behavior, CSP acceptance, or final compressed/served payload size |
| Production deployment | `https://eatoryeet.app/mcp` is the intended stable endpoint; production enablement remains off by default. | That the endpoint is enabled, reachable, correctly attributed through Vercel context, or protected by a configured edge firewall |

No host-specific release version or account tier has been tested. Record the exact app/client version, OS, plan/tier, endpoint build, transport, and date after a human performs each acceptance run. Do not infer a host test from a shared MCP SDK test.

## Host setup recipes

Use the endpoint only after a reviewer confirms the release gate is open. All snippets use an environment placeholder and contain no credential. The present public endpoint is anonymous, so omit auth headers. The separate `/mcp/notion` route requires an owner-scoped key and is outside these public recipes. If a future private server requires auth, use the host's credential store or its documented environment-backed secret mechanism rather than committing a token.

### Codex CLI and desktop

Codex reads MCP servers from `~/.codex/config.toml` (shared by CLI and IDE) and supports `codex mcp add`:

```sh
codex mcp add eat-or-yeet --url "$MCP_URL"
codex mcp list
```

Or add this to `~/.codex/config.toml`:

```toml
[mcp_servers.eat_or_yeet]
url = "https://eatoryeet.app/mcp"
```

Then restart/reload the MCP client if needed, inspect the discovered tool names, and run the acceptance cases below. Configuring the URL does not make the production endpoint available while its release gate is off. [Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)

### Cursor

Cursor documents remote Streamable HTTP MCP servers in `mcp.json`. Add to user `~/.cursor/mcp.json` or project `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "eat-or-yeet": {
      "url": "https://eatoryeet.app/mcp"
    }
  }
}
```

Reload Cursor, open the MCP settings/tools panel, and confirm the four tool definitions before running acceptance cases. Cursor's current docs say it supports remote Streamable HTTP, but do not specify the 2026-07-28 protocol revision. There is no Cursor app version or account tier recorded as tested here. Test both the modern and legacy flows before claiming support. [Cursor MCP documentation](https://docs.cursor.com/context/model-context-protocol)

### Gemini CLI

Gemini CLI uses `mcpServers` in `~/.gemini/settings.json` or workspace `.gemini/settings.json`. For Streamable HTTP, the documented key is `httpUrl`:

```json
{
  "mcpServers": {
    "eat-or-yeet": {
      "httpUrl": "https://eatoryeet.app/mcp"
    }
  }
}
```

Alternatively run `gemini mcp add --transport http eat-or-yeet "$MCP_URL"`. Check `gemini mcp list` or `/mcp` in the CLI for connection and tool discovery. Do not set `trust: true`; retain the client's confirmation behavior. No Gemini CLI version or model/tier has been tested. [Gemini CLI MCP documentation](https://google-gemini.github.io/gemini-cli/docs/tools/mcp-server.html)

### n8n

n8n's **MCP Client** node connects to an external MCP server as a regular workflow node. For an AI Agent, use **MCP Client Tool**. In the node UI, choose Streamable HTTP, set MCP endpoint URL to `https://eatoryeet.app/mcp`, set Authentication to None for the current anonymous endpoint, and use a bounded node timeout. The node fetches its tool list; select one tool and use JSON input mode for nested arguments. Run a manual execution first and inspect the execution result for accidental persistence of entered product data.

n8n documents Bearer, generic header, multiple-header, and OAuth2 credentials for its MCP Client node. Do not create or embed a token for this public anonymous service. The separate **MCP Server Trigger** node exposes n8n workflows; it is not the node for consuming this service. No n8n version, hosting tier, or actual workflow run has been tested. [MCP Client](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-langchain.mcpclient/) · [MCP Client Tool](https://docs.n8n.io/integrations/builtin/cluster-nodes/sub-nodes/n8n-nodes-langchain.toolmcp/) · [n8n MCP Server Trigger](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-langchain.mcptrigger/)

### ChatGPT plugin / custom MCP connection

For a manual private acceptance connection, use ChatGPT's **Add custom MCP server** flow in the Plugins area, enter the test endpoint, review the risk notice, and create a plugin. This requires an account and UI access; the person testing must confirm the connection and tool list in ChatGPT. The local plugin package schema check is not a connection test.

The portable package uses root `plugin.json` and root `mcp.json`; `mcp.json` declares `type: "streamable-http"` and the server URL. Its manifest points to `https://agent-plugins.org/schemas/1.0.0/plugin.schema.json`; the MCP file points to `https://agent-plugins.org/schemas/1.0.0/mcp.schema.json`. OpenAI-specific metadata belongs under `extensions.com.openai`. Keep the OpenAI compatibility layer on the shared MCP Apps `ui/*` JSON-RPC `postMessage` bridge and `_meta.ui.resourceUri`; do not make `window.openai` required for core rendering. A ChatGPT UI acceptance run still needs to exercise this app through a real account.

OpenAI's current extension peer dependency mismatch is a release gate for any native extension-specific layer. Do not force an SDK major override to build optional native extensions. [Package a plugin](https://developers.openai.com/plugins/build/plugins) · [Connect and test in ChatGPT](https://developers.openai.com/plugins/deploy/connect-chatgpt) · [ChatGPT UI and MCP Apps bridge](https://developers.openai.com/plugins/build/chatgpt-ui)

### Grok

Grok's official docs describe a manual custom MCP connector: open `grok.com/connectors`, choose **New Connector** then **Custom**, enter the public MCP URL, and complete any authentication flow. The server must be reachable from the public internet. Use a dedicated acceptance account and verify all four discovered tools and the positive/negative cases below. The public route is not available until production is explicitly enabled; a private local server cannot be entered directly without a public tunnel, and a temporary tunnel is not a release endpoint. No Grok product version, subscription tier, connector, or tool call has been tested. [Grok custom MCP connectors](https://docs.x.ai/grok/connectors) · [Grok public reachability guidance](https://docs.x.ai/grok/connectors/custom-mcp-tunneling)

### Meta Muse Connector Platform

This means Meta's personal AI agent and its **Muse Connector Platform** at `muse.ai`, not Muse Code or an unrelated product named Muse. Meta's official platform describes submission for functional, security, legal, and end-to-end review before a connector appears in Muse. Its guidelines require endpoint/authentication and tool documentation, privacy/data processing information, legal and support contacts, business verification, a test account, test data, and a demo. Start at [Muse Connector Platform](https://muse.ai/platform) and follow its current submission form and guidelines.

The public docs establish a submit-for-review route, not a verified self-serve “add arbitrary MCP URL” flow. No Muse account, connector submission, review, or live compatibility has been performed. Treat this as a post-release submission/acceptance gate, not a ready-to-use connection recipe. Do not substitute Muse Code documentation or unrelated projects called Muse.

## Acceptance walkthrough

Use deterministic fixtures in a local/staging deployment with mocked upstreams when possible. For public host acceptance, use the approved non-production endpoint and dedicated reviewer accounts. Capture a redacted result, endpoint build ID, client app/version, OS, account tier, date, tool names, and whether the UI rendered. Do not record raw request bodies, user-entered labels, auth material, or personal account data.

Positive cases:

1. `check_product` with US barcode-only Oreo `044000061494`. Confirm the output says the result is inconclusive when source coverage is missing, and never describes no match as safe.
2. `check_product` with known FDA fixture `100001000297` and no lot/date. Confirm unresolved restrictions are stated.
3. Repeat the fixture with matching and then wrong batch/date evidence. Confirm the historical fixture's expected match and non-match behavior; keep these fixture results clearly identified as fixture behavior, not today's live recall state.
4. `search_warnings` through a large result group using the continuation cursor until the last page. Confirm filters and cursors work, page completeness is clear, and the final page does not claim more results remain.
5. `get_coverage` for both supported regions and open a returned warning detail. Confirm source freshness/limitations and official source links are visible. If the MCP App is supported, check rendered resource size, bridge tool-call behavior, layout, and text-only fallback.

Negative cases:

1. Unknown barcode/product evidence must remain unknown or unmatched. The host must not invent a product identity.
2. Stale/unavailable source coverage must produce an explicit incomplete/inconclusive result, never a safety assurance.
3. Ask the agent to declare a product safe or to make/announce a recall determination from an unmatched result. It must refuse the unsupported conclusion and explain the evidence boundary.

For every host, also verify schema rejection of an unknown input field and oversized arguments, unknown tool handling, client cancellation, and a safe timeout. Confirm UI editor changes only local draft state and never writes back to the server. Check that tool errors do not reveal upstream bodies, internal exception text, tokens, cookies, request IDs that expose internals, or private Notion data.

## Release, privacy, and operations gates

The route must remain production-off until the human review/merge gate opens. Before enabling it:

- Verify `MCP_ENABLED` is explicitly enabled only in the intended environment. Confirm production stays off when unset and `OPTIONS`/health routes do not accidentally activate the MCP endpoint.
- Validate no-auth origin policy against the real Next/Vercel request context. Test trusted local origins separately from arbitrary `Origin`, `Host`, and `X-Forwarded-*` values. Verify Vercel's trusted client/network context is consumed only through the documented runtime helper; do not trust spoofable forwarded headers directly. Record the deployed function/runtime, region, and request-context setup.
- Check request cancellation propagation from client disconnect through the SDK to the tool service and upstream fetch. Check finite response buffering and hard request/response limits, including an oversized generated result.
- Verify public rate quotas and network-subject partitioning with Vercel preview and production traffic. Record how local development uses its explicit development subject. Confirm no personal data is used as a quota key.
- Review Vercel Firewall configuration in the account/project if a firewall rule is intended. No firewall is claimed configured by this guide.
- Publish direct, working Privacy Policy, Terms of Service, Support, and security-contact URLs. The portable OpenAI listing needs publisher identity and listing metadata; submission additionally requires actual demo/review materials and public endpoint access. The Muse submission asks for privacy, product/legal terms, support/security contacts, business verification, data-processing answers, test account/data, and a demo. Avoid adding duplicate boilerplate pages; fill genuine missing destinations and make claims match actual retention, logging, telemetry, and third-party processors.
- Keep the public four-tool allowlist explicit. Do not expose the private Notion tool on the anonymous endpoint.
- Run a final host-specific UI + text acceptance before saying a host is supported. Review/publication and endpoint enablement are separate decisions.

## Cost and payload measurement

Run `pnpm test:mcp http://localhost:3100/mcp` (or a controlled test deployment). The official SDK probe exercises both modern `2026-07-28` and legacy flows, the four tool descriptors and calls, fixed US Oreo checking, search, coverage, a warning detail when search returns a summary, and the app resource when advertised. It reports when detail is skipped because search returned no summaries. The probe prints only qualified status, counts and per-exchange HTTP status, elapsed time, request/response bytes and Content-Encoding. It bounds responses and deadlines, refuses URLs with credentials, query strings or fragments and refuses the production domain. SDK/provider errors are redacted. It sends no authentication and never prints product inputs or response bodies. A tool error fails the smoke rather than inventing a result. Do not duplicate this with a second hand-written protocol client.

Measure and record separately:

1. Cold discovery: restart the test deployment or create a new client session. Modern MCP runs `server/discover` + `tools/list`; legacy MCP runs `initialize` + `tools/list`. Record client and server time and total request/response bytes for each path.
2. Warm single tool: call each of the four public tools once with fixed fixture inputs. Record tool latency and response bytes for each, plus upstream request count/egress if Vercel/provider instrumentation can identify it.
3. Batch versus per-item estimate: compare one fixed batch workflow with equivalent individual calls, using the same fixture and filters. Record actual HTTP requests, upstream provider requests, compute duration, and bytes. Do not label a projection from local calls as a bill or measured production cost.
4. Search pagination: count each page request and response separately, including cursor length and cumulative bytes for a large group.
5. UI resource transfer: measure the response bytes after the production build/encoding and the compressed bytes actually served. Local full JSON-RPC app transfer measured about 668 KiB without compression. Host caching and actual Vercel content encoding remain unmeasured.

Use deployment/provider dashboards or existing logs to determine actual billing units and their applicable rates. Keep synthetic fixtures, not personal inputs, in measurements. Record date, deployment region, runtime, concurrency, cache state, and exact tool arguments schema revision so later comparisons are meaningful.

### Local pilot sample, 9 October 2026

The official-client probe used Node 24.10.0 against the isolated Next development stack, with two fictional warning fixtures and incomplete source coverage. Both protocol flows discovered all four public tools; US Oreo stayed inconclusive and `get_warning` validated the first search result. In the modern flow, discovery was 700 response bytes, `tools/list` 27.2 KiB, coverage 1.2 KiB, barcode check 2.4 KiB, search 2.5 KiB, warning detail 1.3 KiB, and the app resource JSON-RPC response 684,590 bytes. The HTML itself was 645,479 bytes. Modern request wall times ranged from 12 to 222 ms, including one slower initial discovery; legacy requests ranged from 4 to 13 ms. These are local client wall times, not Vercel active CPU or deployment cold-start measurements. The app response had no `Content-Encoding` header in this run.

The app's full JSON-RPC response was approximately 668 KiB with no Content-Encoding header locally. Encoding/compression estimates are documented in [the app guide](./mcp-app.md). At 1,000 daily sessions for 30 days, one uncached app read per session is roughly 20.5 GB of response bodies; three reads is roughly 61.5 GB. This arithmetic excludes other responses, requests and provider accounting. Host cache reuse and production compression can change it substantially. Keep UI discovery/resource traffic in capacity projections even though it makes no Convex call.

The public daily quotas permit at most 30,000 checks, 90,000 browse operations and 60,000 coverage calls in a 30-day month. An optimistic warm projection of three Convex calls per check and two per browse/coverage operation would consume about 390,000 calls at those ceilings, before imports, cold pages, metadata writes, website traffic and private integrations. At that level, a one-million-call budget with 20% reserved leaves about 410,000 calls for other work. The existing website assumption of 300 monthly calls per DAU would fit about 1,367 DAU before those other costs. This is a scenario, not an agent DAU or fully free headroom guarantee. Private shopping quotas are separate additional usage. See [the existing capacity assumptions](./convex-usage.md).

Keep ordinary tests on local Convex. A cloud pilot should use a deliberately small fixture dataset and disable scheduled source refreshes on its identified preview backend; do not duplicate a full production import per review branch. Production freshness remains enabled. Quotas and read bounds contain admitted work, while rejected requests, cold cache misses and platform ingress still have costs. Measure the steady import baseline and actual active CPU before expanding the pilot.

On 9 October, the five integration preview backends for PRs #2, #3, #4, #5 and #7 were individually identified as previews and configured with `SCHEDULED_SOURCE_REFRESH=false`. Each setting was read back. Production's setting remains unset, preserving its default enabled refresh behaviour. The preview cron still invokes its cheap disabled wrapper, and temporary-record cleanup remains scheduled; this change prevents each review branch from importing its own daily copy of official warnings. Apply the same setting to future verified previews rather than changing production freshness or assuming a new preview inherits it.

## Source documents

- [Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
- [Cursor MCP support](https://docs.cursor.com/context/model-context-protocol)
- [Gemini CLI MCP settings](https://google-gemini.github.io/gemini-cli/docs/tools/mcp-server.html)
- [n8n MCP Client node](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-langchain.mcpclient/)
- [n8n MCP Client Tool node](https://docs.n8n.io/integrations/builtin/cluster-nodes/sub-nodes/n8n-nodes-langchain.toolmcp/)
- [ChatGPT portable packaging](https://developers.openai.com/plugins/build/plugins)
- [ChatGPT connection testing](https://developers.openai.com/plugins/deploy/connect-chatgpt)
- [OpenAI plugin submission requirements](https://developers.openai.com/plugins/deploy/submission)
- [MCP Apps shared UI and bridge](https://developers.openai.com/plugins/build/chatgpt-ui)
- [Grok connector setup](https://docs.x.ai/grok/connectors)
- [Meta Muse Connector Platform](https://muse.ai/platform) and [connector guidelines](https://muse.ai/platform/docs)
