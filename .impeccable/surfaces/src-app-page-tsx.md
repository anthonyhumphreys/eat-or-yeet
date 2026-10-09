---
version: 1
slug: "src-app-page-tsx"
primary_target: "src/app/page.tsx"
related_targets: ["src/app/incidents/page.tsx","src/components/incidents/warning-feed.tsx"]
---

# Warnings landing page

Mode: Operate. Cream and marigold refresh (charcoal and saffron in dark mode) with the shield logo. Scope includes the homepage, recall browsing, the first-visit country pop-up, and news. Checking a product is one header button away; barcode and manual checks remain separate routes.

## Direction contract

THESIS: A recall reference people check while writing a shopping list. Help a visitor see what is recalled right now before starting a product check. The top alert and a chronological recall list carry the page. Data should be clear, compact, and easy to scan; visual refinement comes from typography, spacing, and quiet borders.

OWN-WORLD: Geist typography, cream and charcoal surfaces, marigold fills with ink text, the shield logo, pill actions, and red official warning treatments. Use existing tokens and components.

STORY: Choose UK or US once, in a pop-up. See the top alert, browse by food type, or search for a product, brand or shop. Open a recall for the official advice, share it to a group chat, or check the pack.

FIRST VIEWPORT: A short title ("UK food recalls"), the top alert, food-type tabs, search, and hazard/shop selects above the list. Desktop runs publisher headlines down the right, level with the top alert. Phones show a "See the news" button under the top alert and put the news after the list. No ticker and no bottom bar; the UK/US select and "Check a product" stay in the single-row header.

FORM: Existing application layout with a new visual identity: cream and marigold, shield logo.

MOTION: Food tab, hazard, shop and "show more" changes animate rows into place with View Transitions; typing filters instantly with no animation. The result heading crossfades. Honour reduced motion and support browsers without View Transitions.

FINISH: Verify light and dark rendering from 320px to desktop, country persistence, in-page filter submission, history navigation, news hydration, and news failures. Keep deployment status separate from local interface validation.

## Constraints

Never imply an unmatched food is safe. News reporting is supplementary. No invented news or warning records. Resolve stored API links to official public pages. Preserve the other thread's backend work.
