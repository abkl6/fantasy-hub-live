# Game Day visual overhaul

A full redesign pass so Game Day reads like a scoreboard: scores dominate, live state comes through color and motion, and six leagues stay scannable.

## 1. Score-first matchup card

- Your score and their score at 5xl, tabular numerals, side by side, with the win-probability bar running between them.
- Team names at 12px above each score; projected finals at 11px below in muted text.
- Everything else (roster breakdown, odds detail, yet-to-play counts) collapses behind a single tap.

## 2. Live state through color and motion

- Live matchups: slow-pulsing dot plus a slightly lifted background.
- Finals: dimmed to 70% opacity. Pre-game: flat, no treatment.
- Score changes count up over 600ms and flash the row once.
- New ticker updates slide in from the top.
- Badges like "Live / Final / Upcoming" come off the card.

## 3. A color per league

- Each league gets its own color, auto-assigned from a six-step palette on import and changeable by you from a small swatch picker on the league page.
- The color shows as a 3px left stripe on the matchup card and as the tile color in the scoreboard strip.
- The choice is saved to your account, so it is the same on every device.

## 4. Pinned scoreboard strip

- Compact tiles across the top of Game Day: league initials, `112.4 – 98.7`, and win chance as a thin bar.
- Sticks below the header while you scroll; tapping a tile jumps to that league's card.
- Scrolls sideways when there are more tiles than fit.

## 5. Sentence case everywhere

- Headings, labels and badges move to sentence case across the signed-in pages; the all-caps `eyebrow` style is retired.
- Barlow Condensed stays, but only for numerals and scores.
- Body and heading text switches to Inter Tight for a bit more character than Archivo.

## 6. Flatter surfaces

- Nested sections lose their borders; three background steps (page, card, row) carry the hierarchy, with 1px dividers only inside lists.
- Card radius goes to 12px.
- The lime accent is reserved for exactly two things: live indicators and positive movement. Red is only for opponent scoring.

## 7. Single-line sparklines

- The stacked two-pixel bar strips are replaced with one thin line sparkline per series, so trends read as a shape instead of a barcode.

## Technical notes

- Migration: add `leagues.color text` (nullable). Backfill existing rows round-robin from the palette; assign on import in the platform sync paths. Update mutation via a server function scoped to the owning user; RLS on `leagues` already scopes to `auth.uid()`.
- `live-types.ts`: add `color: string | null` to `LiveMatchup`; `live.server.ts` selects and passes it through.
- `src/styles.css`: retire `text-transform: uppercase` from `@utility eyebrow`, bump `--radius` to `0.75rem`, add `--font-sans: "Inter Tight"` and update the Google Fonts `<link>` in `src/routes/__root.tsx`, add keyframes for pulse-dot, row-flash and ticker slide-in (tw-animate-css covers the rest).
- `GameDayBoard.tsx`: new `ScoreboardStrip` (sticky, `top-[var(--header-h)]`), rewritten `MatchupCard` with a `useCountUp` hook (600ms rAF tween, prefers-reduced-motion respected) and a `useFlashOnChange` class toggle; `hasLineupAlert` and the readiness bar stay as-is.
- Sparkline: small inline SVG `<polyline>` component in `src/components/Sparkline.tsx`, used wherever the bar strips currently render (Manager Hub odds/trend strips).
- Uppercase cleanup covers `src/routes/_authenticated/*` and `src/components/*`, replacing `uppercase` classes and `eyebrow` usages; the landing page keeps its display headline.
