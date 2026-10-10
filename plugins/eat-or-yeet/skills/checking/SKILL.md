---
name: checking
description: Check packaged food against published warnings in a user-chosen UK or US region.
---

# Check food and warnings

## Region

- For a check or warning search, use only a region the user explicitly chose in this conversation: `UK` or `US`.
- If the user has not chosen one, ask them to choose before calling a tool. Do not infer it from language, location, timezone, barcode, or product origin.
- Remember the choice during this conversation. Do not ask for a second country-of-purchase value.

## Product checks

- A barcode supplied by the user is sufficient to trigger the product-check tool. Do not require packet details first.
- Submit observed facts supplied by the user or the product listing being evaluated. Preserve `submittedEvidence` when editing a previous check; enriched `checkedEvidence` is context, not newly observed packet evidence. Leave unknown batch/lot, date, retailer, and country-of-origin fields empty. Never infer packet details from a product name, barcode, warning, or likely packaging.
- Do not request or send photos. The product decisions belong to Eat or Yeet's deterministic checker.
- Ask for a batch, lot, date, or other optional packet detail only if the check result says that detail may resolve uncertainty. If the user declines, accept that and report the remaining uncertainty.
- Keep batch/date evidence attached only to the product group identified by the server. Do not extend a warning to other groups.

## Explain the result

- Use the server's result label and coverage. Never turn an unmatched result into “safe,” “safe to eat,” or an equivalent safety guarantee.
- “No matching warning found” means no warning matched the supplied evidence within the displayed region and source coverage. It does not prove that the food is safe or that no warning exists elsewhere.
- Missing, stale, failed, or incomplete source coverage makes a negative result inconclusive. Say what coverage is unavailable and follow the server's guidance.
- A warning search is for discovery and is not a product verdict. For product-specific questions, run the product-check tool when the user has chosen a region and supplied usable evidence.
- Preserve possible matches, unresolved restrictions, source dates, and official links from the server. Do not invent advice or facts.

## Privacy and sharing

- Eat or Yeet does not provide accounts or stored check history. Do not claim that the connected agent host forgets conversation or tool data; the host may retain it under its own policies.
- Never publish or share a result unless the user explicitly asks and a supported share tool is available. If the user declines sharing, do not retry or create a share.
- Do not imply continuous monitoring or future notifications. A check describes the returned sources and time only.

## When choosing groceries

- Check each candidate using its known product identity and the user's chosen region before recommending it or finalising a cart. Recheck material product changes and stale results before checkout.
- Exclude a product the returned evidence identifies as affected. A possible match or unresolved packet restriction needs a closer check or an alternative; do not silently clear it. Check any replacement too.
- Category search discovers notices for particular products. A notice concerning milk does not exclude all milk, and a chocolate warning for undeclared milk is not a milk-product recall.
- Report missing coverage and uncertainty. Never present an unmatched candidate as guaranteed safe.
- If the user asks for future category alerts, explain that the public plugin has no persistent watch or notification tool. A separately installed owner workflow must obtain the user's agreement to watched categories and delivery preferences before promising ongoing alerts.
