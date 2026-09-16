# Strength of schedule, amended

Reworks how opponent strength is measured, applied and stored. The upload
templates, printable guide and the per-league on/off switch stay as they are.

## What changes for you

- **Schedule strength becomes real points allowed**, not a guess from projections.
  For quarterbacks, runners, receivers, tight ends and kickers it is the fantasy
  points a team gives up per game to that position. Last season's actual numbers
  are the starting point (an admin upload), and this season's real results are
  mixed in as the weeks go by — this season counts fully once eight weeks have
  been played. Team defence and individual defenders keep using projected
  offensive production, since "points allowed to a defence" is not a thing.
- **The adjustment follows the stat, not the player.** Passing is adjusted by how
  the opponent handles quarterbacks, rushing by runners, receiving by receivers
  (tight ends use the tight-end number), kicking by kickers. A tight end who also
  runs the ball gets each part treated on its own.
- **Nothing inflates or deflates a season.** The adjustment is capped at 10% either
  way and the weekly shares are normalised, so a player's season total is exactly
  what you typed in — only its shape across the weeks changes.
- **You no longer choose a split when uploading.** A season total is stored as one
  season total. Each league then splits it into weeks when it reads it: evenly
  when schedule adjustment is off, schedule-shaped when it's on. Change the
  league switch and the weekly numbers change straight away, with no re-upload.
- **Platform projections are never re-shaped.** Sleeper and ESPN already publish
  a number per week, so the schedule adjustment is skipped for them.
- **The easy / even / tough marker appears once**, beside the week's opponent,
  not repeated on every player row.

## How it works

### 1. Measure: points allowed per game

`team_position_strength` gains `measure` (fantasy points allowed per game),
`games`, `prior_measure` and `prior_games`; `multiplier` stays as the derived,
cached value so existing readers keep working.

- **Seed**: an admin uploads last season's points allowed per game per team per
  position (CSV: `nfl_team, position_group, points_allowed_per_game, games`),
  written as `prior_measure` / `prior_games`, `source = 'prior'`.
- **Blend**: `refreshTeamStrength` computes this season's actual points allowed
  per game from `player_week_stats` rows with real results, then
  `measure = prior * (1 - w) + current * w` where `w = min(1, weeksPlayed / 8)`.
- **Multiplier**: `multipliersFromMeasure` over the blended measures — above the
  league mean means a soft matchup, below means hard — clamped to 0.90–1.10.
- **DST and IDP** keep today's derivation from projected offensive production.
- Hand-set rows (`source = 'user'`) are still never overwritten.

### 2. Apply per stat category

`sos.ts` gains `CATEGORY_GROUP`, mapping each scoring key to the position group
that governs it: `pass_*` and sacks-taken to QB, `rush_*` to RB, `rec_*` to WR
(TE for tight ends), `fg_*` / `xp_*` to K, everything else neutral. A new
`applyMatchup(stats, multiplierFor)` scales each stat by its own category
multiplier. `spreadSeasonTotals` uses the same per-category shares and
renormalises each stat key across the season so its total is unchanged.

### 3. Store season totals unsplit

New table `player_season_projections`
(`player_id, season, source, stats jsonb, src_points, created_at, updated_at`,
unique on `player_id, season, source`; owner-scoped RLS, GRANTs for
`authenticated` and `service_role`).

- `uploadMyProjections` writes season-total files here and drops the `spread`
  input; week-by-week files keep going to `player_week_stats` unchanged.
- `loadProjections` reads season rows for the league's source, splits them into
  the requested week using the league's schedule and, when `sos_adjust` is on
  and the source is not a weekly platform source, the category multipliers.
  Week rows still win over season rows for the same player and source.
- Clearing "my projections" clears both tables.

### 4. Weekly sources are left alone

`loadProjections` skips the adjustment entirely when the resolved source is
`sleeper` or `espn`, and `sosOn` reports false there, so the league shows
"Schedule: shown only" rather than claiming an adjustment it isn't making.

### 5. One marker, beside the opponent

`matchupRating` stays on `ProjectionSet` but is surfaced only on the matchup /
opponent line (Game Day card and the Lineup tab's week header), keyed on the
player's own primary category. No chips on player rows.

## Technical notes

- Migration: add the four columns to `team_position_strength`, create
  `player_season_projections` with GRANTs, RLS and an `updated_at` trigger.
- `SOS_MIN` / `SOS_MAX` move to 0.90 / 1.10; `ratingOf` thresholds tighten to
  ±2% so easy/tough still mean something inside the narrower band.
- Admin Data tab gains "Upload last season's points allowed" beside the existing
  "Schedule strength" recompute button.
- Tests: category mapping; season total preserved to within 0.1 after a
  schedule-shaped split; blend weight 0 games → prior only, 8+ games → current
  only; a Sleeper-sourced league gets identical numbers with the switch on and
  off.
- Verification as usual: typecheck, vitest, the player-name guard and a
  Playwright pass over the upload dialog, a league page and the admin Data tab.
