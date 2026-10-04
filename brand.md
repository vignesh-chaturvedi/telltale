# Brand — Telltale

Live safety ratings (A–E) for every market on Hyperliquid, with alerts.

_Set on 2026-09-29; the editorial revamp (paper, stone bands, a serif display face, square buttons, motion) on 2026-10-04. Change the tokens in `apps/web/src/index.css` and this file together._

## Palette — Signal Teal

**Vibe:** calm · technical · fresh. Live data you can trust; cool but not cold.
**Category:** infra/data
**Mood:** calm · minimal
**Reference:** L2BEAT (a risk-rating site for rollups); the October revamp took its layout and editorial feel from solomonlabs.org (a light serif display, two-tone headlines, dot labels, alternating bands, square buttons with long arrows, an engraved centrepiece).

### Seeds

| Role | Dark OKLCH | Dark hex | Light OKLCH | Light hex |
|---|---|---|---|---|
| bg-base (paper) | `oklch(0.145 0.01 200)` | `#060B0C` | `oklch(0.978 0.006 95)` | `#F9F8F3` |
| bg-elevated (cards) | `oklch(0.19 0.013 200)` | `#0D1616` | `oklch(1 0 0)` | `#FFFFFF` |
| band (stone / night) | `oklch(0.11 0.008 200)` | `#020505` | `oklch(0.948 0.008 95)` | `#EFEEE8` |
| primary | `oklch(0.76 0.14 194)` | `#00CCCB` | `oklch(0.5 0.14 195)` | `#007A7C` |
| primary-soft | `oklch(0.85 0.1 195)` | `#76E2E2` | `oklch(0.65 0.1 195)` | `#2CA2A2` |
| fg-base (ink) | `oklch(0.95 0.01 100)` | `#F0EFE7` | `oklch(0.2 0.008 200)` | `#121717` |
| signal (the red tick) | `oklch(0.64 0.19 30)` | | `oklch(0.6 0.2 30)` | `#DE3E2D` |

**Surfaces.** Paper for reading sections, white cards on it, and full-width **bands** (header, hero, methodology, builders, footer) that are stone in light and near-black in dark, so sections alternate in both themes. Bands use their own tokens (`--band`, `--band-raised`, `--band-foreground`, `--band-muted`, `--band-border`, `--band-accent`, `--hero`) through the `band` utility. Corners are square (`--radius` 2 px, buttons 0); grids of cards share hairline borders instead of gaps. The red `--signal` appears only as the small warning ticks around the hero and the live clock's dot.

### Tokens (applied to `apps/web/src/index.css`)

The full shadcn-style token set lives in `:root` (light) and `.dark` (dark) in `apps/web/src/index.css`, and is mapped into Tailwind colors with `@theme inline` (`bg-background`, `text-foreground`, `bg-primary`, …). This is a Vite app, so there was no earlier `globals.css` to back up: the file was created with this palette.

**Light mode (`:root`):**

```css
--background: oklch(0.978 0.006 95);
--foreground: oklch(0.2 0.008 200);
--primary: oklch(0.5 0.14 195);
--muted-foreground: oklch(0.49 0.01 200);
--border: oklch(0.9 0.008 95);
--band: oklch(0.948 0.008 95);
--band-foreground: oklch(0.2 0.008 200);
--band-accent: oklch(0.5 0.14 195);
```

**Dark mode (`.dark`):**

```css
--background: oklch(0.145 0.01 200);
--foreground: oklch(0.95 0.01 100);
--primary: oklch(0.76 0.14 194);
--muted-foreground: oklch(0.71 0.01 200);
--border: oklch(0.27 0.015 200);
--band: oklch(0.11 0.008 200);
--band-foreground: oklch(0.95 0.012 100);
--band-accent: oklch(0.8 0.13 192);
```

The dark-mode `--destructive` is `oklch(0.55 0.21 25)` rather than the more common `oklch(0.65 0.22 25)`, because that only reaches about 3.6:1 with white text.

