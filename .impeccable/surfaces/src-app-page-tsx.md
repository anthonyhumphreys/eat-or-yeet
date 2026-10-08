---
version: 1
slug: "src-app-page-tsx"
primary_target: "src/app/page.tsx"
related_targets: ["src/app/incidents/page.tsx","src/components/incidents/warning-feed.tsx"]
---

# Warnings landing page

Mode: Operate. Extend the existing Geist, olive, neutral, and red warning interface. Scope includes the homepage, warning browsing, shared location preference, and news. Barcode and manual checks remain separate routes.

## Direction contract

THESIS: Fluid warning desk. Help a visitor find a published warning before starting a product check. Search and a chronological warning list carry the page. Data should be clear, compact, and easy to scan; visual refinement comes from typography, spacing, and quiet borders.

OWN-WORLD: Preserve Geist typography, white and dark neutral surfaces, olive brand accents, pill actions, and red official warning treatments. Use existing tokens and components.

STORY: Choose UK or US once. Find a product, brand, category, or named retailer. Open the official advice or check the pack through the scanner.

FIRST VIEWPORT: A compact purpose statement, instant warning search, hazard chips, and food/shop selects above the list. Desktop has a sticky scanner block and publisher headlines on the right. Mobile drops the scanner block for a fixed bottom check bar and puts news after warnings. The UK/US switch stays in the single-row header.

FORM: Existing application layout extended within its current visual system. No new visual identity or concept roll.

MOTION: Hazard, category, shop and "show more" changes animate rows into place with View Transitions; typing filters instantly with no animation. The result heading crossfades. Honour reduced motion and support browsers without View Transitions.

FINISH: Verify light and dark rendering from 320px to desktop, country persistence, in-page filter submission, history navigation, news hydration, and news failures. Keep deployment status separate from local interface validation.

## Constraints

Never imply an unmatched food is safe. News reporting is supplementary. No invented news or warning records. Resolve stored API links to official public pages. Preserve the other thread's backend work.
