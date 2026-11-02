---
name: Eat or Yeet
description: Geist typography, cream and marigold brand (charcoal and saffron in dark mode), a shield logo, and calm red warning treatments.
colors:
  background: "#fbf5e9"
  foreground: "#1d1a16"
  card: "#fffcf5"
  card-foreground: "#1d1a16"
  popover: "#fffcf5"
  popover-foreground: "#1d1a16"
  primary: "#e39b00"
  primary-foreground: "#1d1a16"
  secondary: "#f3ebda"
  secondary-foreground: "#2b241b"
  muted: "#f3ede0"
  muted-foreground: "#6b6358"
  accent: "#fcebc2"
  accent-foreground: "#5c4300"
  link: "#8a5d00"
  destructive: "#b4231c"
  border: "#e8dec8"
  input: "#d8cdb4"
  ring: "#c98800"
  eat: "#3f3d37"
  eat-soft: "#ece5d6"
  maybe: "#7a3900"
  maybe-soft: "#fff1db"
  yeet: "#9e1b14"
  yeet-soft: "#fdecea"
  dark-background: "#17171a"
  dark-foreground: "#f4f1ea"
  dark-card: "#222226"
  dark-card-foreground: "#f4f1ea"
  dark-popover: "#222226"
  dark-popover-foreground: "#f4f1ea"
  dark-primary: "#f2a900"
  dark-primary-foreground: "#17171a"
  dark-secondary: "#2a2a2f"
  dark-secondary-foreground: "#f4f1ea"
  dark-muted: "#222226"
  dark-muted-foreground: "#a8a49b"
  dark-accent: "#3a2e12"
  dark-accent-foreground: "#f8d27a"
  dark-link: "#f2b733"
  dark-destructive: "#ff8a80"
  dark-border: "oklch(1 0 0 / 12%)"
  dark-input: "oklch(1 0 0 / 18%)"
  dark-ring: "#f2a900"
  dark-eat: "#d9d4ca"
  dark-eat-soft: "#2e2e33"
  dark-maybe: "#ffc266"
  dark-maybe-soft: "#3a2a12"
  dark-yeet: "#ffb1a8"
  dark-yeet-soft: "#3a1a18"
typography:
  headline:
    fontFamily: "Geist, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 900
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  headline-wide:
    fontFamily: "Geist, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 900
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Geist, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 700
    lineHeight: 1.375
  body:
    fontFamily: "Geist, sans-serif"
    fontSize: "1rem"
    lineHeight: 1.75
  row-title:
    fontFamily: "Geist, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.375
  meta:
    fontFamily: "Geist, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: "1.25rem"
  label:
    fontFamily: "Geist, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 700
    lineHeight: "1.25rem"
  source-id:
    fontFamily: "Geist Mono, monospace"
    fontSize: "0.75rem"
    lineHeight: "1rem"
rounded:
  sm: "0.45rem"
  md: "0.6rem"
  lg: "0.75rem"
  xl: "0.9375rem"
  badge: "2rem"
  full: "calc(infinity * 1px)"
spacing:
  unit: "0.25rem"
  2: "0.5rem"
  3: "0.75rem"
  4: "1rem"
  5: "1.25rem"
  6: "1.5rem"
  8: "2rem"
  9: "2.25rem"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.lg}"
    height: "2rem"
    padding: "0 0.625rem"
  button-outline:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    height: "2rem"
    padding: "0 0.625rem"
  button-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.secondary-foreground}"
    rounded: "{rounded.lg}"
    height: "2rem"
    padding: "0 0.625rem"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    height: "2rem"
    padding: "0 0.625rem"
  button-destructive:
    backgroundColor: "color-mix(in oklch, var(--destructive) 10%, transparent)"
    textColor: "{colors.destructive}"
    rounded: "{rounded.lg}"
    height: "2rem"
    padding: "0 0.625rem"
  button-link:
    textColor: "{colors.link}"
    rounded: "{rounded.lg}"
    height: "2rem"
    padding: "0 0.625rem"
  warning-search:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    height: "3rem"
    padding: "0 1rem"
  navigation:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    padding: "0.75rem 0"
  chip:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.badge}"
    height: "1.25rem"
    padding: "0.125rem 0.5rem"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.card-foreground}"
    rounded: "{rounded.xl}"
    padding: "1.25rem"