### Grade scale

Grades have their own semantic colors, separate from the brand teal, so an A never reads as "brand-colored" and an E never reads as an error message. Use them only for grades.

| Grade | Name | Light | Dark |
|---|---|---|---|
| A | Strong | `oklch(0.5 0.13 150)` | `oklch(0.76 0.14 150)` |
| B | Sound | `oklch(0.52 0.12 125)` | `oklch(0.8 0.12 125)` |
| C | Mixed | `oklch(0.52 0.11 80)` | `oklch(0.83 0.13 90)` |
| D | Weak | `oklch(0.55 0.15 50)` | `oklch(0.75 0.14 55)` |
| E | Fragile | `oklch(0.52 0.18 25)` | `oklch(0.68 0.17 25)` |

Tailwind utilities: `text-grade-a` … `text-grade-e` (and `bg-`, `border-`). Show a grade as its letter plus the color, never color alone. Badges tint their background with the grade color at 8%; the light-mode C was darkened from `oklch(0.56 0.12 80)` so its letter still passes AA on that tint.

### Contrast check

All pairs are computed from the actual colors (OKLCH → sRGB luminance) and pass WCAG AA:

| Pair | Light | Dark |
|---|---|---|
| foreground / background | 17.9:1 ✓ | 17.9:1 ✓ |
| muted-foreground / background | 7.0:1 ✓ | 6.5:1 ✓ |
| primary-foreground / primary | 4.9:1 ✓ | 9.6:1 ✓ |
| ring / background | 4.9:1 ✓ | 9.4:1 ✓ |
| destructive-foreground / destructive | 5.1:1 ✓ | 5.1:1 ✓ |
| grade colors / card (weakest) | 5.1:1 ✓ | 6.0:1 ✓ |
| grade colors / tinted badge (weakest) | 4.6:1 ✓ | 5.6:1 ✓ |

## Logo — telltale ribbons

A stay with two ribbons streaming from it. On a sail, telltales are the ribbons that show the wind before you feel it; Telltale shows how a market is behaving before it fails. Chosen October 1, 2026.

