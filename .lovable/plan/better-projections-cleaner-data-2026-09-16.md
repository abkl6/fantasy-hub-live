# Better projections, cleaner data

Six upgrades to how player numbers are produced, checked and matched.

## 1. Rest-of-season blend

For each player, build a per-game rate from this season's actual results and mix it with the preseason per-game projection. Weight on actuals is `g / (g + 6)` where `g` is games actually played (inactive games skipped), applied to every stat category. The blended per-game rates are then spread across the remaining weeks by schedule exactly as today.

- Store blended rates plus `blend_weight` so screens can say "based on 4 games + preseason".
- Recomputed after each week's results load.
- Test: at 6 games the blend is 50/50.

## 2. Weekly score reconciliation

After each week's results load, recompute every team's score in every league from stored player stats and that league's scoring rules, then compare with the score the platform reported.

- Differences written to a new `score_reconciliation` record per league/team/week.
- Any league where a team differs by more than 0.5 gets a banner on its page: "Scoring rules may be incomplete — 2.4 pt gap in Week 3".
- A matching row appears in the admin Overview, and the largest single-player discrepancy is shown so the missing rule is easy to spot.

## 3. Single injury feed

Sleeper's player feed becomes the injury and status source for every league, whatever platform it came from.

- Polled every 10 minutes, tightening to every 2 minutes from 3 hours before each kickoff window.
- Matched on our canonical player ID.
- A platform's own status is only used when Sleeper has no entry for that player.

## 4. Vegas implied totals

New `team_implied_totals` (season, week, NFL team, implied points), filled from a public odds source on a daily schedule and an admin button.

- Each team's weekly player projections are scaled by `implied / that team's season-average implied`, clamped to 0.85–1.15.
- Applied after the schedule split, and only for weeks that actually have a line.
- The multiplier appears as a tooltip on the weekly opponent marker, and the table is editable in admin Data.

## 5. Historical volatility

Compute each player's week-to-week scoring standard deviation from last season's results plus this season's games, expressed as a fraction of their mean.

- Minimum 6 games, otherwise the position default stands.
- Stored as `volatility` on the player and used by the season simulation in place of the position default.

## 6. Canonical IDs

Add `sleeper_id` (exists), `espn_id`, `yahoo_id`, `ktc_slug` to players.

- Populated from each import and the market-value refresh.
- Every import matches by ID first and falls back to name; a successful name match writes the platform ID back so it never has to match by name again.
- The admin Players tab shows ID coverage per platform.

## Technical notes

- Blend lives in a new `src/lib/fantasy/blend.ts` (pure, tested) consumed by `projections.server.ts` before `spreadSeasonTotals`; implied-total scaling applies after the split, alongside the existing SOS multiplier path.
- Migrations: `score_reconciliation`, `team_implied_totals`, player columns `espn_id`, `yahoo_id`, `ktc_slug`, plus blended-rate storage with `blend_weight` (GRANTs + RLS per table).
- Reconciliation and volatility recompute run in the weekly results job (`week-review.server.ts` path); injury polling replaces the per-platform status writes in `sleeper.server.ts` with a cron pair (10 min / 2 min pre-kickoff) reusing the existing kickoff-window helper.
- Odds pull runs through a server function with an admin trigger plus a daily schedule.
- Tests: blend weighting at 6 games, reconciliation gap detection, volatility fallback under 6 games, ID-first matching writing IDs back.
