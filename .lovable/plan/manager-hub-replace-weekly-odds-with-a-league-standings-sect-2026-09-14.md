# Manager Hub: replace Weekly odds with a League Standings section

## What changes

The "Weekly odds" section at the bottom of the Manager Hub becomes **League standings** — one compact card per league showing the full standings table, not just your odds history.

Each league card shows:
- Every team in rank order: rank, team name, quality badge (Top Seed, Contender, Dynasty King, etc. with its hover explanation), record, title chance, and playoff chance.
- **Your row highlighted** with a subtle primary tint and a "You" marker so it reads instantly.
- Dynasty leagues only: a **Dynasty value** column (KTC market value of roster + picks) with league rank, e.g. "8,430 · 3rd".
- A small "since week N" swing badge on your row when snapshot history exists, so the week-to-week movement isn't lost.
- Clicking the card header goes to that league's page.

## Extra UX improvements (included)

- **Cross-league sort toggle** at the top of the section: order league cards by title chance (default), playoff chance, or dynasty value.
- **Cross-league summary strip**: your best title chance, total dynasty value across leagues, and how many leagues you're projected to make the playoffs in — one glance for "how am I doing overall".
- Teams within ~5% playoff odds of the cutoff get a small "Bubble" note so the stakes of the week are visible.

## Technical details

- `src/lib/fantasy/manager.server.ts`: replace `weeklyOdds` with a `standings` payload per league — reuse `analysis.standings` (already has record, titleOdds, playoffOdds, badge) and compute per-team dynasty totals via the existing `leagueDynastyValues` (dynasty leagues only, format from `leagueValueFormat`). Keep each team's snapshot series' first/last points only for the swing badge (single query, already per-league).
- `src/lib/fantasy/analysis.server.ts`: expose `dynastyRank`/`dynastyValue` on standings rows (already computed internally as `dynastyRankById`; add totals) instead of recomputing in manager.server — one source of truth.
- `src/routes/_authenticated/manager-hub.tsx`: replace the `OddsRow` section with a `StandingsCard` per league (table layout, your-row highlight, BadgeChip reuse from team-class UI), plus the sort toggle (local state) and summary strip. Remove the old weeklyOdds type/usage everywhere.
- Typecheck + vitest, then verify live in the browser with both leagues.
