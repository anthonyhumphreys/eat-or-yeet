The README now distinguishes:

- Community contributors use an account-free local Convex backend and submit PRs. No shared Convex seat or hosting credentials are needed.
- Core contributors use the shared Convex project for hosted integration work and manage releases.

CONTRIBUTING.md covers local setup, development secrets, demo data limitations, optional live ingestion, project conventions, verification commands and PR expectations.

Verification: all 108 unit tests passed. Local documentation links, code fences and diff whitespace checks passed. Convex commands were checked against the installed CLI; a fresh local backend setup was not exercised.