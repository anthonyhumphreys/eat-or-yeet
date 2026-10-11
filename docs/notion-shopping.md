# Your Notion shopping list

The [shopping-list template](https://carnelian-airedale-eb7.notion.site/Eat-or-Yeet-shopping-list-3f57b822339680b99d06f6c687dd87e8) is available now. Automatic reviews are still being configured. Copying the template alone does not connect it to Eat or Yeet.

## Use the template now

1. Open the template and choose **Duplicate**.
2. Open **Shopping list** and add your items. Brand, barcode and packet details are optional; leave anything you don't know empty.
3. Leave **Bought** unticked while an item is on your list. Tick it after buying it.

Until reviews are available, [check your packet on the website](https://www.eatoryeet.app/search).

## Connect when reviews are available

1. Open [Notion setup](https://www.eatoryeet.app/integrations/notion), choose UK or US and select **Add to Notion**.
2. Approve access in Notion and choose the Eat or Yeet template. This creates a connected copy in your workspace.
3. Wait for the management page to show **Reviews active**, then add an item to the new list.

No Notion AI subscription or API token is needed. Eat or Yeet hosts the reviews.

## Read a review

Adding or changing an unbought item's name, brand, barcode or supported packet details starts a review. Results appear in **Review status**, **Related warnings** and **Reviewed at**. Bought items are skipped. Editing a result field does not start another review.

Reviews may take a few minutes. An earlier result keeps its review time until it is replaced. Daily review limits can delay pending work; the management page shows when it can retry.

A broad item such as milk can match several products or batches. Open the official notice and compare its product, batch and dates with your packet. **No related warnings found in covered data** does not mean food is safe. Missing or stale coverage shows **Unable to review**.

Reviews run when items change. They do not monitor future recalls or send notifications.

## Manage your connection

Open [Manage your Notion list](https://www.eatoryeet.app/integrations/notion/manage) in the browser you used to connect. You can pause or resume reviews, change country, retry setup, reconnect or disconnect. Changing country schedules reviews for unbought items. Edits first received while paused do not start reviews; after resuming, edit an item to request a new review.

Pausing or disconnecting may take a little time while an existing review finishes. Use **Refresh status** to check progress. Disconnect removes the saved connection and pending reviews; your shopping list stays in Notion. If automatic access removal fails, remove Eat or Yeet in Notion's connection settings.

## What the connection shares

Connecting lets Eat or Yeet read the configured shopping fields in your list and write its review fields. We store the authorizing Notion user, workspace and bot identifiers, list and field mapping, country, management session and review state. Access and refresh credentials are encrypted before storage. Our backend decrypts them to run your reviews. Pausing keeps the connection and its credentials; disconnect to remove them.

We do not save your profile name, email address or avatar, or keep shopping item text as a history. Account identifiers are still personal data. If you enter personal information in a shopping field, it may be processed during a review. Use product details only. [Privacy details](https://www.eatoryeet.app/privacy).

## Check without connecting

You can use the template without giving Eat or Yeet access to your Notion account or list. Open [Check a product](https://www.eatoryeet.app/search), choose UK or US and enter the barcode. Alternatively, choose **Label details** and enter the product name, brand and any packet details you know. Select **Check published warnings**.

This sends the product details you submit for a website check. Results appear on the website and are not written back to Notion; you can copy them into your list yourself.

Service owners: see the [managed-service runbook](./operators/notion-managed-service.md) and [readiness record](./operators/notion-readiness.md).
