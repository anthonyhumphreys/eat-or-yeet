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
| Explicit Eat or Yeet vehicle-recall request | Explained that Eat or Yeet covers packaged food and cannot check vehicles; linked the official UK vehicle checker. No Eat or Yeet call. |
| Plugin-only future monitoring | Explained that Eat or Yeet cannot monitor future recalls or notify later. No new task or Eat or Yeet call. A broader earlier prompt created a separate ChatGPT task; it was disabled and the prompt revised to test the plugin boundary. |
| Medical diagnosis/treatment | Declined diagnosis and a specific medicine. No Eat or Yeet call; general host health guidance remained separate. |

These observations verify the supported user workflows. Raw tool-call argument JSON was not exported or independently audited. Saved accessibility snapshots are in ignored `dist/chatgpt-test-evidence/`. They are local evidence, not public review attachments.

A fresh product card also rendered with CSP enforcement enabled. Both packaged skills were installed in private plugin version 1.0.1, preserving its identity and audience. Source read-back confirmed their contents. The setup skill waited for UK/US; the checking follow-up used the selected country and qualified the result.

A cleaned 5:10 sample walkthrough was recorded, decoded and played locally, uploaded Unlisted with approval and verified playing in signed-out Safari. Its URL is included in the submission. Private conversations and local snapshots remain separate from the reviewer video.

Public version 0.1.1 was submitted under Lexio Apps Ltd. on 11 October 2026. The portal showed **In review** and **Not published**. Domain verification, metadata, skill and MCP scans passed. The private host tests and direct endpoint rerun support the submission, but the business draft was not independently installed and tested as a ChatGPT host. Its tools were not live before publication.
