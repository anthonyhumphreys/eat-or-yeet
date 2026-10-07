# ADR 0001: Remove AI from the recall checker

Date: 2026-10-07

Status: Accepted

## Context

The MVP used a vision model to extract packaging details from uploaded photographs. Deterministic rules already made all recall decisions. The public-readiness review found that photo extraction added uncertain evidence, upload limits, paid inference abuse, and privacy explanations to a task that users can complete with a barcode or a few label details.

The user has chosen to remove AI and keep the interface simple.

## Decision

Remove photo uploads, the analysis API, the vision extraction helper, AI SDK dependencies, and OpenRouter configuration. Keep native barcode scanning with a ZXing fallback and manual entry. Product metadata may supply a name and brand; it must not invent a producer or country of origin from a country of sale or manufacturing-place string.

Continue using deterministic matching against official sources. Match identifiers, batches and dates within the same product group. Missing evidence and missing, failed or stale source data must preserve uncertainty.

Display an unmatched check as **No matching warning found**, with the check time, region and source scope. This is a search result, not a statement that food is safe. Retain the internal `EAT` enum temporarily for stored-result compatibility; it is not the public label.

Public shares contain generic result copy, official warning details where applicable, check time and coverage. They exclude user-entered product details and identifiers, and expire after 24 hours.

## Consequences

- Model inference and image-upload operating costs become zero.
- Users must scan a barcode or enter relevant label details themselves.
- The main cost drivers become database operations, source imports, hosting and bandwidth.
- Camera permission failures must always have a visible manual alternative.
- Coverage, source freshness and conservative matching remain essential. Removing AI does not solve missing recalls or establish that food is safe.
- Existing production secrets, deployment settings and old share rows require an explicit rollout check. Removing code does not revoke an external API key.

## Alternatives considered

Retaining optional AI extraction would preserve convenience for complex labels, but would retain the uncertainty, dependency and abuse costs identified in the review. Browser OCR would avoid paid inference but still add a second uncertain capture flow and substantial maintenance. Neither is needed for the current product.

## Reconsideration

Consider another capture method only if observed user failures show that barcode scanning and manual entry prevent useful checks. Assess its benefit with representative packaging and evaluate errors before adding it to the public flow.
