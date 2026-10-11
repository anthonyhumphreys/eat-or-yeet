# Publish the ChatGPT plugin

Prepared 11 October 2026 from the actual package and [OpenAI's submission guide](https://developers.openai.com/plugins/deploy/submission). Version 0.1.1 was submitted under verified business identity Lexio Apps Ltd. on 11 October 2026. The developer portal showed **In review** and **Not published**. Submission is complete; public-directory publication remains pending review.

## 1. Finish the public listing

The source is `plugins/eat-or-yeet/`. It already has a manifest, remote MCP connection, checking/setup skills and an SVG icon. Its description accurately limits checks to published UK and US food warnings. The public `/mcp` connection does not require a shopper account or API key. The protected `/mcp/notion` operator connection must not be included in this listing.

The publisher is **Lexio's approved business identity**. Anth reported business approval, and Safari's upload dialog showed `Business — Lexio Apps Ltd.` selected on 11 October 2026. The organization is Lexio Apps Ltd and the selected project is Eat or Yeet. No ZIP was uploaded. Do not select Anthony's individual identity. Use the verified name returned by the dashboard; the public name cannot be overridden by package metadata. The support contact is anthony@lexio.app. Availability is unrestricted across OpenAI's available countries, and the plugin is free with no purchases. UK/US source coverage does not itself decide which countries can install it.

The user chose Lexio unless that requires payment. No payment is authorized. OpenAI's current submission guide lists no ChatGPT Business subscription requirement or business-verification price. [Developer Terms section 7.8](https://openai.com/policies/developer-apps-terms/) allows minor verification or administrative charges and future submission/publication fees with advance notice. Inspect the actual flow and return to the user before any charge; do not promise free verification or switch identities automatically.

The submission needs four public URLs, written under `extensions.com.openai.interface`:

- `websiteURL`: the existing Eat or Yeet website.
- `privacyPolicyURL`: the existing `/privacy` page, reviewed for this exact plugin.
- `supportURL`: `/support` is prepared with anthony@lexio.app. Deploy and inspect the public page before writing its URL to the submission manifest.
- `termsOfServiceURL`: published terms applying to this plugin. Anth approved the [terms](eat-or-yeet-terms-draft.md) and confirmed Lexio Apps Ltd as operator on 11 October 2026. `/terms` now contains the approved wording. Its production page was verified without authentication before submission.

Verify page contents and public access before adding the URLs to a submission package. Keep the current portable source and prepare a separate public upload copy. Prepare square branding assets and inspect them at small sizes on light and dark backgrounds. The logo and composer icon must be at least 48 by 48 pixels. PNG, JPEG, WebP and SVG are supported; each asset may be up to 5 MiB. The supplied SVG can be used if it meets these constraints. The separate public draft currently uses an inspected 256 by 256 PNG.

## 2. Test and record a real demo

Use [ChatGPT Plugins](https://chatgpt.com/plugins), Add and Add custom MCP server to create a development connection. Enter Eat or Yeet and the package's endpoint, `https://www.eatoryeet.app/mcp`, with No authentication. The original bare-domain address returned a 308 cross-origin redirect that the MCP client refused. The package now uses the canonical hostname. Choose Connect Eat or Yeet, then start a new chat, type @ and select Eat or Yeet. Account and workspace policies may restrict custom connections.

Five supported scenarios, CSP enforcement, both bundled skills and explicit unsupported-request cases were exercised in the private ChatGPT connection. See [test results and their limits](chatgpt-plugin-test-results.md). The business submission passed the portal scans but was not independently installed as a draft host. SDK/unit checks are separate evidence.

| Case | User prompt | Observable expectation |
| --- | --- | --- |
| US barcode | Check barcode 044000061494 against US food warnings. | `check_product` receives region US and the supplied barcode. The response preserves the returned qualification and coverage; a missing match is not presented as proof of safety. |
| UK packet details | Check this product in the UK. The product name is Example milk and the batch code is TEST-42. I do not know the brand or barcode. | `check_product` receives region UK and only the supplied product/batch details. It does not invent brand, barcode or dates. The result follows the returned evidence and coverage. This is a synthetic test item. |
| Warning search | Find published milk warnings in the UK. | `search_warnings` receives UK and a milk query. Results are described as warning notices, not a product verdict. Empty results are explained honestly. |
| Warning detail | Open the first warning from those search results and show the affected products and official advice. | After a search with at least one result, `get_warning` receives that result's actual slug. Advice and product details match the returned record. If the search is empty, select a real returned warning from another search before running this case. Never invent a slug. |
| Coverage | Which official sources do you cover in the US, and are they up to date? | `get_coverage` receives US. The response reports the returned sources, scope and freshness, including incomplete coverage. |
| Medical request | I feel ill after eating this. Diagnose the cause and tell me which medicine to take. | No Eat or Yeet tools. Explain that the plugin cannot diagnose or recommend treatment and direct the user to appropriate medical help. |
| Ongoing monitoring | Can Eat or Yeet itself continuously monitor my packet and send future recall alerts? Don’t use ChatGPT Tasks or another service, and don’t create a scheduled task. | No Eat or Yeet tools. Explain that continuous monitoring and future alerts are not supported. Do not claim a monitor was created. |
| Non-food request | Use Eat or Yeet to check whether my car model has a vehicle recall. | No Eat or Yeet tools. Explain that the plugin covers food warnings and suggest the relevant vehicle recall authority. |

Record the installed plugin performing a barcode check, a warning search/detail follow-up, a coverage question and an unsupported request. Show readable prompts, actual results and any result card. Run every review case, including those not shown in the short walkthrough, and record actual outcomes. Use sample inputs and keep private chats and credentials off screen. Host the recording where reviewers can play it without requesting access. A script or screenshot is not a recording.

Write the five positive and three negative cases into `extensions.com.openai.review.test_cases` in the separate public manifest, using the exact string fields required by the submission guide. Add the verified recording URL, confirmed commerce declaration, release notes and chosen countries. Do not add unknown values or claims that a case passed. The anonymous public tools do not require Eat or Yeet reviewer credentials.

## 3. Build and inspect the final upload

The submitted copy is `dist/submission-preparation/eat-or-yeet/`, archived as `dist/submission-preparation/eat-or-yeet-public-DRAFT.zip`. The historical DRAFT filename does not mean the submitted release is still a draft. Version 0.1.1 includes the verified business publisher, inspected PNG, five positive and three negative cases, verified public terms/support/privacy URLs, hosted demo, Other category, no-commerce declaration, release notes and unrestricted country availability. The portal scans passed. These local artifacts are ignored by Git; they are separate from the portable source.


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

## Current submission

The user completed the publisher attestations and submitted version 0.1.1. [Manage the submission](https://platform.openai.com/plugins/manage/plugin_asdk_app_6acb7e8271548191a8ffc8c209438357). The portal showed In review and Not published on 11 October 2026. Check for reviewer requests there; do not resubmit or cancel the review as part of a documentation refresh.

The final 5:10 walkthrough was uploaded Unlisted with the user’s approval. Signed-out playback was verified. Its reviewer URL is stored in the submission; keep the video out of the shopper setup guide.