- Always on the dark tile (`#061415`): the stay is `#EBF4F4` at 55% opacity, the upper ribbon `#00C5C6`, the lower `#76E2E2`. The tile and its colors stay the same in light and dark themes.
- Files in `brand/`: `logo.svg` (the tile, the source for everything else), `mark.svg` (the mark alone, for dark surfaces), `telltale-avatar-x-400.png`, `telltale-avatar-telegram-640.png`, `telltale-avatar-1600.png`, and `telltale-header-x-1500x500.png`.
- The website's favicon and header logo use the same drawing (`apps/web/public/favicon.svg`, `Logo` in `App.tsx`).
- The home hero shows the mark struck in liquid metal (Paper Shaders' `LiquidMetal`, masked by `apps/web/public/telltale-mark-mask.svg`) on the dark tile, inside rings of guilloche: the engraved interlaced lines of banknotes. The tile stays dark in both themes; without WebGL the flat mark shows.
- Social headers keep text out of the bottom-left quarter, where X places the profile photo.

## Typography — Newsreader + Inter + JetBrains Mono

- **Display (headlines):** Newsreader (variable, optical size 72), light weight 320, tracking −0.028 em
- **Body and UI:** Inter (variable)
- **Mono (numbers, tickers, addresses):** JetBrains Mono (variable)

Self-hosted with `@fontsource-variable/newsreader`, `@fontsource-variable/inter` and `@fontsource-variable/jetbrains-mono`, imported in `apps/web/src/main.tsx`, so visitors never load fonts from a third party. Tailwind reads them from `--font-display`, `--font-sans` and `--font-mono` in `index.css`; the `display` utility sets the headline face, weight and tracking together.

Headlines are two-tone: the last phrase is in the accent ("Five checks. **One grade.**"), passed as `accent` to `Headline` in `components/ui.tsx`. A small dot label (`Eyebrow`, "• How grades work") sits above each section headline.

### Type scale

| Role | Class | Use |
|---|---|---|
| Hero | `display text-5xl sm:text-6xl lg:text-[4.5rem]` | Home headline only |
| Section headline | `display text-4xl sm:text-5xl` | Each home section, page titles |
| Statement | `display text-3xl sm:text-[2.75rem]` | The centred statement under the hero |
| H3 (subsection) | `text-lg font-semibold` | Section breaks inside a page |
| H3 (subsection) | `text-sm font-medium` | Card titles |
| Body | `text-sm` | Default UI text |
| Reading | `text-base leading-7` | The methodology page |
| Small / caption | `text-xs text-muted-foreground` | Meta, timestamps |
| Mono | `font-mono tabular-nums` | Prices, USD amounts, bps, tickers |

## Gradients (not used)

The mood is calm and minimal, and flat surfaces keep attention on the grades and numbers. The only gradient is the logo tile's own soft radial light in the hero.

## Motion

Motion (`motion/react`, loaded through `LazyMotion` with `domAnimation`) with presets in `apps/web/src/lib/motion.ts`. Springs for anything that moves into place, short fades for anything that only changes.

- **Hero:** the headline rises line by line; the stats roll in like an odometer (`RollingNumber`); as the page scrolls, the mark sinks and shrinks a little, its rings turn, and the copy drifts up and fades.
- **Sections:** headlines rise word by word from behind a mask; cards and blocks rise 16 px and fade in once (`Reveal`); the statement lights up word by word as it's read (`ScrollWords`).
- **Data:** the A–E bar draws itself, the grade counts and replay lead times roll; the live grade ticker drifts under the hero and pauses under the pointer or focus.
- **Never on the board's rows or text someone is reading, and never more than this.** `MotionConfig reducedMotion="user"` and `useReducedMotion` turn every move off for viewers who ask for less motion: the page is then still and fully visible.

## Tone and voice

### Words to use

Measured, specific and number-forward. One idea per sentence; full sentences where they help. Describe conditions, not intent: "thin book", "oracle away from the market". Say what a number means for a trader ("moves the price to liquidation levels"), then show the number.

### Words to avoid

Anything that accuses or alarms: "manipulated", "scam", "rug", "attack", "danger". Hype and urgency: "revolutionary", "unlock", "act now", exclamation marks, emoji. Filler: "simply", "just", "seamless", "powerful".

### Voice example

> para:TREAD grades E. $3K rests within ±2% of mid against $428K of open interest, and the oracle was up to 124 bps from the mid price.

## Usage dos and don'ts

**Do:**

- Use the token classes (`bg-background`, `text-foreground`, `bg-primary`, `text-muted-foreground`) everywhere; never hardcode hex.
- Keep the 4 px spacing grid (`gap-2`, `p-4`, `px-6`).
- Follow the system theme by default via the `.dark` class on `<html>`, and let viewers override it.
- Use `font-mono tabular-nums` for every number that updates in place.
- Keep teal for interaction (buttons, links, focus), the accent phrase of headlines, and the grade colors for grades.
- Use `ButtonLink` for calls to action: square, with the long arrow (`ink` on paper, `cream` on bands, `arrow` for the quiet one).
- Put full-width sections in `Container` and dark or stone sections in the `band` utility, so both themes alternate correctly.
- Check every component in light and dark mode.

**Don't:**

- Hardcode colors in component files.
- Use `transition: all`; name the property (`transition-colors`).
- Use a grade color for anything that isn't a grade.
- Override tokens per component; fix them once in `index.css`.

## Using this file

- New components start from the palette, grade scale, typography and voice above.
- Keep it in step with `apps/web/src/index.css`: a token changed in one place is changed in both.

---

_Last updated: 2026-09-29. Palette: Signal Teal · Typography: Inter + JetBrains Mono · Gradients: not used._
