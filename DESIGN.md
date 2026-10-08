---
name: Eat or Yeet
description: Existing Geist typography, olive brand accents, and neutral warning interface.
colors:
  background: "oklch(1 0 0)"
  foreground: "oklch(0.17 0.018 110)"
  card: "oklch(0.975 0.008 110)"
  card-foreground: "oklch(0.17 0.018 110)"
  popover: "oklch(1 0 0)"
  popover-foreground: "oklch(0.17 0.018 110)"
  primary: "oklch(0.57 0.125 110)"
  primary-foreground: "oklch(0.99 0 0)"
  secondary: "oklch(0.94 0.018 110)"
  secondary-foreground: "oklch(0.22 0.025 110)"
  muted: "oklch(0.955 0.008 110)"
  muted-foreground: "oklch(0.42 0.025 110)"
  accent: "oklch(0.28 0.055 255)"
  accent-foreground: "oklch(0.99 0 0)"
  destructive: "oklch(0.56 0.205 27)"
  border: "oklch(0.87 0.015 110)"
  input: "oklch(0.87 0.015 110)"
  ring: "oklch(0.57 0.125 110)"
  eat: "oklch(0.49 0.12 135)"
  eat-soft: "oklch(0.94 0.04 135)"
  maybe: "oklch(0.58 0.14 72)"
  maybe-soft: "oklch(0.95 0.045 72)"
  yeet: "oklch(0.53 0.205 27)"
  yeet-soft: "oklch(0.95 0.045 27)"
  dark-background: "oklch(0.105 0 0)"
  dark-foreground: "oklch(0.96 0.01 110)"
  dark-card: "oklch(0.155 0.012 110)"
  dark-card-foreground: "oklch(0.96 0.01 110)"
  dark-popover: "oklch(0.155 0.012 110)"
  dark-popover-foreground: "oklch(0.96 0.01 110)"
  dark-primary: "oklch(0.7 0.13 110)"
  dark-primary-foreground: "oklch(0.12 0.015 110)"
  dark-secondary: "oklch(0.22 0.018 110)"
  dark-secondary-foreground: "oklch(0.95 0.01 110)"
  dark-muted: "oklch(0.2 0.01 110)"
  dark-muted-foreground: "oklch(0.72 0.018 110)"
  dark-accent: "oklch(0.74 0.1 250)"
  dark-accent-foreground: "oklch(0.1 0 0)"
  dark-destructive: "oklch(0.68 0.18 25)"
  dark-border: "oklch(1 0 0 / 14%)"
  dark-input: "oklch(1 0 0 / 18%)"
  dark-ring: "oklch(0.7 0.13 110)"
  dark-eat: "oklch(0.69 0.13 140)"
  dark-eat-soft: "oklch(0.22 0.045 140)"
  dark-maybe: "oklch(0.76 0.14 78)"
  dark-maybe-soft: "oklch(0.24 0.045 78)"
  dark-yeet: "oklch(0.7 0.18 25)"
  dark-yeet-soft: "oklch(0.23 0.05 25)"
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
    textColor: "{colors.primary}"
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

Geist text, olive brand marks, neutral backgrounds, and compact pill actions define the existing interface. Heavy headings establish the reading order; restrained surfaces and borders keep published warning content legible.

Light and dark themes use the same semantic roles. Red warning text and pale red containers identify official warning advice, with words and icons carrying meaning alongside colour.

**Key Characteristics:**

- Geist headings and body text, with Geist Mono for identifiers.
- Olive brand accents, neutral controls, and red warning treatments.
- Pill actions, rounded fields, and flat rows separated by borders.

This document records the existing code-defined system. It does not approve a replacement visual identity. The homepage direction remains in `.impeccable/surfaces/src-app-page-tsx.md`.

## Colors

The frontmatter preserves the OKLCH values in `src/app/globals.css`. Unprefixed colours describe the light theme; `dark-` entries record the matching `.dark` overrides. Components use semantic CSS variables so theme changes remain automatic.

### Primary

Olive `primary` colours the brand mark and primary library buttons. `primary-foreground` supplies their contrasting text; `ring` shares the olive accent for focus.

### Secondary

The pale olive-neutral `secondary` supports quiet grouped panels and secondary actions. `accent` is the existing blue accent token, not a replacement brand colour.

### Neutral

`background` and `foreground` supply the page and strong actions. `card`, `popover`, and `muted` provide tonal grouping. `muted-foreground` distinguishes supporting text. `border` and `input` define subtle boundaries; their dark equivalents use translucent white.

### Warning colours

