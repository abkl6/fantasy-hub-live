# Use the uploaded spreadsheet as the offensive player database

## What the file contains

641 offensive players (99 QB, 160 RB, 238 WR, 144 TE) with NFL team, bye week, a projection for each of weeks 1-18, a season total and an average per game. A second sheet lists each team's opponent by week. Numbers are full PPR, which matches how the app already stores its shared baseline.

## What changes

**The player list becomes this file.** Every offensive player in the sheet is added or updated with its team, bye week, season total and per-week numbers. Offensive players currently in the app that aren't in the file are removed; kickers and defenses are untouched. Any roster or draft entry pointing at a removed player keeps its name and position but is no longer linked to a player record, so nothing breaks visually.

**Week-by-week projections start being used.** Today every week uses one flat number. After this, Week 7 advice uses the Week 7 projection and bye weeks project zero automatically — so start/sit, the waiver board, available players, trade evaluation, live projected finals and championship odds all shift with the schedule. The season total drives long-term value (dynasty, trade value, keep ratings) as it does now.

**Opponent for the week shows up.** The schedule sheet gives each player's Week N opponent, shown next to their projection on the lineup and waiver screens.

**Your personal adjustments still work.** A percentage adjustment now scales all 18 weeks; the slider and exact-number entry behave the same. Existing adjustments carry over unchanged.

**Admin spreadsheet upload gets the same shape.** The Projections page upload accepts this exact layout (Player, Pos, NFL, Bye, Wk1..Wk18, Season Total), with the same preview of matched rows, unmatched names and changes before applying. The older simple format keeps working.

## Technical notes

- New table `public.player_week_projections`: `player_id`, `season`, `week`, `proj_points`, unique on `(player_id, season, week)`, readable by authenticated users, writes gated on `has_role(auth.uid(),'admin')`, plus `service_role` grants.
- New table `public.nfl_schedule`: `season`, `week`, `nfl_team`, `opponent` (null on bye), unique on `(season, week, nfl_team)`, readable by authenticated users.
- Migration also drops offensive players (`position in ('QB','RB','WR','TE')`) absent from the import; `roster_spots.player_id` / `draft_picks` links are set null rather than cascading row deletes, preserving stored names.
- Import is done as data statements generated from the workbook: upsert into `players` (season total into `proj_points_season`, `Avg/Game` into `proj_points_week` as the fallback), then the 641x18 week rows and 32x18 schedule rows.
- `src/lib/fantasy/projections.server.ts` gains a week-aware layer: `loadProjections(supabase, { season, week })` returns `week(playerId, name, base)` resolved as personal override -> `player_week_projections` -> `players.proj_points_week`. Percentage overrides scale the weekly row. Callers in `analysis.server.ts`, `waivers.server.ts`, `rosters.server.ts`, `live.server.ts` and `fantasy.functions.ts` pass the league's `current_week`; league scoring scaling stays applied on top, unchanged.
- Opponent lookup added to the same helper and surfaced through existing payload types.
- `bulkUpsertBaseline` in `src/lib/projections.functions.ts` gains header detection for `Pos`/`NFL`/`Bye`/`Wk1..Wk18`/`Season Total` and writes weekly rows alongside the baseline; unmatched names are still reported, never dropped.
