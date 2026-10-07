# Warnings-first handover

Implemented:

- Warnings-first homepage with purpose, search, and a chronological warning list.
- Persistent UK/US selection shared by browsing, scanning, and manual checks.
- Categories grouped into fresh/chilled, cupboard/snacks, and meals/other products.
- “Check my food” in the top navigation.
- Official links resolved to public pages. FDA enforcement records without announcement pages link to the public report with lookup instructions.
- Related news beneath the right-side block, plus a latest-headline ticker using the same feed.
- News failures leave official warnings usable.

Publisher feeds: [BBC Health](https://feeds.bbci.co.uk/news/health/rss.xml), [CBS Health](https://www.cbsnews.com/latest/rss/health), and [Guardian food safety](https://www.theguardian.com/world/food-safety/rss).

Validation passed: 108 unit tests, 16 desktop/mobile browser tests, lint, TypeScript, and production build. Desktop and mobile layouts were inspected, including dark mode.

Remaining integration work: align the local Convex configuration with a deployment containing `incidents:listActivePage`. Populated warning states were tested with controlled data. No backend deployment was performed.

Main implementation: [homepage](/Users/anthonyhumphreys/Code/eat-or-yeet/src/app/page.tsx:7). Existing visual tokens are documented in [DESIGN.md](/Users/anthonyhumphreys/Code/eat-or-yeet/DESIGN.md).