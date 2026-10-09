# Agent integration spec review

Reviewed: 9 October 2026. Baseline: [integration plan](./plugin-integration-plan.md), including Ben's shopping-agent requirements. The review inspected the implementation branches and current GitHub review results. It did not run an installed agent host or a live Notion pilot.

The full spec is incomplete. The shared services, public MCP tools, embedded app and portable package are implemented and locally verified. The host acceptance and release work is partial. Notion has an implemented discovery service and direct owner-run worker, with several literal plan requirements still missing. Explicit follow-ups remain unimplemented.

## Requirement assessment

| Requirement | Assessment | Evidence or remaining work |
| --- | --- | --- |
| Shared deterministic checker; unchanged website boundary | Implemented and tested | `src/lib/checks/service.ts`, website route parity tests and Oreo regressions. No agent-specific matcher or model inference. PR #2. |
| Explicit region, strict public schemas, qualified results, same-group restrictions | Implemented and tested | `src/lib/integrations/contracts.ts`, `serialize.ts`, contract and matcher tests. Unknown fields are rejected, enrichment is separate, and no match is not a safety verdict. |
| Complete warning search, bounded snapshots and signed pagination | Implemented and tested | Search filters the complete eligible snapshot before paging. Revision, expiry, eligibility and content changes invalidate cursors. Whole affected groups are paged and completeness is exposed. |
| Four read tools, atomic isolated quotas, deadlines, cancellation and default-off flag | Implemented and tested locally | Official SDK modern/legacy HTTP smoke and transport tests pass. Already submitted Convex work may finish after cancellation; late results are discarded. Actual Vercel request attribution, shared cloud-egress behavior and ingress protection remain acceptance checks. PR #3. |
| Result editor, warning/coverage views, CSP and deterministic plugin ZIP | Implemented and locally verified | Official AppBridge browser tests, package/schema tests and production build. This proves the code and local bridge, not installation or UI acceptance in ChatGPT/Codex. PR #4. |
| Real host acceptance | Incomplete | No actual ChatGPT/Codex plugin install or Grok/Muse pilot. Claude/Cursor/Gemini/n8n setup is documented but not tested in those hosts. The plan explicitly requires these runs in its core PR boundaries. |
| Capacity and operating headroom | Partial | Local HTTP/payload measurements and quota scenarios exist. Normal daily/weekly import baseline, cloud active CPU, cold-cache cost, actual UI compression/cache reuse and measured agent capacity remain unverified. Six verified preview imports were disabled; production freshness was preserved. |
| Release and publisher material | Incomplete | Privacy, setup, acceptance cases and rollback guidance exist. Real publisher identity/domain verification, support/terms/security destinations, accessible review walkthrough, account eligibility and submission/approval remain to complete. Production MCP is still default-off. |
| Notion per-row review and scoped read key | Implemented with local tests | Private `/mcp/notion`, weighted connection/global quotas, deterministic relevance, current-input guards, durable queue, retries and dedicated-property writeback. PR #7. |
| Optional Notion packet details and explicit packet check | Missing from the Notion route | The shopping schema and worker accept name/brand/barcode/bought only. The private tool list has no `check_product`. The [Notion requirements](./plugin-integration-plan.md#notion-shopping-list-recall-nudges) require these. The public tool supports packet checking, but the Notion recipe does not expose the separate action. |
| Shopping-list template and n8n recipe | Partial / missing | Property setup and an example owner-worker config exist. There is no ready-to-duplicate database template or n8n workflow/step-by-step recipe. The direct Node worker is executable, but it does not fulfil the literal n8n/template deliverables in the Notion section and PR split. |
| Notion native-agent and owner deployment acceptance | Incomplete | Native-agent instructions are conditional on actual permissions/trigger/guard support. No live owner database, webhook handoff, reverse proxy, key or writeback pilot has run. Node 24/SQLite smoke passed; the Docker image build has not been verified. |
| Shopping-agent product exclusion | Instructions implemented; host behavior unverified | Checking skill requires checks before cart decisions, confirmed-product exclusion, preserved batch uncertainty and individually checked replacements. Host acceptance cases exist. No installed purchasing agent has demonstrated the behavior. |
| Persistent category watches and notifications | Explicit follow-up, unimplemented | No watch state, revision worker, delivery adapter, opt-in/removal/expiry controls or ongoing notification tests. Ben's requirements are in the plan; current per-row review does not provide monitoring. |
| Public sharing, native bots, native ChatGPT extensions, REST adapter | Explicit follow-ups, unimplemented | These are outside the four-tool core. They should not count as failures of that core, and should not be described as shipped features. |

## Findings from this review

At Notion commit `d57e4ef`, the worker discarded the total matching-notice count, overreported retained relationship evidence, selected the website link instead of the official source link, and dropped source-specific coverage from the writeback path. Those output issues violated the plan's completeness and official-evidence requirements. Commit `6666716` in PR #7 fixes them. Parser-to-writeback regressions cover the total, coverage, official links and later relationship evidence, plus a compact fallback that retains a complete official URL when full notice evidence cannot fit. All 369 unit tests, type checking, lint and the production build pass on that commit.

The installed MCP SDK also emits a warning when a JSON-mode handler is created. Since transports are created per request, verify the production log behavior against the spec's quiet-adapter requirement before enablement; redacted application operation logs alone do not establish that this SDK output is quiet.

## Completion order

1. Review the completed Notion output fixes. Preserve the plan's packet/template/n8n requirements as open work rather than silently reducing scope.
2. Complete the optional packet-input/explicit-check path and usable Notion template, then build the container and run one owner-controlled end-to-end pilot. Explicitly decide whether the direct NAS worker replaces the planned n8n recipe; maintaining both should require a real n8n user need.
3. Run actual ChatGPT/Codex acceptance and the agreed Grok/Muse route. Exercise tool selection, region clarification, qualified copy, replacement decisions and unsupported-UI fallback. Record exact host versions, accounts and deployment builds.
4. Complete controlled Vercel ingress/cancellation and cost measurements, publisher materials and review. Keep production off until those release gates are accepted.
5. Implement category watches as their planned feature PR once the owner workflow and delivery destination are agreed. Native bots and other optional additions remain separate.

This review reran the Notion branch's full required checks with 369 passing unit tests. Prior verification passed 303 unit tests on the plugin branch, 62 plugin browser cases and 48 design browser cases, plus the corresponding lint/type/build checks. Browser checks were not repeated for this worker-only change. These counts establish local regression evidence, not completion of the external acceptance gates above.
