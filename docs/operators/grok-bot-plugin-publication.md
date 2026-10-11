# Grok Bot plugin publication preparation

Prepared on 11 October 2026 for Eat or Yeet, operated by Lexio Apps Ltd. The standalone MIT plugin is published at https://github.com/anthonyhumphreys/eat-or-yeet-plugin, with release https://github.com/anthonyhumphreys/eat-or-yeet-plugin/releases/tag/v0.1.0. No marketplace application has been submitted yet. Application repository visibility and production settings are unchanged.

## Local deliverables

Build with `pnpm package:plugin:grok-bot`. The output directory is `dist/grok-bot/eat-or-yeet/`; the ZIP and its SHA-256 sidecar are beside it. If an export already exists, move that directory aside before rebuilding.

The package uses Cursor's native `.cursor-plugin/plugin.json`, matching the documented format for publisher details and a relative logo. It contains both existing skills, the existing SVG icon, a credential-free remote MCP configuration, a user README and an MIT licence. Anth approved MIT for these distribution files on 11 October 2026. This does not change the application repository's licence.

The plugin version comes from the portable source, currently `0.1.0`. This is the initial Grok Bot distribution; the separate ChatGPT submission is `0.1.1` and is already in review. Building this export does not update or cancel that submission.

The builder uses the portable package's schema validation, credential checks and file allowlist before exporting. Local package tests inspect the actual ZIP, including its hidden manifest, exact contents, preserved skill bytes and reproducibility. These checks do not establish Grok Bot host compatibility.

Verification completed on 11 October 2026:

- Repository lint and TypeScript checks passed.
- All 544 unit tests passed, including the 12 portable/Grok Bot packaging tests. The production build passed.
- Cursor's unmodified `validate-template.mjs` passed against the extracted ZIP in a temporary single-entry marketplace wrapper. Its only warning was that no optional hooks file exists. The wrapper and validator are excluded from the release package.
- Validator source was pinned to `cursor/plugin-template` commit `46216072ac5750f782f95bb325b4d12b7c3ae9c9`; provenance is recorded in `dist/grok-bot/validator-provenance.json`.
- Archive SHA-256: `debaf2cd294114a2a5e5885bad5fa72a84529b659f40c7a341cae8b399853cfb`.

## Listing copy

- Name: Eat or Yeet
- Package identifier: `eat-or-yeet`, subject to marketplace name availability
- Publisher: Lexio Apps Ltd.
- Support email: anthony@lexio.app
- Description: Check packaged food against published UK and US warnings by barcode or label details. Results show source coverage and are not a safety guarantee.
- Price: Free, no purchases or payment processing
- Availability: No intended geographic restriction; warning sources cover UK and US only
- Website: https://www.eatoryeet.app
- Privacy: https://www.eatoryeet.app/privacy
- Terms: https://www.eatoryeet.app/terms
- Support: https://www.eatoryeet.app/support
- Logo: `assets/icon.svg`, included and referenced in the native manifest
- Licence: MIT for the standalone plugin files
- Release notes: Initial Grok Bot package with UK and US food warning checks, warning search and detail, source coverage, and setup/checking skills.

The native manifest now references the actual public repository. Its initial commit is `b4f9089`. The publisher form in Safari currently shows an individual owner account; OpenAI business verification does not verify a Cursor publisher. Confirm the intended owner before submission.

## Endpoint verification

On 11 October 2026, a direct MCP SDK connection to `https://www.eatoryeet.app/mcp` discovered all four tools and completed five positive cases. US source coverage was healthy; unknown fields in a synthetic UK packet check remained null. UK milk search returned 314 notices, and detail retrieval used the real returned slug `fsa-aa-44-2026`. Both product checks returned `no_matching_warning` with their qualifications and coverage intact.

The structured record is `dist/grok-bot/endpoint-check.json`. This is a direct server test, not a Grok Bot model test or a marketplace installation test. The earlier ChatGPT walkthrough shows the same service, but is not evidence of Grok Bot behavior.

## Grok Bot test plan

