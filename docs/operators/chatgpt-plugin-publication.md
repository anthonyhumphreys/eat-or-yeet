# Publish the ChatGPT plugin

Prepared 11 October 2026 from the actual package and [OpenAI's submission guide](https://developers.openai.com/plugins/deploy/submission). This is a preparation guide. The plugin has not been submitted or published.

## 1. Finish the public listing

The source is `plugins/eat-or-yeet/`. It already has a manifest, remote MCP connection, checking/setup skills and an SVG icon. Its description accurately limits checks to published UK and US food warnings. The public `/mcp` connection does not require a shopper account or API key. The protected `/mcp/notion` operator connection must not be included in this listing.

The publisher is **Lexio's approved business identity**. Anth reported business approval, and Safari's upload dialog showed `Business — Lexio Apps Ltd.` selected on 11 October 2026. The organization is Lexio Apps Ltd and the selected project is Eat or Yeet. No ZIP was uploaded. Do not select Anthony's individual identity. Use the verified name returned by the dashboard; the public name cannot be overridden by package metadata. The support contact is anthony@lexio.app. Availability is unrestricted across OpenAI's available countries, and the plugin is free with no purchases. UK/US source coverage does not itself decide which countries can install it.

The user chose Lexio unless that requires payment. No payment is authorized. OpenAI's current submission guide lists no ChatGPT Business subscription requirement or business-verification price. [Developer Terms section 7.8](https://openai.com/policies/developer-apps-terms/) allows minor verification or administrative charges and future submission/publication fees with advance notice. Inspect the actual flow and return to the user before any charge; do not promise free verification or switch identities automatically.

The submission needs four public URLs, written under `extensions.com.openai.interface`:

- `websiteURL`: the existing Eat or Yeet website.
- `privacyPolicyURL`: the existing `/privacy` page, reviewed for this exact plugin.
- `supportURL`: `/support` is prepared with anthony@lexio.app. Deploy and inspect the public page before writing its URL to the submission manifest.
- `termsOfServiceURL`: published terms applying to this plugin. Anth approved the [terms](eat-or-yeet-terms-draft.md) and confirmed Lexio Apps Ltd as operator on 11 October 2026. `/terms` now contains the approved wording. Verify its production deployment before adding the URL.

Verify page contents and public access before adding the URLs to a submission package. Keep the current portable source and prepare a separate public upload copy. Convert the supplied branding into square PNG assets and inspect them at small sizes on light and dark backgrounds. The listing logo must be at least 256 by 256 pixels; the composer icon at least 48 by 48. Each may be up to 5 MiB. The current SVG is valid for the portable package but needs a submission-compatible PNG.

## 2. Test and record a real demo

Use [ChatGPT Plugins](https://chatgpt.com/plugins), Add and Add custom MCP server to create a development connection. Enter Eat or Yeet and the package's endpoint, `https://www.eatoryeet.app/mcp`, with No authentication. The original bare-domain address returned a 308 cross-origin redirect that the MCP client refused. The package now uses the canonical hostname. Choose Connect Eat or Yeet, then start a new chat, type @ and select Eat or Yeet. Account and workspace policies may restrict custom connections.

Five supported scenarios have been exercised in a personal ChatGPT MCP connection. See [actual observations and remaining checks](chatgpt-plugin-test-results.md). Unsupported-request results, CSP enforcement and bundled skills remain unverified. SDK/unit checks are separate evidence.

| Case | User prompt | Observable expectation |
| --- | --- | --- |
| US barcode | Check barcode 044000061494 against US food warnings. | `check_product` receives region US and the supplied barcode. The response preserves the returned qualification and coverage; a missing match is not presented as proof of safety. |
| UK packet details | Check this product in the UK. The product name is Example milk and the batch code is TEST-42. I do not know the brand or barcode. | `check_product` receives region UK and only the supplied product/batch details. It does not invent brand, barcode or dates. The result follows the returned evidence and coverage. This is a synthetic test item. |
| Warning search | Find published milk warnings in the UK. | `search_warnings` receives UK and a milk query. Results are described as warning notices, not a product verdict. Empty results are explained honestly. |
| Warning detail | Open the first warning from those search results and show the affected products and official advice. | After a search with at least one result, `get_warning` receives that result's actual slug. Advice and product details match the returned record. If the search is empty, select a real returned warning from another search before running this case. Never invent a slug. |
| Coverage | Which official sources do you cover in the US, and are they up to date? | `get_coverage` receives US. The response reports the returned sources, scope and freshness, including incomplete coverage. |
| Medical request | I feel ill after eating this. Diagnose the cause and tell me which medicine to take. | No Eat or Yeet tools. Explain that the plugin cannot diagnose or recommend treatment and direct the user to appropriate medical help. |
| Ongoing monitoring | Watch this packet and automatically alert me if it is recalled next month. | No Eat or Yeet tools. Explain that continuous monitoring and future alerts are not supported. Do not claim a monitor was created. |
| Non-food request | Check whether my car model has a vehicle recall. | No Eat or Yeet tools. Explain that the plugin covers food warnings and suggest the relevant vehicle recall authority. |

Record the installed plugin performing a barcode check, a warning search/detail follow-up, a coverage question and an unsupported request. Show readable prompts, actual results and any result card. Run every review case, including those not shown in the short walkthrough, and record actual outcomes. Use sample inputs and keep private chats and credentials off screen. Host the recording where reviewers can play it without requesting access. A script or screenshot is not a recording.

Write the five positive and three negative cases into `extensions.com.openai.review.test_cases` in the separate public manifest, using the exact string fields required by the submission guide. Add the verified recording URL, confirmed commerce declaration, release notes and chosen countries. Do not add unknown values or claims that a case passed. The anonymous public tools do not require Eat or Yeet reviewer credentials.

## 3. Build and inspect the final upload

The local preparation copy is `dist/submission-preparation/eat-or-yeet/`, with an incomplete archive at `dist/submission-preparation/eat-or-yeet-public-DRAFT.zip`. It preserves the portable source. The draft has the verified publisher name, a 256-pixel PNG inspected on light and dark backgrounds, five positive and three negative prompts, a no-commerce declaration, release notes and explicitly unrestricted country availability. Its ZIP contents and icon dimensions were inspected. Five supported scenarios have been exercised through a personal MCP connection; see the host-test report for the verification limits. The final category, support/terms URLs and demo URL remain absent. These local artifacts are ignored by Git and are not a release.

`pnpm package:plugin` builds `dist/eat-or-yeet-plugin.zip` from the current portable source. Its successful build establishes package structure, not public-submission readiness. The public copy must also contain the completed listing, PNG assets and review materials. Update the packaging path or build the separate copy explicitly before calling that upload ready.

Inspect the final ZIP itself. Check manifest references, asset dimensions, exact test-case counts, verified URLs and the declared remote server. Keep secrets, private app bindings and lifecycle hooks out of the author-supplied public ZIP. Preserve any Portal-generated bindings in finalized releases.

## 4. Submit, then publish after approval

After preparation is complete:

1. Open [OpenAI's Plugins dashboard](https://platform.openai.com/plugins) in the intended organization/project. Complete individual or business verification. An organization owner or a role with Apps Management Write can submit.
2. Choose Upload new or existing plugin, select the verified developer identity and upload the completed ZIP. Upload creates a draft.
3. Check Metadata & Skills findings. Open MCPs, connect the declared public server with No authentication and complete the exact domain-verification challenge shown by the dashboard.
4. Wait for scans, inspect all four discovered tools, resolve required errors, verify imported review materials and run the cases against the saved draft.
5. The authorized publisher completes the policy attestations and submits for review. Attestations must not be inferred from this engineering work.
6. When approved, choose Publish plugin on the intended approved version. Approval and publication are separate steps.

The integrations page should link to the real directory listing only after publication is verified. Replace the pending-listing text then. Hosted source changes and new plugin ZIPs follow different review/update paths; consult the current OpenAI guide before changing a published release.
