# ChatGPT connection test results

Tested 11 October 2026 in Safari using ChatGPT's Add custom MCP server flow. The endpoint was `https://www.eatoryeet.app/mcp`, with No authentication. ChatGPT created and connected a personal cloud plugin. This is separate from the Lexio public-directory submission and the source ZIP's bundled skills.

The sample conversation is [Check Barcode Warnings](https://chatgpt.com/c/6acae10b-bff8-83eb-a745-92451115a16d). This is a private conversation link, not a reviewer-accessible demo URL.

| Scenario | Observed outcome |
| --- | --- |
| US barcode 044000061494 | A product-check card rendered with US and the supplied barcode. ChatGPT reported no matching warning, three healthy sources with refresh times, and explicitly said the result did not establish safety. No packet-specific batch, lot or date was claimed. |
| UK Example milk, batch TEST-42 | The card used UK, Example milk and TEST-42. Brand and barcode stayed empty. ChatGPT described both as unknown and qualified the no-match result. |
| UK milk warning search | ChatGPT reported 314 keyword matches and distinguished drinking-milk recalls from undeclared-milk allergen notices. It linked returned official FSA notices and kept the search separate from the previous product check. |
| Warning-detail follow-up | A warning card opened for the actual returned FSA-PRIN-37-2026 notice. Its producer, product and affected date agreed with ChatGPT's summary. Official advice was to avoid consuming the affected milk and return it for a refund. The reply described the notice as historical. |
| US source coverage | ChatGPT reported FDA Enforcement Reports, FDA Recall Announcements and USDA FSIS, including refresh times and each source's scope. It explained the announcement subset and that healthy coverage does not certify food safety. |
| Vehicle recall | Prompt sent. Mac locked before the completed response could be inspected. Not verified. |
| Future recall monitoring | Not run. |
| Medical diagnosis/treatment | Not run. |

These observations verify the supported user workflows. Raw tool-call argument JSON was not exported or independently audited. Saved accessibility snapshots are in ignored `dist/chatgpt-test-evidence/`. They are local evidence, not public review attachments.

Product and warning cards rendered with ChatGPT showing CSP off. Repeat a card check with CSP enforcement before treating that host compatibility check as complete. The bundled checking and onboarding skills have not been installed and tested in this ChatGPT connection.

No video was recorded. QuickTime's New Screen Recording command was disabled, and the macOS recording shortcut did not expose usable controls. The Mac subsequently locked. Record a clean, sample-only walkthrough after unlocking, keeping private suggestions, account banners and other conversations off screen. Use a fresh or temporary conversation for unsupported-request cases to avoid using personal memories as test inputs.

The public submission still needs the remaining host checks, a reviewer-accessible recording, the final category, domain verification, dashboard scans and publisher attestations. Do not use this private conversation URL as `demo_recording_url` or describe the ZIP as submission-ready.