---

# Design System: Eat or Yeet

## Overview

A warm, trustworthy recall reference. Cream pages, a marigold brand colour and a shield logo with a crossed spoon and fork; charcoal and saffron in dark mode. Heavy Geist headings set the reading order, and calm red treatments mark official warnings, always with words and icons as well as colour.

**Key Characteristics:**

- Geist headings and body text, with Geist Mono for identifiers.
- Cream and marigold brand (charcoal and saffron in dark mode), ink text, and red warning treatments that never rely on colour alone.
- Pill actions, rounded fields, and flat rows separated by borders.

The direction comes from the design canvases linked in the pull request that introduced it. The homepage direction lives in `.impeccable/surfaces/src-app-page-tsx.md`.

## Logo

A shield with a crossed spoon and fork. On the marigold tile the shield is ink and the spoon and fork are cut out of it in marigold. `src/components/brand-logo.tsx` draws it for the interface (`BrandLogo`, `BrandTile`); `src/lib/brand/logo.ts` produces the same mark as SVG markup for the favicon and link-preview images.

## Colors

The frontmatter mirrors `src/app/globals.css`. Unprefixed colours describe the light theme; `dark-` entries record the matching `.dark` overrides. Components use semantic CSS variables so theme changes remain automatic.

### Primary

Marigold `primary` (saffron in dark mode) is a fill colour: the logo tile, the "Check a product" button, active food tabs and the country pop-up's main button. Its text is always ink (`primary-foreground`). Marigold is too light for text on cream, so text links use `link` (a deep amber in light mode, saffron in dark mode). `ring` is a darker marigold for focus.

### Secondary

Warm cream `secondary`, `muted` and `accent` tints support grouped panels, quiet controls and selected options.

### Neutral

`background` and `foreground` supply the page and strong actions (ink on cream, cream on charcoal). `card` and `popover` sit slightly lighter than the page. `muted-foreground` distinguishes supporting text. `border` and `input` define subtle boundaries; their dark equivalents use translucent white.

### Warning colours

`yeet` and `yeet-soft` colour recall labels and official-advice containers. A recall label is a dark solid red pill with a triangle icon, so it reads as serious in greyscale and stays distinct from marigold. `destructive` marks destructive or invalid states. `eat` is a neutral (never green) and `maybe` a dark amber; neither is evidence that an unmatched food is safe.

## Typography

Geist supplies headings, labels, and prose. Geist Mono is reserved for identifiers and codes. Font loading and CSS variables live in `src/app/layout.tsx`.

Page headlines use 1.75rem at weight 900 on phones and 3rem from the small breakpoint, with -0.035em tracking. Warning rows use `row-title` (1rem from the small breakpoint) so 40 rows stay scannable; dates and the UK/US switch use `meta` with tabular numerals. Codes and barcodes use Geist Mono with slight positive tracking. Warning titles use `title`; section headings use 1.5rem at weight 900. Supporting text commonly uses 0.875rem with 1.5rem line height. Headings balance wrapping; paragraphs use pretty wrapping.

## Layout

The shared page container has a 72rem maximum width with horizontal padding of 1rem, 1.5rem at 640px, and 2rem at 1024px. Tailwind's spacing unit is 0.25rem. Common panel padding is 1.25rem; gaps are usually 0.5rem, 0.75rem, 1.5rem, or 2rem.

The header is a single row at every width. Recall pages use a single column until 1024px, then a flexible content column and a 20rem supporting column with a 3rem gap. On the home page the news runs down that column beside the list, level with the top alert; on phones it follows the list. Recall rows use borders and vertical spacing rather than a separate card around every item.

## Elevation & Depth

