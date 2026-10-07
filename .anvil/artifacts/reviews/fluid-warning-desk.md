The landing page now prioritises browsing published warnings through restrained typography, spacing, and borders.

Changes:
- Shorter introduction with the safety qualification retained.
- Notice titles lead each row; authority, update date, category, and retailer form supporting metadata.
- Search and filters share one form and navigate without a document reload.
- Country, count, and official source attribution transition briefly between selections.
- Reduced motion and browsers without View Transitions retain functional browsing.
- Compact mobile navigation fits at 320px.
- Streamed news hydrates against its server region before adopting the current selection.

Verification:
- Production build, lint, and TypeScript passed.
- 117 unit tests and 24 browser tests passed.
- Light/dark and 320–1440px browser checks found no horizontal overflow.
- Country switching and search produced no browser errors.
- Impeccable detector ran once. The new off-ramp font size was removed; existing selection-colour and scanner-corner advisories were retained outside this scope.

Validation used an isolated local Convex deployment with clearly labelled fictional fixtures. The temporary environment was removed. Physical-device performance and production deployment remain unverified.

The dependency/performance baseline is committed as d34db29. This UI refinement remains uncommitted.