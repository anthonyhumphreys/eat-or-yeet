# Shopping lists in Notion

Status: the review engine passed a live Notion test on 10 October 2026. The managed **Add to Notion** flow is implemented and tested locally, but remains disabled pending public connection setup and live installation checks. The earlier developer-token/container instructions are an [operator runbook](./operators/notion-shopping-worker.md), not something we expect shoppers to follow.

## Installation when enabled

1. Click **Add to Notion** on Eat or Yeet. The screen shows your chosen warning country, UK or US. Confirm a country here only if you have not already chosen one.
2. Approve access in Notion and choose our shopping-list template. Notion adds a copy to your workspace and grants the connection access to that copy.
3. Open your shopping list. Eat or Yeet finishes the setup automatically and shows when reviews are active.

Notion controls its consent screens, so this is one entry button followed by its approval steps. No Notion AI subscription is needed. You will not need to create API tokens, configure webhooks, install n8n, run a container or copy property IDs.

The template shows Item, Bought, Review status, Related warnings and Reviewed at. Brand, barcode and packet details are optional. A management link lets you change the warning country, pause reviews, reconnect or disconnect. Connecting an existing list with custom columns is a later addition; it will not complicate the first installation.

## Using the list

Add an item such as milk. When reviews are active, Eat or Yeet looks for related published warnings in your chosen country and writes the result beside the item. Tick Bought to stop reviewing that row. Changes to the item, brand, barcode or supported packet details trigger a fresh review. Updating result fields does not start another review.

A generic item can relate to several products or batches. Follow the official notice and compare the packet before buying or using it. "No related warnings found in covered data" does not establish that food is safe. Missing or stale source coverage produces "Unable to review".

Reviews run when items are added or changed. Future-recall monitoring and push notifications are separate features and are not included in this installation.

## Access and control

Eat or Yeet hosts the automation. It reviews only the connected shopping database and writes only dedicated review fields. Its review service receives the configured item, brand, barcode, bought flag and optional packet facts, not unrelated pages or page bodies. The hosted installation retains protected connection credentials and the database mapping until you disconnect. Read the [privacy page](https://eatoryeet.app/privacy) for the retained data and operational backup window.

Disconnect stops queued reviews and removes retained connection data while leaving your shopping list in Notion. You can also revoke the connection in Notion. Setup failures offer a retry or reconnect; retrying setup reuses the bound list. When reconnecting in Notion, select the existing list to avoid making another template copy.

Reviews usually appear after Notion delivers the change. Delivery can take several minutes. The management page shows setup failures and a daily-limit delay. An earlier result keeps its original review time until a fresh review replaces it.

For implementation and release gates, see the [managed Notion installation plan](./notion-installation-plan.md).
