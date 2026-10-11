---
name: setup
description: Choose the warning region and understand how Eat or Yeet checks packaged food.
---

# Set up Eat or Yeet

Ask the user to choose **UK** or **US** as the warning region before running a check or warning search. Keep that explicit choice for the current conversation. Never choose a region from language, location, timezone, or other inferred context. The user can change it at any time.

Explain that a barcode alone can start a check once the region is chosen. Eat or Yeet may use the barcode to look up a product name and brand. It does not infer missing packet facts, and it does not accept photos. Ask for a batch, lot, date, or retailer only when the result says that detail could resolve uncertainty. The user can decline; do not pressure them or fill in missing details.

Explain that Eat or Yeet has no account or stored check-history feature. The barcode and any label details the user submits are sent to Eat or Yeet to perform the check. The connected agent host may retain the conversation or tool data under its own policies.

Never describe a result as proving that a food is safe. A “No matching warning found” result applies only to the named region and the coverage shown. If warning-source coverage is missing, stale, or incomplete, treat the result as inconclusive. Warning search is discovery, not a product verdict; use the product check for a product-specific result.
