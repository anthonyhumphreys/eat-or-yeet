# Eat or Yeet for Grok Bot

Check packaged food against published UK and US warnings using a barcode or details from the packet. Eat or Yeet reports matching warnings, possible matches and source coverage. A result is not a guarantee that food is safe.

The service is operated by Lexio Apps Ltd. The plugin lives in [`plugins/grok-bot`](https://github.com/anthonyhumphreys/eat-or-yeet/tree/main/plugins/grok-bot) within the public application repository. The root `.cursor-plugin/marketplace.json` points to this directory. Marketplace submission is being prepared; use the custom connection below for now.

## Set up in Grok Bot

1. Download the ZIP from the [Grok Bot release](https://github.com/anthonyhumphreys/eat-or-yeet/releases/tag/grok-bot-v0.1.0). You can also build it from the application repository with `pnpm package:plugin:grok-bot`; the local archive is `dist/grok-bot/eat-or-yeet-grok-bot.zip`.
2. Open a chat with your Bot, attach the ZIP and send this message:

> Add a custom Remote HTTPS MCP server named eat-or-yeet at https://www.eatoryeet.app/mcp with no authentication or headers. Keep my existing connections. Install the ZIP's setup and checking SKILL.md files as private skills, preserving their contents. Confirm the connection and four discovered tools.

3. Check **Connect apps → Your plugins → Private skills** for `setup` and `checking`.
4. Choose UK or US and ask for a food-warning check.

The macOS app accepted this custom connection and both private skills on 11 October 2026. It could not import the Cursor manifest directly. This setup uses the same tools and skill instructions, but is not a marketplace installation. A team administrator may restrict custom connections.

## Start a check

Once the plugin is installed and connected, choose UK or US in your conversation. Then try:

> Check barcode 044000061494 against US food warnings.

Or supply details you can read from the packet:

> Check this product in the UK. The product name is Example milk and the batch code is TEST-42. I do not know the brand or barcode.

Unknown packet details stay unknown. You do not need to supply a batch or date to start a barcode check. If more detail would help resolve a possible match, the assistant can ask. You can decline.

You can also ask:

- Find published milk warnings in the UK.
- Open the first warning from those results and show the affected products and official advice.
- Which official sources do you cover in the US, and are they up to date?

## Connection

The package connects to `https://www.eatoryeet.app/mcp` over HTTPS using remote MCP. It needs no Eat or Yeet account, API key or sign-in. Use the `www` address exactly to avoid a redirect. The plugin is free and does not process purchases.

The connection exposes four read-only tools:

| Tool | Purpose |
| --- | --- |
| `check_product` | Check a barcode or supplied packet details in UK or US. |
| `search_warnings` | Find published warning notices. |
| `get_warning` | Read the affected products, restrictions and advice for a returned notice. |
| `get_coverage` | Show covered sources and their freshness. |

The `setup` and `checking` skills explain region selection, evidence handling and how to report uncertainty. Grok Bot's own routines or scheduling are separate features; this plugin supplies no persistent monitoring or notification tool. Its tools accept text details rather than photographs and do not diagnose illness or check vehicle recalls.

## Understand the result

"No matching warning found" means no warning matched the supplied evidence within the returned region and source coverage. It does not mean "safe to eat." Missing, stale or incomplete warning coverage makes a negative result inconclusive. A warning search discovers notices; use a product check for a product-specific result.

Follow the official advice linked in an affected-product result. Possible matches may require a closer look at the batch, date or other packet restrictions.

## Privacy and support

The barcode and packet details you submit are sent to Eat or Yeet to perform the check. Eat or Yeet has no account or stored check-history feature. Grok Bot and its provider may retain conversation and tool data under their own policies.

- [Website](https://www.eatoryeet.app)
- [Privacy policy](https://www.eatoryeet.app/privacy)
- [Terms of service](https://www.eatoryeet.app/terms)
- [Support](https://www.eatoryeet.app/support), or anthony@lexio.app

## Package and testing

This is a standalone Cursor-format plugin. It needs no application source, dependencies or local server.

For a Cursor packaging check before publication, copy this directory to `~/.cursor/plugins/local/eat-or-yeet`, reload Cursor, then confirm both skills and the MCP connection in Customize. An already-installed marketplace plugin with the same name can take precedence. This checks Cursor packaging; test tool use separately in Grok Bot before submitting.

For Grok Bot testing, use the setup above. Run the examples and confirm that the assistant asks for a region when none was supplied, preserves unknown packet fields and reports coverage. A manually configured connection tests the server and skills, not marketplace installation.

See the official [Cursor plugin reference](https://cursor.com/docs/reference/plugins), [local plugin testing instructions](https://cursor.com/docs/plugins#test-plugins-locally) and [Grok Bot connection guide](https://cursor.com/help/grok-bot/connect-plugins). Submission is through [Cursor Marketplace](https://cursor.com/marketplace/publish), subject to review and confirmation of Grok Bot availability.

## Licence

The files in this standalone package are licensed under MIT. This licence does not cover the Eat or Yeet application source or grant ownership of Lexio or Eat or Yeet branding. Using the hosted service is subject to its terms.
