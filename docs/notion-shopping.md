# Shopping lists in Notion

Status: managed **Add to Notion** is implemented and tested locally. It remains off until the public Notion connection, shopping-list template and live multi-workspace checks are ready. The standalone API-token worker is an optional operator setup, not part of the customer flow.

## Set up your list

When setup is available, open **Add to Notion** on Eat or Yeet and choose UK or US warnings if you have not already chosen a country on the site. Approve access in Notion and add the Eat or Yeet shopping-list template to your workspace. Open the new list to finish setup.

The template includes Item, Bought, Review status, Related warnings and Reviewed at. Brand, barcode and supported packet details are optional. You do not need Notion AI, API tokens, webhooks, a terminal or a separately hosted service.

## Reviews

When reviews are active, adding or changing an unbought item starts a review against published warnings for your selected country. Eat or Yeet writes the status, related warnings and review time beside the row. Changes to result fields do not start another review. Mark an item as bought to skip it.

A general item such as milk may relate to several products or batches. Open the linked official notice and compare its product, batch and date details with the packet you have. **No related warnings found in covered data** does not establish that food is safe. Missing or stale warning coverage shows **Unable to review**.

Reviews begin after Notion reports a row change and may take several minutes. A previous result keeps its original review time until a new review replaces it. Daily review limits may delay pending work; the management page shows the next retry time.

This integration reviews changes to your list. It does not monitor future recalls or send push notifications.

## Manage or disconnect

Use **Manage, reconnect or disconnect a Notion list** on the setup page. You can check status, pause or resume reviews, change the warning country, retry setup, reconnect or disconnect. Country changes schedule reviews for unbought items. Pausing or disconnecting may take time while work already in progress finishes; refresh the status page to check.

Disconnect removes the saved connection and pending review work when it finishes. Your shopping list remains in Notion. If Notion cannot remove access automatically, remove Eat or Yeet in Notion's connection settings.

Eat or Yeet stores encrypted Notion credentials and only the configured shopping-list fields needed for reviews. It does not read unrelated pages. See [Privacy](https://eatoryeet.app/privacy) for details.

For release status and operator setup, see the [managed installation plan](./notion-installation-plan.md) and [service runbook](./operators/notion-managed-service.md).
