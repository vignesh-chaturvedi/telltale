# Brand — Telltale

Live safety ratings (A–E) for every market on Hyperliquid, with alerts.

_Set on 2026-09-29. Change the tokens in `apps/web/src/index.css` and this file together._

## Palette — Signal Teal

**Vibe:** calm · technical · fresh. Live data you can trust; cool but not cold.
**Category:** infra/data
**Mood:** calm · minimal
**Reference:** L2BEAT (a risk-rating site for rollups)

### Seeds

| Role | Dark OKLCH | Dark hex | Light OKLCH | Light hex |
|---|---|---|---|---|
| bg-base | `oklch(0.13 0.015 200)` | `#020909` | `oklch(0.982 0.01 200)` | `#F2FBFC` |
| bg-elevated | `oklch(0.18 0.02 200)` | `#061415` | `oklch(1 0 0)` | `#FFFFFF` |
| primary | `oklch(0.74 0.14 195)` | `#00C5C6` | `oklch(0.5 0.14 195)` | `#007A7C` |
| primary-soft | `oklch(0.85 0.1 195)` | `#76E2E2` | `oklch(0.65 0.1 195)` | `#2CA2A2` |
| fg-base | `oklch(0.96 0.01 200)` | `#EBF4F4` | `oklch(0.18 0.015 200)` | `#091414` |

### Tokens (applied to `apps/web/src/index.css`)

The full shadcn-style token set lives in `:root` (light) and `.dark` (dark) in `apps/web/src/index.css`, and is mapped into Tailwind colors with `@theme inline` (`bg-background`, `text-foreground`, `bg-primary`, …). This is a Vite app, so there was no earlier `globals.css` to back up: the file was created with this palette.

**Light mode (`:root`):**

```css
--background: oklch(0.982 0.01 200);
--foreground: oklch(0.18 0.015 200);
--primary: oklch(0.5 0.14 195);
--primary-foreground: oklch(0.98 0 0);
--muted-foreground: oklch(0.45 0.015 200);
--border: oklch(0.902 0.01 200);
```

**Dark mode (`.dark`):**

```css
--background: oklch(0.13 0.015 200);
--foreground: oklch(0.96 0.01 200);
--primary: oklch(0.74 0.14 195);
--primary-foreground: oklch(0.1 0 0);
--muted-foreground: oklch(0.66 0.01 200);
--border: oklch(0.26 0.02 200);
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
- Social headers keep text out of the bottom-left quarter, where X places the profile photo.

## Typography — Inter + JetBrains Mono

- **Display and body:** Inter (variable)
- **Mono (numbers, tickers, addresses):** JetBrains Mono (variable)

Self-hosted with `@fontsource-variable/inter` and `@fontsource-variable/jetbrains-mono`, imported in `apps/web/src/main.tsx`, so visitors never load fonts from a third party. Tailwind reads them from `--font-sans` and `--font-mono` in `index.css`.

### Type scale

| Role | Class | Use |
|---|---|---|
| Display | `text-4xl font-semibold tracking-tight` | Home headline only |
| H1 (page) | `text-2xl font-semibold tracking-tight` | Page title |
| H2 (section) | `text-lg font-semibold` | Section breaks |
| H3 (subsection) | `text-sm font-medium` | Card titles |
| Body | `text-sm` | Default UI text |
| Reading | `text-base leading-7` | The methodology page |
| Small / caption | `text-xs text-muted-foreground` | Meta, timestamps |
| Mono | `font-mono tabular-nums` | Prices, USD amounts, bps, tickers |

## Gradients (not used)

The mood is calm and minimal, and flat surfaces keep attention on the grades and numbers. None were generated.

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
- Keep teal for interaction (buttons, links, focus) and the grade colors for grades.
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
