# Grok Bot plugin publication preparation

Prepared on 11 October 2026 for Eat or Yeet, operated by Lexio Apps Ltd. Anth made the application repository public and authorized using it for the Grok Bot submission. The plugin lives in `plugins/grok-bot/`, indexed by the root `.cursor-plugin/marketplace.json`. The obsolete separate plugin repository was deleted on 11 October 2026 after its complete Git history was backed up locally. No marketplace application has been submitted yet.

## Local deliverables

Build with `pnpm package:plugin:grok-bot`. The output directory is `dist/grok-bot/eat-or-yeet/`; the ZIP and its SHA-256 sidecar are beside it. If an export already exists, move that directory aside before rebuilding.

The package uses Cursor's native `.cursor-plugin/plugin.json`, matching the documented format for publisher details and a relative logo. It contains both existing skills, the existing SVG icon, a credential-free remote MCP configuration, a user README and an MIT licence. Anth approved MIT for these distribution files on 11 October 2026. This does not change the application repository's licence.

The plugin version comes from the portable source, currently `0.1.0`. This is the initial Grok Bot distribution; the separate ChatGPT submission is `0.1.1` and is already in review. Building this export does not update or cancel that submission.

The builder uses the portable package's schema validation, credential checks and file allowlist before exporting. Local package tests inspect the actual ZIP, including its hidden manifest, exact contents, preserved skill bytes and reproducibility. These checks do not establish Grok Bot host compatibility.

Verification completed on 11 October 2026:

- Repository lint and TypeScript checks passed.
- All 546 unit tests passed after the MCP compatibility fix, including the 12 portable/Grok Bot packaging tests and two new text-only host regressions. The production build passed.
- Cursor's unmodified `validate-template.mjs` passed against the extracted ZIP in a temporary single-entry marketplace wrapper. Its only warning was that no optional hooks file exists. The wrapper and validator are excluded from the release package.
- Validator source was pinned to `cursor/plugin-template` commit `46216072ac5750f782f95bb325b4d12b7c3ae9c9`; provenance is recorded in `dist/grok-bot/validator-provenance.json`.
- Rebuilt main-repository archive SHA-256: `60fb60161c737a5db1c4d6d8b11bede8c99186bc263e4525aac70c80e5504b9d`. The checked-in folder and actual root marketplace manifest passed Cursor's validator; all 12 packaging tests, lint and typecheck passed.
- Original withdrawn archive SHA-256: `debaf2cd294114a2a5e5885bad5fa72a84529b659f40c7a341cae8b399853cfb`.

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

The native manifest references the public application repository. The publisher form uses `https://github.com/anthonyhumphreys/eat-or-yeet` and the raw logo at `https://raw.githubusercontent.com/anthonyhumphreys/eat-or-yeet/main/plugins/grok-bot/assets/icon.svg`. Its description identifies `plugins/grok-bot` and the root marketplace manifest. Anth approved using the existing Cursor account to manage the Lexio application. Organization name and contact remain Lexio Apps Ltd. and anthony@lexio.app.

## Endpoint verification

On 11 October 2026, a direct MCP SDK connection to `https://www.eatoryeet.app/mcp` discovered all four tools and completed five positive cases. US source coverage was healthy; unknown fields in a synthetic UK packet check remained null. UK milk search returned 314 notices, and detail retrieval used the real returned slug `fsa-aa-44-2026`. Both product checks returned `no_matching_warning` with their qualifications and coverage intact.

The original structured record is `dist/grok-bot/endpoint-check.json`. After PR #19 deployed, a second production test ignored `structuredContent`, parsed the text result, searched four notices and opened the first returned slug. Both text results matched the complete structured results, including official links and pagination. This record is `dist/grok-bot/text-result-verification.json`. These are direct server tests, not Grok Bot model tests or marketplace installation tests. The earlier ChatGPT walkthrough shows the same service, but is not evidence of Grok Bot behavior.

## Grok Bot host verification

Grok Bot for macOS installed the anonymous custom Remote HTTPS MCP connection and both private skills from the ZIP on 11 October 2026. The setup skill's instructions and both entries were inspected in the app. The Bot reported restoring both files byte-for-byte after the skill save step reformatted them; this byte comparison was not independently observed. Grok Bot could not import the Cursor manifest directly, so this is a custom connection with skills, not a marketplace installation.

Grok Bot version 0.68.1 was inspected in the app. The following cases passed on 11 October 2026 before the compatibility fix: missing region, US barcode, unknown UK packet fields, no safety guarantee, declined packet details, no diagnosis, no plugin monitoring and unsupported vehicle recall. The missing-region response at 15:04:29 asked UK or US before checking. Product responses preserved the selected region, qualifications and coverage.

Search and detail initially failed. Grok received the short text summary without warning IDs or official links, could not open the first result and reported that limitation. PR #19 changed both MCP servers to return the full validated JSON as text alongside structured results. All automated checks passed and the fix deployed to production. Direct text-only search and detail passed. Grok retests also passed at 18:00:36 and 18:01:06 London time. Search returned official FSA links, pagination and the first warning ID; detail opened that returned warning and matched both affected products, dates and advice in the live server record. US coverage passed at 18:01:46, reporting all three actual sources, their scope and successful refresh times. All 11 host cases below are now complete.

Ask UK or US once, then reuse that explicit choice in the conversation until the user changes it. The plugin does not read a Grok profile. Profile location should not silently select the warning region, since a user may be checking food bought elsewhere.

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

The app transcript did not expose raw tool arguments, so the observed model responses do not independently establish those arguments. The direct SDK records and server regression tests cover transport outputs separately. Record prompts and actual responses in `dist/grok-bot/host-test-status.json`. Keep personal account details and raw private transcripts out of the public repository. Interactive MCP Apps rendering is optional and unverified in Grok Bot; these cases can pass using text results.

## Publication status and next steps

The seven plugin package files live in `plugins/grok-bot/` within the public application repository. The root marketplace manifest selects only this directory, not the application source or the portable plugin with the same identifier. The Grok Bot ZIP and SHA-256 sidecar are published at https://github.com/anthonyhumphreys/eat-or-yeet/releases/tag/grok-bot-v0.1.0. GitHub's uploaded ZIP digest matches the rebuilt archive checksum above. The release points to plugin source commit `77af7772044b8ef0e4edbfafa00367905c33a665`.

1. All 11 host cases passed using the custom connection and private skills in Grok Bot 0.68.1. No marketplace installation has been tested yet.
2. The publisher form is prepared with the main repository, updated raw logo and plugin-directory instructions. No application has been submitted yet.
3. The authorized developer must complete Publisher Terms acceptance for submission.
4. After approval, verify marketplace installation and update the listing status only when it is live.

The xAI GitHub marketplace's README explicitly targets Grok Build. Its PR process is a separate distribution route and is outside this Grok Bot package preparation.

## Official references

- [Cursor plugin format and submission checklist](https://cursor.com/docs/reference/plugins)
- [Local Cursor plugin testing](https://cursor.com/docs/plugins#test-plugins-locally)
- [Grok Bot connections](https://cursor.com/help/grok-bot/connect-plugins)
- [Grok Bot uses Cursor connector policy and marketplace](https://cursor.com/docs/grok-bot/teams#connector-policy)
- [Marketplace publisher application](https://cursor.com/marketplace/publish)
- [Grok Build marketplace](https://github.com/xai-org/plugin-marketplace)
