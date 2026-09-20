# Build a full manual league from screenshots

Today a hand-tracked league only really gets your own team. This adds two screenshot steps so the whole league is filled in: one standings picture to create every team with its record and waiver budget, then one roster picture per team.

## 1. Standings screenshot

In the setup flow, the "type in team names" box gains an **Upload standings** option.

- Reads a standings/league table picture and pulls out: team name, owner, wins, losses, ties, points for, points against, and remaining/spent waiver budget when the table shows it.
- The result appears as an editable table — fix a misread name or number before continuing, or add a missing row by hand.
- Saving creates every team with those records and budgets. Typing names by hand still works exactly as now.
- Re-uploading a standings picture later updates records, points and budgets for teams already there, matching on name.

## 2. Roster screenshot per team

A new **Rosters** step lists every team with an upload button and a "no roster yet" marker.

- Each upload reads that one team's players (name, position, NFL team, starting slot or bench) using the same reader the single-team screenshot already uses.
- Low-confidence rows are flagged "Check" and can be edited or deleted before saving.
- Saving replaces only that team's roster, so teams can be done one at a time across several sittings, and a team can be re-uploaded without disturbing the others.
- A progress line reads "7 of 12 rosters added". The step can be left partly done and returned to from the league page.
- The existing paste/CSV draft board stays as a faster alternative for filling every team at once.

## 3. Elsewhere

- The league page gains the same "Add roster" action per team, so rosters can be topped up after setup.
- Standings and rosters coming from screenshots count as a confirmation, so the league's freshness marker updates.
- Analysis (odds, records, waiver advice) only treats the league as complete once every team has at least one player; until then the league page shows how many rosters are still missing instead of misleading odds.

## Technical notes

- `readScreenshot` in `src/lib/fantasy.functions.ts` gains a `standings` mode returning `{teams:[{name, owner, wins, losses, ties, pointsFor, pointsAgainst, faabRemaining, faabSpent, confidence}]}`, validated with zod like the existing roster/scoring modes. Images keep going through `compressImage` in `src/lib/screenshot-upload.ts`.
- New server functions in `src/lib/manual.functions.ts`:
  - `applyStandings({leagueId, teams[]})` — upsert `teams` rows by `normalizeName(name)`; sets wins/losses/ties/points_for/points_against/faab_remaining/faab_spent; updates `leagues.team_count`; calls `touchConfirmed`.
  - `applyTeamRoster({leagueId, teamId, players[]})` — deletes and rewrites `roster_spots` for that one team only (the existing `applyDraftBoard` wipes the whole league), matching names through `playerIndex`/`normalizeName`, assigning slots from `loadSlotPlan`, queueing unmatched names, then `syncLeagueRosters` + `touchConfirmed`.
  - `manualRosterProgress({leagueId})` — per-team player counts for the progress line and the incomplete-league notice.
- `src/components/ManualLeagueWizard.tsx`: standings upload + editable grid inside the teams step; new rosters step between draft board and schedule, reusing the existing upload component and the roster review table from `ManualPanel`.
- No database changes: `teams` already stores records, points and FAAB, and `leagues.faab_budget` exists.
- Tests: standings-row parsing/normalisation, `applyTeamRoster` leaving other teams untouched, and progress counting.
