# Eat or Yeet videos

Three independent Remotion compositions use the app's brand colours and Geist typography. The original `Sizzle` is a 30-second feature reel. `Overview` is a 29-second walkthrough of choosing a country, browsing and filtering recalls, reading a notice, sharing it and optionally checking a pack. `Architecture` is an 84-second explainer of how the app works: official sources, the Cloudflare import pipeline, source health, the Next.js website, the optional pack check, the MCP server and the Notion shopping list.

Install within this directory with `pnpm install --ignore-workspace`. FFmpeg is required for GIF exports.

| Command | Result |
| --- | --- |
| `pnpm capture` | Refresh the original sizzle's screenshots and list data |
| `pnpm render` | `out/sizzle.mp4` and `out/sizzle.gif` |
| `pnpm capture:overview` | Capture separate live app views in `public/overview/` |
| `pnpm render:overview` | `out/overview.mp4` and `out/overview.gif` |
| `pnpm still:overview` | `out/overview-poster.png` |
| `pnpm render:architecture` | `out/architecture.mp4` and `out/architecture.gif` |
| `pnpm still:architecture` | `out/architecture-poster.png` |
| `pnpm studio` | Preview any composition |
| `pnpm typecheck` | Check the standalone video package |

All MP4s render at 1920 × 1080, 30 fps. GIFs loop at 960 × 540, 24 fps. The videos are silent, with copy on screen. `capture:overview` accepts `--base=https://www.eatoryeet.app` for an alternative deployment.

The overview uses real production screens. Its optional pack scene shows barcode and label entry without a verdict. The original sizzle and its capture files stay separate. The architecture video reuses the sizzle's list data and draws its diagrams in code; its Notion example is fictional. It leaves out the home NAS importer. Use flat fills, keep browsing central, and avoid claims that food is safe.
