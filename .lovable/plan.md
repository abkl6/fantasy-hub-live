# One projection database: offense, kickers, team defense and IDP

## What the workbook gives us

- Offense: 641 players (QB/RB/WR/TE), team, bye, week-by-week numbers, season total
- Kickers: 36, with field goals, attempts, extra points and 50+ makes
- Team defenses: 32, with sacks, interceptions, fumble recoveries, touchdowns, forced fumbles
- IDP: 1,072 defensive players (DB/DL/LB), with tackles, solo, assists, sacks, interceptions, fumble recoveries
- A schedule sheet giving every team's opponent for weeks 1-18

You noted the file should carry **stats per week**, not points per week, and will upload that version. The plan below is built for weekly stat lines: points are then calculated from each league's own rules rather than taken as fixed numbers. If the revised file still has a week where only points are available, that week falls back to the given points.

## What changes

**The database becomes this workbook.** Every player in the sheet — offense, kicker, team defense, IDP — is added or refreshed with team, bye week and a stat line for each of weeks 1-18. Players in the app that aren't in the workbook are removed, and any roster spot pointing at them keeps its name but loses the link, so nothing breaks on screen.

**Points are calculated per league, per week.** A league paying 2 per sack, 1.5 per solo tackle, 0.5 per reception or 5 for a 50+ field goal gets its own numbers everywhere: start/sit, waiver board, available players, trade evaluation, live projected finals and championship odds. Today only offense is rescaled, using a rough per-position factor; after this the real stat line does the work for every position.

**Weeks matter.** Week 7 advice uses the Week 7 stat line and bye weeks project zero on their own, instead of one flat average all season. Season totals still drive long-term value (dynasty, trade value, keep ratings).

**IDP lineups are supported.** Leagues can have DB, DL, LB and generic IDP starting spots. The lineup optimiser, waiver board, available list, trade math and draft tools all treat defensive players like any other position, and manual league setup lets you add those slots. Sleeper leagues with IDP slots import them automatically.

**Opponent shows next to the projection.** The schedule sheet fills in each player's Week N opponent on the lineup and waiver screens.

**Your personal adjustments keep working.** A percentage adjustment scales all 18 weeks; existing adjustments carry over.

**Admin upload accepts this workbook.** The Projections page upload takes the multi-sheet file directly (offense, K, DEF, IDP, schedule) and still shows matched rows, unmatched names and what's changing before anything is applied.

## Technical notes

- `players`: add `DB`, `DL`, `LB`, `DST` to the accepted positions; keep `(norm_player_name(full_name), position)` as the key. Team defenses are stored one row per NFL team.
- New `public.player_week_stats`: `player_id`, `season`, `week`, `stats jsonb`, `proj_points numeric` (fallback when only points are available), unique on `(player_id, season, week)`, readable by authenticated users, writes gated on `has_role(auth.uid(),'admin')`, `service_role` grants.
- New `public.nfl_schedule`: `season`, `week`, `nfl_team`, `opponent` (null on bye), unique on `(season, week, nfl_team)`, authenticated read.
- Migration removes players absent from the import and nulls `roster_spots.player_id` / `draft_picks` links rather than cascading deletes.
- `src/lib/fantasy/scoring.ts`: extend `BASELINE_RULES` and `ALIASES` with kicking (`fgm`, `fgm_50p`, `xpm`, `fga_miss`), team defense (`def_sack`, `def_int`, `def_fr`, `def_td`, `def_ff`, points-allowed tiers) and IDP (`idp_tkl_solo`, `idp_tkl_ast`, `idp_sack`, `idp_int`, `idp_fr`, `idp_ff`, `idp_td`) keys; add `scoreWeek(stats, rules, position)` that scores a real stat line directly. Per-position archetype multipliers stay only as the fallback for players with no stored stat line.
- `src/lib/fantasy/projections.server.ts`: `loadProjections(supabase, { season, week, scoring })` resolves, in order, personal override -> scored `player_week_stats` row -> stored season/average fallback. Callers in `analysis.server.ts`, `waivers.server.ts`, `rosters.server.ts`, `live.server.ts` and `fantasy.functions.ts` pass the league's `current_week` and scoring; no double-scaling once a real stat line is used.
- `src/lib/fantasy/engine.ts` slot handling gains `DB`/`DL`/`LB`/`IDP` eligibility (IDP accepts all three); manual league setup and the Sleeper importer map those slots.
- `bulkUpsertBaseline` in `src/lib/projections.functions.ts` accepts the workbook's sheets, writes `players`, `player_week_stats` and `nfl_schedule`, and reports unmatched names instead of dropping them.
- Import runs once from the uploaded workbook as generated data statements; the same path stays available for future uploads.
