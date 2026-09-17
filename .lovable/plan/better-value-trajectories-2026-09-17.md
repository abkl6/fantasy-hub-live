# Better value trajectories

Today a player's Rising / Peak / Declining / Cliff label comes from one thing: a curve fitted to the *current* market table by age, with a flat ±15% band and a fixed sentence. This rebuilds it on real history, real production, and the player's actual situation.

## What changes for you

- **Curves learn from history.** Every week the whole market table is saved. Once there are enough same-player year-over-year comparisons, curves are fitted from how players actually moved, not from a snapshot of who happens to be young today. Until that history builds, the current cross-section fit is used, then the hand-set fallback.
- **Production counts, not just price.** You can upload past-season fantasy totals by player and age; the app fits a production-by-age shape per position and blends it half-and-half with the market shape when deciding how fast someone falls. Sell-price estimates still use the market alone.
- **Better-shaped curves.** Curves bend at the age each position actually bends (RB 27, WR 29, TE 30, QB 33). Running quarterbacks are curved separately from pocket ones (split at 15% of fantasy points from rushing).
- **Risers get the same treatment as fallers.** A top-12 producer or a first-round pick climbs 1.3× faster than the plain curve; a no-production day-3 pick climbs at half speed.
- **Situation nudges.** For players under 26: whether their target or carry share is trending up over the last four weeks, their draft capital, and whether they're in a contract year. For everyone: games missed over the last two seasons. Each shifts the one-year outlook by a capped amount.
- **Honest uncertainty.** The band becomes the real spread of year-over-year moves at that position and age. When the band crosses a label boundary, the chip reads "Declining (uncertain)" instead of pretending to be sure.
- **Sell windows that know the calendar.** Producers get in-season timing, rookies and picks "before the rookie draft", veterans "after the draft".
- **Scoreboard.** Every weekly classification is logged; after a season of history the admin Overview shows how often each class was right, by position.

## Data sources (confirmed)

- Draft capital comes automatically from the Sleeper players feed (round and pick), stored on `players`. No contract data is in Sleeper, so contract year comes from the same admin upload as production history — the feature stays off for players without a row.
- Production-by-age upload is season totals: name, position, season, age, fantasy points (optional contract-end year column).

## Technical detail

Migration:
- `trade_value_history` — snapshot_date, norm_name, position, format, value, overall_rank, position_rank, age. Unique (snapshot_date, norm_name, position, format). Read by authenticated, written by service role.
- `player_production_seasons` — norm_name, player_id, position, season, age, fantasy_points, contract_end_year, uploaded_by. Unique (norm_name, season).
- `players` gains `draft_round`, `draft_pick`, `draft_year` (Sleeper), `games_missed_2y`.
- `age_curves` gains `kind` ('market' | 'production' | 'blended'), `variant` (e.g. QB 'rush' | 'pocket'), `dispersion` jsonb (per-age SD of year-over-year change), and the unique key becomes (position, format, kind, variant).
- `trajectory_log` — week, season, norm_name, position, classification, change1, value, logged_at; plus a graded column filled a year later.

`age-curve.ts` (pure, tested):
- `fitSpline(points, knot)` — monotone piecewise fit with a position-specific knot; `POSITION_KNOT = { RB: 27, WR: 29, TE: 30, QB: 33 }`.
- `fitFromPairs(pairs)` — year-over-year ratios per age bucket, cumulated into a curve; requires ≥40 pairs per position, else `fitCurve` cross-section, else `handCurve`.
- `blendCurves(market, production, 0.5)` used for decline rate only; `trajectoryFor` keeps the market curve for value estimates.
- `TIER_SLOPE` extended to rises: elite/first-round 1.3, starter 1.0, no-production day-3 0.5.
- `situationShift(features)` returns a bounded delta (each feature capped, total capped at ±0.08) from role trend, draft capital, contract year (under-26 only) and games missed.
- `dispersionBand(position, age, dispersion)` replaces the flat `BAND`; `classifyTrajectory` gains an `uncertain` flag when the band spans a threshold, surfaced as "Declining (uncertain)".
- `sellSentence(cls, position, age, isRookieOrPick, date)` — calendar-aware phrasing.

Server:
- `ktc.server.ts` writes a `trade_value_history` row on each weekly refresh (after upsert, same transaction path).
- `age-curve.server.ts` `refitAgeCurves` gains pair-based fitting, production curves, QB rush split, dispersion computation, and stores each curve kind.
- New `src/lib/fantasy/situation.server.ts` — role trend from `player_week_stats` (last 4 weeks vs season target/carry share), games missed from prior two seasons, draft capital from `players`.
- `sleeper.server.ts` player sync maps `metadata.draft_round`/`draft_pick` onto the new columns.
- `admin.functions.ts`: `uploadProductionSeasons` (CSV, admin-only, name-matched via `norm_player_name`, unmatched reported) and `trajectoryHitRates` for the Overview.
- Weekly cron logs classifications into `trajectory_log`.

UI:
- `TrajectoryChip` shows the uncertain variant; the dialog band comes from real dispersion and names the curve source ("fitted from 612 year-over-year moves").
- Admin Overview: production upload control plus a hit-rate table by class and position (hidden until a season of history exists).

Verification: `bunx vitest run` with new tests for spline knots, pair-based fitting and the 40-pair threshold, rise tiering, situation caps, dispersion bands and the uncertain label, calendar sentences; `bunx tsgo --noEmit`; browser check of a trajectory chip and the admin Overview.
