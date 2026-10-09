# Embedded result and evidence editor

The optional MCP App uses the standard `ui/*` bridge from MCP Apps 2.0.3. `check_product` and `get_warning` advertise `ui://eat-or-yeet/result-v1.html`; search and coverage return data without mounting a new view. Every tool retains its structured result and concise text for hosts that do not support the app.

The app requires an explicitly selected UK or US region. Editing details or changing the draft region makes no request. A manual recheck preserves the original submitted producer, country of origin and other packet facts alongside the editable fields; enriched identity is displayed separately. A completed result keeps its original region and evidence during a pending, failed or cancelled recheck. Clearing retained packet facts is an explicit action. Only committed results update the host's model context.

Result rendering validates the complete public schema. It shows the qualified result, coverage, identifying evidence and grouped restrictions, with official advice links. Warning-group pagination keeps each group's identifiers, dates and notes together. The app does not write data, save history, publish shares, upload images or contact another network origin.

## Build and transport

`pnpm build:mcp-app` creates the ignored `public/mcp-app/result-v1.html`. Normal development, tests and production builds run it through package lifecycle scripts. If starting `dev:web`, `dev:app` or a watch command directly on a fresh checkout, run the build first; rebuild after changing app source.

The build inlines its script and stylesheet with literal replacement callbacks, escapes script-closing text, preserves dependency notices and computes SHA-256 CSP hashes from the exact inserted bytes. The HTML policy disables network connections, external resources, frames, forms and base changes. Resource metadata uses the fixed app domain with empty connection/resource/frame allowlists. The bridge supplies host theme and style variables; all warning and product text is inserted as text.

Raw HTML is capped at 768 KiB. Only a `resources/read` request for this exact URI receives the 1 MiB HTTP response allowance. Other protocol exchanges retain the 256 KiB allowance and structured tool results remain capped at 64 KiB. Next output tracing explicitly includes the generated HTML so the deployed function can read it. A missing or oversized artifact returns an error. Breaking UI contract changes require a new resource URI because hosts may cache resources by URI.

## Verification and release limits

Local SDK tests cover discovery metadata, MIME type, CSP metadata, resource delivery without data-service calls and the narrow static response allowance. Playwright uses the official AppBridge against the unmodified built HTML to exercise the real bridge and CSP, explicit region choice, retained packet evidence, draft/committed state, failures and grouped details at phone and desktop widths.

The corrected local build measured 644,742 raw HTML bytes on 9 October 2026. JSON encoding adds roughly 39 KiB; compression of that encoded string was approximately 145 KiB gzip or 120 KiB Brotli. These are local compression estimates, not measured Vercel transfer or billing. Measure the full JSON-RPC response, actual content encoding and host cache behavior on the controlled deployment before revising capacity estimates.

No real ChatGPT, Codex or other host installation has been verified by these tests. Host-specific CSP acceptance, iframe behavior, UI caching, account permissions and public publishing remain release gates. Production MCP remains disabled by default.