The warning interface uses tonal grouping and borders without ambient card shadows. The check-mode switch lifts its selected segment on a soft 1px-offset shadow; the search field carries a hairline shadow. Hard offset shadows are retired. The first-visit country pop-up is the only overlay: a bottom sheet on phones, a centred dialog on wider screens. Filter changes on the warning list animate rows through View Transitions (`warning-row`, `warning-enter`, `warning-exit`); typing filters instantly without animation. Scanner beam and verdict-reveal animations already exist; reduced-motion preferences suppress animations, transitions, and smooth scrolling.

## Shapes

The base radius is 0.75rem. Small, medium, large, and extra-large radii derive from that base as recorded in the frontmatter. Fields use the medium radius; grouped panels use the extra-large radius. Buttons, food tabs, facet selects, and the country select use fully rounded pills. The top alert, "See the news" button and recall panels share the extra-large radius. Badges use the existing 2rem radius.

## Components

Library buttons expose primary, solid, outline, secondary, ghost, destructive, and link variants. `solid` (foreground fill, muted when disabled) is the primary action for every check and official-source button, matching the scanner links. Their default height is 2rem; prominent application actions override that size. Scanner links use foreground backgrounds, background text, bold labels, pill corners, and a minimum 2.75rem height. The warning-search submit control uses the same colour assignment with medium corners and a 3rem minimum height.

Search fields have a visible border, background surface, medium corners, 1rem horizontal padding, and 3rem height. Selects have a minimum 2.75rem height. Labels remain visible above fields. Focusable controls use a 3px ring at half the ring colour's opacity; library controls also change their border colour.

The header is one 4rem row: the logo tile and name, Recalls (from the medium breakpoint), the UK/US select, the theme toggle, and a marigold "Check a product" button ("Check" on phones). There is no bottom bar and no news ticker. The first visit asks "Where do you buy your food?" in a pop-up with the suggested country pre-selected; closing it keeps that selection.

The home page leads with a short title ("UK food recalls"), the top alert (the newest food-poisoning recall from the last 30 days, otherwise the newest recall) and, on narrower screens, a "See the news" button of the same shape. The recall explorer is a client island fed by the server: food-type tabs with live counts, a 3rem search field on the full list at /incidents only (press `/` to focus, Esc to clear; the home page has none because "Check a product" covers looking something up), and an auto-applying shop select when shops are named. There is no hazard filter; each row's tag names the hazard. Filters sync to the URL without a server round trip. Category chips only appear when they have recalls. The home page lists the newest 10 recalls with a "See all" link to the full list at /incidents. The Medical super-category is labelled "Pharmaceutical". Rows show the date and how long ago ("3 Oct 2026 · 6 days ago") so old recalls read as old, then "Product name: Recalled for …" with the product in bold, the reason from the notice (or the hazard in words when the notice gives none) and matched terms marked in marigold, the company, a hazard tag (red tint for pathogens, amber for allergens, neutral otherwise; the label always names the hazard), categories and shop. Empty results offer one-tap removal of each active filter.

A recall page reads the same however people arrive (from the list, a check, or a link in a chat): the red "Active recall" label and date, the title and a one-line summary with "Share this recall" beside it, "What to do" with "Have one at home? Check your pack" inside it, "Which products", related news, then "See all active recalls". The supporting column holds Official information, with the company statement under it (or a line saying there is none). The barcode field confirms the check digit as you type and explains length or check-digit problems before submission. Cards use flat neutral fills and extra-large corners. Warning badges and official-advice containers use the warning palette; warning and news rows use separators and underline links on hover.

The sidecar records representative component snippets from the current implementation. Library defaults and prominent application overrides are distinct sizes, not competing token definitions.

## Do's and Don'ts

- Do use the existing semantic tokens in both themes.
- Do pair warning colour with explicit text and icons.
- Do preserve keyboard focus rings and reduced-motion behaviour.
- Do use marigold as a fill with ink text; use `link` for coloured text.
- Don't replace Geist, the marigold brand colour, or the light and dark palettes during an extension.
- Don't use a full-screen traffic-light colour treatment or a reassuring safe badge.
- Don't add decorative imagery that competes with official advice.