`yeet` and `yeet-soft` colour warning labels and official-advice containers. `destructive` marks destructive or invalid states. Existing `eat` and `maybe` pairs remain result-status tokens, never evidence that an unmatched food is safe.

## Typography

Geist supplies headings, labels, and prose. Geist Mono is reserved for identifiers and codes. Font loading and CSS variables live in `src/app/layout.tsx`.

Page headlines use 2rem at weight 900 on phones and 3rem from the small breakpoint, with -0.035em tracking. Warning rows use `row-title` (1rem from the small breakpoint) so 40 rows stay scannable; dates and the UK/US switch use `meta` with tabular numerals. Codes and barcodes use Geist Mono with slight positive tracking. Warning titles use `title`; section headings use 1.5rem at weight 900. Supporting text commonly uses 0.875rem with 1.5rem line height. Headings balance wrapping; paragraphs use pretty wrapping.

## Layout

The shared page container has a 72rem maximum width with horizontal padding of 1rem, 1.5rem at 640px, and 2rem at 1024px. Tailwind's spacing unit is 0.25rem. Common panel padding is 1.25rem; gaps are usually 0.5rem, 0.75rem, 1.5rem, or 2rem.

The header wraps navigation into a second row below 640px. Warning pages use a single column until 1024px, then a flexible content column and an 18rem supporting column with a 2rem gap. The homepage search has a 48rem maximum width. Warning rows use borders and vertical spacing rather than a separate card around every item.

## Elevation & Depth

The warning interface uses tonal grouping and borders without ambient card shadows. Selected segments in the UK/US switch and the check-mode switch lift on a soft 1px-offset shadow; the search field carries a hairline shadow. Hard offset shadows are retired. The mobile check bar uses a translucent background with backdrop blur because content scrolls beneath it. Filter changes on the warning list animate rows through View Transitions (`warning-row`, `warning-enter`, `warning-exit`); typing filters instantly without animation. Scanner beam and verdict-reveal animations already exist; reduced-motion preferences suppress animations, transitions, and smooth scrolling.

## Shapes

The base radius is 0.75rem. Small, medium, large, and extra-large radii derive from that base as recorded in the frontmatter. Fields use the medium radius; grouped panels use the extra-large radius. Scanner actions, filter chips, facet selects, and the UK/US switch use fully rounded pills. Badges use the existing 2rem radius.

## Components

Library buttons expose primary, solid, outline, secondary, ghost, destructive, and link variants. `solid` (foreground fill, muted when disabled) is the primary action for every check and official-source button, matching the scanner links. Their default height is 2rem; prominent application actions override that size. Scanner links use foreground backgrounds, background text, bold labels, pill corners, and a minimum 2.75rem height. The warning-search submit control uses the same colour assignment with medium corners and a 3rem minimum height.

Search fields have a visible border, background surface, medium corners, 1rem horizontal padding, and 3rem height. Selects have a minimum 2.75rem height. Labels remain visible above fields. Focusable controls use a 3px ring at half the ring colour's opacity; library controls also change their border colour.

The header is one 4rem row: logo, desktop navigation (Warnings, Type a barcode, Scan food), the UK/US segmented switch, and the theme toggle. Below the medium breakpoint navigation moves to a fixed bottom check bar (Scan food plus a keyboard shortcut to manual entry), hidden on the check routes. The news ticker renders only when it has headlines.

The warning explorer is a client island fed by the server: a 3.5rem search field (press `/` to focus, Esc to clear), hazard chips with live counts (Food poisoning, Allergens, Foreign objects, Spoilage & hygiene, Other hazards), and auto-applying food and shop selects. Filters sync to the URL without a server round trip. Rows show a tabular date column, the title with matched terms marked in olive, a hazard tag (red tint for pathogens, amber for allergens, neutral otherwise; the label always names the hazard), categories and shop. Empty results offer one-tap removal of each active filter. The barcode field confirms the check digit as you type and explains length or check-digit problems before submission. Cards use flat neutral fills and extra-large corners. Warning badges and official-advice containers use the warning palette; warning and news rows use separators and underline links on hover.

The sidecar records representative component snippets from the current implementation. Library defaults and prominent application overrides are distinct sizes, not competing token definitions.

## Do's and Don'ts

- Do use the existing semantic tokens in both themes.
- Do pair warning colour with explicit text and icons.
- Do preserve keyboard focus rings and reduced-motion behaviour.
- Don't replace Geist, the olive brand accent, or the light and dark palettes during an extension.
- Don't use a full-screen traffic-light colour treatment or a reassuring safe badge.
- Don't add decorative imagery that competes with official advice.
