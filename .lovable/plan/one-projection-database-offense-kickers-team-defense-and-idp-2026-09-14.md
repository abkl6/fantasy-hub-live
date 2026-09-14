# One projection database: offense, kickers, team defense and IDP

## What the workbook gives us

`Weekly_Stats_Database.xlsx` has a projected stat line for every player, every week of the season:

- Offense: 641 players (QB/RB/WR/TE) x 18 weeks — attempts, completions, passing/rushing/receiving yards and touchdowns, receptions, first downs, interceptions, fumbles lost
- IDP: 1,072 defenders (DB/DL/LB) x 18 weeks — tackles, solo, assists, sacks, interceptions, fumble recoveries
- Kickers: 36 x 18 weeks — field goals made and attempted by distance band, extra points made and missed
- Team defenses: 32 x 18 weeks — sacks, safeties, interceptions, fumble recoveries, touchdowns, forced fumbles, plus points-allowed and yards-allowed probability bands
- Schedule: each team's opponent for weeks 1-18, with byes marked

Because these are stats rather than points, the app can calculate points from each league's own rules instead of accepting one fixed number.

## What changes

**The database becomes this workbook.** Every player in it — offense, kicker, team defense, IDP — is added or refreshed with team, bye week and a stat line for each week. Players currently in the app that aren't in the workbook are removed; any roster spot pointing at one keeps its name but loses the link, so nothing breaks on screen.

**Points are calculated per league, per week.** A league paying 2 per sack, 1.5 per solo tackle, 0.5 per reception, 6-point passing touchdowns or 5 for a 50+ field goal gets its own numbers everywhere: start/sit, waiver board, available players, trade evaluation, live projected finals and championship odds. Points-allowed and yards-allowed bands for team defense are scored against the league's own tiers.

**Weeks matter.** Week 7 advice uses the Week 7 stat line and bye weeks project zero on their own, instead of one flat average all season. The sum of remaining weeks drives rest-of-season value; the full-season sum drives dynasty and trade value.

**IDP lineups are supported.** Leagues can have DB, DL, LB and generic IDP starting spots. The lineup optimiser, waiver board, available list, trade math and draft tools treat defenders like any other position, and manual league setup lets you add those slots. Sleeper leagues with IDP slots import them automatically.

**Opponent shows next to the projection.** Each player's Week N opponent appears on the lineup, waiver and available screens, with BYE called out.

**Your personal adjustments keep working.** A percentage adjustment scales every week; existing adjustments carry over.

**Admin upload accepts this workbook.** The Projections page upload takes the multi-sheet file directly (off, idp, k, def, opponents), shows how many rows matched, which names didn't and what's changing, then applies.

## Technical notes

- `players`: accept `DB`, `DL`, `LB`, `DST` positions; key stays `(norm_player_name(full_name), position)`. Team defenses are one row per NFL team. `proj_points_week` / `proj_points_season` remain as PPR-baseline fallbacks, recomputed from the stat lines at import.
- New `public.player_week_stats`: `player_id`, `season`, `week`, `opponent text`, `stats jsonb`, `src_points numeric`, unique `(player_id, season, week)`; authenticated read, writes gated on `has_role(auth.uid(),'admin')`, `service_role` grants. Roughly 32k rows.
- New `public.nfl_schedule`: `season`, `week`, `nfl_team`, `opponent` (null on bye), unique `(season, week, nfl_team)`, authenticated read.
- Migration removes players absent from the import, nulling `roster_spots.player_id` and `draft_picks` links rather than cascading deletes.
- `src/lib/fantasy/scoring.ts`: extend `BASELINE_RULES`/`ALIASES` with the workbook's stat keys — offense (`pa_yd`, `pa_td`, `int`, `ru_yd`, `ru_td`, `ru_fd`, `rec`, `rec_yd`, `rec_td`, `rec_fd`, `fum_lost`), kicking (`fgm_0_29`, `fgm_30_39`, `fgm_40_49`, `fgm_50p`, `fg_miss`, `xpm`, `xp_miss`), team defense (`def_sack`, `def_saf`, `def_int`, `def_fr`, `def_td`, `def_ff` plus points-allowed and yards-allowed tiers weighted by their probability bands) and IDP (`idp_solo`, `idp_ast`, `idp_sack`, `idp_int`, `idp_fr`). Add `scoreWeek(stats, rules, position)` scoring a real stat line directly; the existing archetype multipliers stay only as the fallback for players with no stored stat line.
- `src/lib/fantasy/projections.server.ts`: `loadProjections(supabase, { season, week, scoring })` resolves personal override -> scored `player_week_stats` row -> stored fallback, and exposes `restOfSeason(playerId)` and `opponent(playerId)`. Callers in `analysis.server.ts`, `waivers.server.ts`, `rosters.server.ts`, `live.server.ts` and `fantasy.functions.ts` pass the league's `current_week` and scoring; the per-position multiplier is skipped when a real stat line was scored, so nothing is scaled twice.
- `src/lib/fantasy/engine.ts` slot eligibility gains `DB`/`DL`/`LB`/`IDP` (IDP accepts all three); manual setup and the Sleeper importer map those slots.
- `bulkUpsertBaseline` in `src/lib/projections.functions.ts` accepts this workbook's sheets, writes `players`, `player_week_stats` and `nfl_schedule`, and always reports unmatched names.
- The initial import runs as generated data statements from the uploaded file; the upload path stays available for future refreshes.
