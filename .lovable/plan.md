# Speed-up plan: stop re-reading the whole season on every page

## What I found (checked just now)

- **Biggest cost by far:** the full season of weekly player numbers is re-downloaded in 1,000-row pages again and again. That one read has run **1.1 million times** for about **5.9 hours** of total database time, with single runs taking up to 3 seconds. It is used by projections, rest-of-season blending, strength-of-schedule, calibration, weekly jobs and recaps (8 separate places, 19 queries on that table).
- **The full player list (`players`, every column)** is re-downloaded the same way by league analysis, waivers and the waiver hub: 92,000 runs, about 22 minutes.
- **Injury/news lookups** average 88 ms each (20,000 runs) — no matching lookup path.
- **One week's numbers** for all players: 354,000 runs, about 1.3 hours.
- **Database health:** disk only 20% full, but the disk read budget dropped below 50% two days ago, memory is at 57%, and 239,000 failed/rolled-back transactions since restart — a sign something keeps failing and retrying (likely background jobs).
- The league page is one ~3,000-line screen and the analysis builder ~2,000 lines, so every league visit downloads and computes a lot at once.

## Fixes, in priority order

1. **Pre-totalled season numbers (biggest win).** Keep one small summary table — one row per player per season per source (games played, points, per-game rate, per-stat totals) — updated whenever weekly numbers load. All 8 readers use it instead of downloading every week row. Expected: the 5.9-hour query largely disappears.
2. **Load shared data once, keep it in memory briefly.** Players list, season summary, schedule and injuries loaded once per server request (and held ~5 minutes), only the columns actually used, shared across all leagues in that request instead of each feature fetching its own copy.
3. **Missing lookup paths.** Add one for injury/news by player + date, and confirm the weekly-numbers lookups match the exact filters used (season + week + source).
4. **Find the failing retries.** Trace the 239k rolled-back transactions to the job/feature causing them (likely background calculations or cache writes clashing) and fix the cause rather than retrying.
5. **Background work only when needed.** The calculator only re-runs a league when its inputs actually changed (new roster, scores or injuries), not on a timer.
6. **Lighter league page.** Split the league page so each tab loads its own code and data only when opened; Lineup tab first.
7. **Measure before/after.** Record page load times for Home, a league page, Waivers and This Week before the changes and after, and report them.
8. **Optional:** move the database from Tiny to Small only if, after 1–6, it still slows on Sundays.

## Other bugs worth fixing on the way
- Guillotine '26 still holds two copies of "Oh Hungry? Oh Henry" — needs your OK to merge.
- App's built-in projections are empty (0 for all players); anyone without an upload sees zeros. Suggest auto-filling them from a free source.

## Technical details
- New table `player_season_totals(player_id, season, source, games, points, per_game, stats jsonb)`, PK (player_id, season, source), refreshed by trigger or at the end of each stats load; RLS read for authenticated.
- Replace `fetchAllRows(... player_week_stats ... season=)` in analysis.server.ts, projections.functions.ts, sos.server.ts, calibration.server.ts, platform-projections.server.ts, week-review.server.ts, weekly-jobs.server.ts.
- Module-level TTL memo for `players` (narrow select) in a shared `shared-data.server.ts`; used by analysis, waivers, waiver-hub, bestball.
- Index `player_news(player_id, published_at desc)`; verify with EXPLAIN.
- Input-hash check in jobs.server.ts before enqueuing; inspect postgres logs for the rollback source.
- Tests: season-total equals sum of weeks; analysis output unchanged for a fixed league before/after.
