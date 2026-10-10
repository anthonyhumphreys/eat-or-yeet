# Shopping lists in Notion

Status: the automatic review engine passed a live Notion test on 10 October 2026. The customer-facing **Add to Notion** installation is not implemented or available yet. The earlier developer-token/container instructions are an [operator runbook](./operators/notion-shopping-worker.md), not something we expect shoppers to follow.

## The installation we are building

1. Click **Add to Notion** on Eat or Yeet. The screen shows your chosen warning country, UK or US. Confirm a country here only if you have not already chosen one.
2. Approve access in Notion and choose our shopping-list template. Notion adds a copy to your workspace and grants the connection access to that copy.
3. Open your shopping list. Eat or Yeet finishes the setup automatically and shows when reviews are active.

Notion controls its consent screens, so this is one entry button followed by its approval steps. No Notion AI subscription is needed. You will not need to create API tokens, configure webhooks, install n8n, run a container or copy property IDs.

The template will show Item, Bought, Review status, Related warnings and Reviewed at. Brand, barcode and packet details are optional. A management link will let you change the warning country, pause reviews, reconnect or disconnect. Connecting an existing list with custom columns is a later addition; it will not complicate the first installation.

## Using the list

Add an item such as milk. When reviews are active, Eat or Yeet looks for related published warnings in your chosen country and writes the result beside the item. Tick Bought to stop reviewing that row. Changes to the item, brand, barcode or supported packet details trigger a fresh review. Updating result fields does not start another review.

A generic item can relate to several products or batches. Follow the official notice and compare the packet before buying or using it. "No related warnings found in covered data" does not establish that food is safe. Missing or stale source coverage produces "Unable to review".

Reviews run when items are added or changed. Future-recall monitoring and push notifications are separate features and are not included in this installation.

## Access and control

Eat or Yeet will host the automation. It will review only the connected shopping database and write only dedicated review fields. Its review service receives the configured item, brand, barcode, bought flag and optional packet facts, not unrelated pages or page bodies. The hosted installation will need to retain protected connection credentials and the database mapping until you disconnect; its privacy disclosure must describe this before release.

Disconnect will stop queued reviews and remove retained connection data while leaving your shopping list in Notion. You can also revoke the connection in Notion. Setup failures will offer a retry or reconnect; the service will not silently create additional lists.

For implementation and release gates, see the [managed Notion installation plan](./notion-installation-plan.md).
