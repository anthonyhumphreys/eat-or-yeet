# Eat or Yeet

**Scan it. Check it. Eat it or yeet it.**

Eat or Yeet is a mobile-first packaged-food recall checker. It scans barcodes, extracts visible label information from photographs, and compares that evidence with current official UK and US food-safety warnings.

The AI model only reads packaging. Deterministic TypeScript rules issue the verdict and explain every match.

## Safety language

`EAT` means no current warning in the selected dataset matched the supplied evidence. It never means that the food is safe. Users should still follow storage instructions, use-by dates, and official food-safety advice.

Unclear evidence returns `NO CLUE`. Possible or contextual matches return `MAYBE YEET`. Confirmed and probable matches return `YEET`, with the match level shown separately.

## Stack

- Next.js 16 App Router, React 19, strict TypeScript
- Tailwind CSS 4 and shadcn/ui
- Convex Cloud for incident data, caching, shares, and rate limits
- Vercel AI SDK through OpenRouter
- `z-ai/glm-5.3-flash` for vision extraction
- Native `BarcodeDetector` with ZXing fallback
- Zod, Vitest, and Playwright

## Local setup

Requirements: Node.js 24+, pnpm 10+, a Convex account, and an OpenRouter API key for photo analysis.

1. Install dependencies.

   ```bash
   pnpm install
   ```

2. Copy the environment template.

   ```bash
   cp .env.example .env.local
   ```

3. Link a Convex development deployment. The CLI writes `CONVEX_DEPLOYMENT` and `NEXT_PUBLIC_CONVEX_URL` to `.env.local`.

   ```bash
   pnpm exec convex dev --once
   ```

4. Generate one value for `CONVEX_SERVER_SECRET`, add it to `.env.local`, then set the same value on the Convex development deployment. Generate `CRON_SECRET` and `RATE_LIMIT_SALT` separately.

   ```bash
   pnpm exec convex env set CONVEX_SERVER_SECRET
   ```

5. Optionally seed fictional development scenarios. Keep `ALLOW_DEMO_DATA=true` outside production and enable it on the Convex development deployment.

   ```bash
   pnpm exec convex env set ALLOW_DEMO_DATA true
   pnpm data:seed
   ```

6. Start the app.

   ```bash
   pnpm dev
   ```

Demo records are marked and excluded unless `ALLOW_DEMO_DATA=true`.

### Demo checks

| Scenario | Input | Expected result |
| --- | --- | --- |
| Exact product and batch | Barcode `5000000000006`, batch `24182` | YEET, confirmed |
| Affected producer | Producer `Demo Valley Foods` | YEET, probable |
| Context only | US region, country `United States`, category `Leafy greens` | MAYBE YEET, contextual |
| Unrelated product | Any unrelated valid product details | EAT |
| Empty form | No identifying fields | NO CLUE |

## Environment variables

| Name | Purpose |
| --- | --- |
| `CONVEX_DEPLOYMENT` | Convex project deployment used by the CLI |
| `NEXT_PUBLIC_CONVEX_URL` | Convex deployment URL used by Next.js |
| `CONVEX_SERVER_SECRET` | Authorises server-only Convex mutations and refresh actions |
| `OPENROUTER_API_KEY` | Server-only OpenRouter credential |
| `OPENROUTER_MODEL` | Defaults to `z-ai/glm-5.3-flash` |
| `CRON_SECRET` | Protects `/api/cron/incidents` |
| `RATE_LIMIT_SALT` | Hashes anonymous rate-limit identifiers |
| `NEXT_PUBLIC_APP_URL` | Canonical deployed origin |
| `ALLOW_DEMO_DATA` | Enables local fictional incidents only |

## Official incident data

The scheduled importer reads only official sources:

- UK: Food Standards Agency food-alert API
- US: FDA recall announcements plus the FDA food enforcement API, filtered to ongoing recalls

FDA company announcements can be published before a recall is classified into an enforcement report. The announcement importer reads the FDA's official food recall listing and follows each official notice so newly published UPCs, GTINs, and lot codes can be checked without relying on secondary reporting.

The FSA feed does not expose a universal resolved state, so imported FSA warnings expire 180 days after their latest update. The original source payload, external ID, retrieval time, publication time, update time, authority, and official URL are retained.

Run an import locally:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/incidents
```

The importer upserts records and embedded match targets. A failed source fetch is recorded in `ingestionRuns` and never deletes previously valid incidents. Convex runs the official-source refresh daily at 04:17 UTC.

## Privacy and rate limits

Packaging images live only for the duration of the analysis request. The app does not write images or scan histories to the database.

A signed anonymous cookie identifies a browser for rate limiting. The database stores a salted hash, action name, time bucket, and count. Defaults are 10 image analyses, 120 warning checks, and 20 public shares per browser per hour.

Normal Web Share actions use generic copy. Public links require a separate explicit action, contain no barcode, batch code, raw OCR text, or image, and expire after 30 days.

## Commands

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
pnpm convex:dev
pnpm convex:deploy
pnpm data:seed
```

## Vercel deployment

Deploy the Convex functions first, then configure Vercel with the production deployment URL and the same server secret stored in Convex.

```bash
vercel link
pnpm convex:deploy
pnpm exec convex env set --prod CONVEX_SERVER_SECRET
vercel env add NEXT_PUBLIC_CONVEX_URL production
vercel env add CONVEX_SERVER_SECRET production --sensitive
vercel --prod
```

Set all variables from `.env.example` in Development, Preview, and Production as appropriate. Never set `ALLOW_DEMO_DATA=true` in Production. Convex owns the daily import schedule. The protected Next.js cron route remains available for a manual refresh.

Before promoting a deployment, run lint, type checks, unit tests, a production build, and the Playwright smoke tests against the preview URL.
