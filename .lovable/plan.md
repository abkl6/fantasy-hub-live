# On TV mode, then the color cleanup

## 1. On TV screen (built first)

A new full-screen page at `/tv`, reachable from the menu and from a small "On TV" button on Game Day.

- A grid of every league's matchup, sized to fill the screen: league initials in the league color, both team names, both scores at display size, and the win-chance bar between them.
- Live matchups pulse and lift; finals fade back; pre-game stays flat. Scores count up and flash on change, same as Game Day.
- A live scoring ticker runs along the bottom as a single scrolling line, newest first, opponent scoring in red.
- The screen asks to stay awake and goes full-screen as soon as the page opens; if the browser refuses, a "Full screen" and a "Keep awake" button appear so it can be done by tap. Leaving the page releases both.
- No bottom tab bar, no header, no readiness bar — nothing but scores and the ticker. Press Escape or tap once to reveal an exit button.
- Refreshes on the same live interval Game Day already uses.

## 2. Lime means live only

- League palette becomes: sky, amber, violet, rose, teal, orange. Lime is removed.
- Any league currently set to lime is moved to orange.
- `--primary` stays lime and is used only for live indicators, positive movement, and primary buttons.

## 3. One green

`--success` is set to the same value as `--primary`, so positive movement and the live accent are the identical green everywhere.

## 4. Neutral dark background

Page background moves from blue-tinted navy to a neutral near-black (`oklch(0.13 0 0)`), cards to `oklch(0.18 0 0)`, with the row/muted steps re-derived neutrally. Borders and muted text get matching neutral values so nothing reads blue. This makes the league colors and the lime live accent pop, and suits the TV screen on OLED.

## Technical notes

- Migration: `UPDATE public.leagues SET color = 'orange' WHERE color = 'lime';` — no schema change.
- `src/lib/league-colors.ts`: drop `lime` from `LEAGUE_COLOR_KEYS`/`SWATCHES`/`LEAGUE_COLOR_LABELS`, add `orange: oklch(0.75 0.17 55)`. The hash fallback and the league-page swatch picker pick this up automatically.
- New route `src/routes/_authenticated/tv.tsx` with its own `head()` metadata; it renders a `TvBoard` component and does not use the authenticated layout chrome (chrome hidden via a flag on the layout when the `/tv` route is active).
- `src/components/TvBoard.tsx`: reuses the existing live query from `GameDayBoard` (extract the query hook, `useCountUp`, and the ticker row into shared pieces rather than duplicating them), grid is `grid-cols-2` / `grid-cols-3` by matchup count, ticker is a fixed bottom bar.
- Wake lock: `navigator.wakeLock.request("screen")` in an effect, re-requested on `visibilitychange`, released on unmount; feature-detected with the manual toggle as fallback. Full screen: `document.documentElement.requestFullscreen()` attempted on mount, with a button when the promise rejects.
- `src/styles.css`: `--background`, `--card`, `--popover`, `--muted`, `--secondary`, `--border`, `--input` re-based on neutral chroma 0; `--success` set to `var(--primary)`'s value.
