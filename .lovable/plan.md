# Projections: defence, IDP, kickers, and strength of schedule

## Where things stand today

- The weekly NFL schedule is loaded in full (all 32 teams, 18 weeks, 2026), so the app always knows who each player faces in each week. It already stamps the opponent onto every uploaded projection row.
- Nothing anywhere adjusts a projection for how tough that opponent is. There is an admin table for defence rankings, but it is empty and no calculation reads it. So: the raw schedule information is there, the strength part is not.
- Uploads only accept offensive stat columns. The three attached files would all be rejected today — their headers (TCK, SOLO, SCK, SAF, PA 0, FG 40-49, and so on) are not recognised, and the kicker/defence/IDP columns never reach scoring.

## What will be built

### 1. Accept the three new file layouts

A column dictionary per position group, so each attached file imports as-is:

- **Defence (DST):** sacks, safeties, interceptions, fumble recoveries, touchdowns, forced fumbles, the points-allowed bands (0, 1-6, 7-13, 14-20, 21-27, 28-34, 35+) and the yards-allowed bands.
- **IDP (DL, LB, DB):** tackles, solo, assists, sacks, interceptions, fumble recoveries (plus forced fumbles and defensive touchdowns if present).
- **Kickers:** field goals attempted/made, extra points attempted/made, and the distance bands 0-29, 30-39, 40-49, 50+.

Team defences are matched by team name rather than person name, and the mismatch between "DST" and "DEF" naming is resolved so team-defence scoring rules apply correctly. Anything still unmatched goes to the existing unmatched-names review queue.

### 2. Season totals in, weekly breakdown out

Each template is one row per player for the whole season. On upload the app spreads those totals across the weeks that player's team actually plays, skipping the bye, and stamps the opponent on each week. Two options at upload time:

- **Even split** — the same numbers every playing week.
- **Adjusted for schedule strength** — each week scaled by how tough that week's opponent is, with the season total preserved exactly.

The user can re-run the split later without re-uploading, switching between the two.

### 3. Strength of schedule

- A new store of opponent strength per team, per position group, per season — how generous each defence is to QB / RB / WR / TE / K, and how generous each offence is to opposing defences.
- Filled from the season's own projection data (each team's projected production against the league average) and editable by an admin. Unknown teams sit at neutral, changing nothing.
- Shown by default everywhere a matchup appears: a small easy/neutral/tough marker next to the weekly opponent, plus a season-long schedule rating on the players list.
- A single switch — per league, in League rules — turns the adjustment on. Off means display only and no number moves; on means weekly projections, lineup advice, waiver scores, odds and "what you need" all use the adjusted numbers, with the active setting labelled beside the totals.

### 4. Making uploads go smoothly every time

- **Pre-filled downloads**, one per group (offence, defence, IDP, kickers): every current player with name, position, team and bye already filled, one row each, blank stat columns. Fill in the numbers, upload, done — no name typing means almost no failed matches.
- A **preview step before saving**: how many rows matched, what will be written, and any names that did not match, with a search-and-pick fix for each.
- **Validation with plain messages**: wrong file for the tab, missing columns, text where a number belongs, totals that look implausible.
- A short **printable reference page** (one page, prints cleanly) listing every column in every template and what it means, linked next to the download buttons.
- Uploads stay private to the person who uploaded them and are only used by leagues set to "My projections"; each group can be re-uploaded or cleared on its own.

## Technical notes

- New table `team_position_strength` (season, nfl_team, position group, multiplier, source, timestamps) with RLS: readable by authenticated users, writable by admins/service role only.
- New league column `sos_adjust boolean default false`, editable in League rules, never overwritten by sync.
- `uploadMyProjections` in `src/lib/projections.functions.ts` gains a `group` parameter ('offense' | 'dst' | 'idp' | 'k'), a per-group header alias map, and a `spread: 'even' | 'sos'` option; the existing weekly-row path is unchanged.
- The schedule multiplier is applied when splitting season totals into `player_week_stats`, normalised so the season sum is unchanged; `loadProjections` is untouched so every downstream calculation picks it up automatically.
- Scoring keys map onto the existing `BASELINE_RULES` entries (`def_*`, `pa_*`, `idp_*`, `fg_*`, `xp_*`); a few new keys are added for yards-allowed bands and total tackles.
- Tests: one fixture per attached file asserting the parsed stat line and points; a test that an SOS-adjusted split sums to the same season total as the even split; the player-name guard and typecheck as usual.