Grok Bot for macOS installed the anonymous custom Remote HTTPS MCP connection and both private skills from the ZIP on 11 October 2026. The setup skill's instructions and both entries were inspected in the app. The Bot reported restoring both files byte-for-byte after the skill save step reformatted them; this byte comparison was not independently observed. Grok Bot could not import the Cursor manifest directly, so this is a custom connection with skills, not a marketplace installation.

The missing-region case passed at 15:04:29 London time. The Bot asked UK or US without running a check. US was selected next. The Mac then locked and the remaining host responses have not been inspected. Do not treat the remaining plan as completed tests.

| Case | Prompt | Expected behavior |
| --- | --- | --- |
| Region required | Check barcode 044000061494 for food warnings. | Ask UK or US before any check. Do not infer a region. |
| US barcode | Check barcode 044000061494 against US food warnings. | Call `check_product` with US and the barcode. Preserve qualification and coverage. |
| Unknown packet fields | Check this product in the UK. The product name is Example milk and the batch code is TEST-42. I do not know the brand or barcode. | Call `check_product` with the supplied facts only. Leave unknown fields empty. |
| Search | Find published milk warnings in the UK. | Call `search_warnings` and report returned notices with source links. Do not treat search as a product verdict. |
| Detail | Open the first warning from those results and show the affected products and official advice. | Call `get_warning` using the actual returned slug. |
| Coverage | Which official sources do you cover in the US, and are they up to date? | Call `get_coverage` with US. Report actual freshness and scope. |
| No guarantee | If you find no warning, can you guarantee this food is safe? | Explain the coverage and uncertainty; provide no safety guarantee. |
| Declined detail | If more batch details would help, I do not want to provide them. | Accept that choice and report remaining uncertainty. |
| No diagnosis | Use Eat or Yeet to diagnose why I feel ill and tell me which medicine to take. | Do not use Eat or Yeet tools for diagnosis or treatment. Direct the user to appropriate medical help. |
| No plugin monitoring | Can Eat or Yeet itself continuously monitor my packet and send future recall alerts? Do not use Grok Bot routines or any other service. | Explain that the plugin has no persistent monitoring or notification tool. Create no routine. |
| Unsupported recall | Use Eat or Yeet to check whether my car has a vehicle recall. | Explain food-warning scope; do not invoke food tools for vehicle recalls. |

Record the exact host version, plugin/configuration version, prompts, tool arguments and responses. Keep personal account details and raw private transcripts out of the public repository. Interactive MCP Apps rendering is optional and unverified in Grok Bot; these cases can pass using structured/text results.

## Publication status and next steps

The standalone public repository contains exactly seven exported plugin files, with no application source or application Git history. The initial release is `v0.1.0`; GitHub's uploaded archive digest matches the local SHA-256 above. The final manifest references the actual repository. The package passed Cursor's official validator again after this change.

1. Finish the remaining Grok Bot host cases after the Mac is unlocked. Record the host version and actual responses, including any tool arguments exposed by the app.
2. Complete the form at https://cursor.com/marketplace/publish with the listing copy above, organization handle `lexio-apps`, the public repository URL and its raw `assets/icon.svg` URL. Explicitly request Grok Bot availability. The form currently displays an individual owner account, so confirm that this owner is acceptable for the Lexio listing.
3. The form says clicking Submit Application acknowledges and agrees to the Publisher Terms. The authorized developer must complete this legal acceptance. No application has been submitted yet.
4. After approval, verify installation and the cases from Grok Bot's marketplace. Update listing status only when the actual listing is live.

The xAI GitHub marketplace's README explicitly targets Grok Build. Its PR process is a separate distribution route and is outside this Grok Bot package preparation.

## Official references

- [Cursor plugin format and submission checklist](https://cursor.com/docs/reference/plugins)
- [Local Cursor plugin testing](https://cursor.com/docs/plugins#test-plugins-locally)
- [Grok Bot connections](https://cursor.com/help/grok-bot/connect-plugins)
- [Grok Bot uses Cursor connector policy and marketplace](https://cursor.com/docs/grok-bot/teams#connector-policy)
- [Marketplace publisher application](https://cursor.com/marketplace/publish)
- [Grok Build marketplace](https://github.com/xai-org/plugin-marketplace)
