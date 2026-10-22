<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Marketing video (`video/`)

A standalone Remotion package pinned to 4.0.532. The root tsconfig and ESLint ignore it. Install with `pnpm install --ignore-workspace` inside `video/`.

- `pnpm capture` saves production screenshots, live food recall counts and real list rows to `video/public/`.
- `pnpm render` writes `out/sizzle.mp4` and `out/sizzle.gif`.
- `pnpm render:architecture` writes `out/architecture.mp4` and `out/architecture.gif`, the architecture and integrations explainer.
- `pnpm studio` opens the preview.

The architecture video must not show or mention the NAS importer. Show USDA FSIS and FDA announcements as sources only, without explaining how they are fetched.

Pace for reading, not for speed. Keep copy on screen for about one second per three words after it settles, and hold each scene's final state for at least a second before the cut. Stagger related items by about 0.25 s or more instead of popping them in together.

Use flat brand colours. Gradients and blur band badly in the GIF palette. On-screen copy says what the app does. Browsing the recall list is the main feature; checking a pack is optional and stays secondary. Don't show an "EAT" or safe verdict, and don't make claims about safety or authority.
