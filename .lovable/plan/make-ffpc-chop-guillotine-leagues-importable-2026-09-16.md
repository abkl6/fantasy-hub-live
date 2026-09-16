# Make FFPC chop (guillotine) leagues importable

## What's wrong

I fetched your league page ($35 Chop Classic - 6hr Slow #113758, 18 teams) and ran it through the FFPC reader. Everything reads fine — league name, season, week 2, your team, your 14-player roster, the $1,000 FAAB — except the standings, which come back empty. The import then stops with "standings could not be read from the page", which is the error you're seeing.

Two reasons for the empty standings:

1. The reader picks the wrong block on the page. It looks for a table whose heading contains "team" and "points" and lands on the league info panel (which happens to contain that wording) instead of the real standings table, which has no rows.
2. A chop league's standings look different from every other FFPC league: there is no win-loss record, the columns are Team / Avg points per week / Remaining FAAB / Close calls / Week wins, team names carry trailing junk ("The Firing Squad . -->"), and eliminated teams live in a second table called "Chopped teams" (currently one team, chopped in week 1).

## The fix

1. When choosing the standings block, skip candidates with no rows and require team links, so the info panel can never be mistaken for standings.
2. Read the chop standings layout: strip the trailing " . -->" from names, take points per week, remaining FAAB and week wins from their own columns, and pull each team's ID from its roster link.
3. Read the "Chopped teams" table too, so all 18 teams come in, with the week each one was chopped recorded. Chopped teams are shown as out and left out of survival odds, waiver advice and the standings ranking.
4. Set the league up correctly on import: guillotine variant (from "Chop Classic League"), total-points scoring with the week-6 all-play rule the page already states, no playoff bracket, $1,000 FAAB budget with each team's remaining balance.
5. Chop leagues have no weekly opponent, so the schedule and head-to-head pieces stay empty rather than erroring — the same way best-ball leagues are already handled.
6. Keep a saved copy of this league's page as a test fixture, with a test that asserts 17 surviving teams, 1 chopped team, your team detected, and the guillotine variant.

## Technical notes

- `findTable` in `src/lib/fantasy/ffpc-parse.ts` gains a "must have rows" guard; standings selection in `parseLeagueHome` (`ffpc.server.ts`) gets an explicit chop branch keyed off `rptStandingsAliveTeams` / `rptStandingsChoppedTeams`.
- `FfpcTeam` gains `eliminatedWeek: number | null`; a migration adds `teams.eliminated_week integer` plus the matching sync write.
- Eliminated teams are filtered out in `analysis.server.ts` (sim inputs, standings) and in the guillotine survival path.
- New fixture `src/lib/fantasy/ffpc/__fixtures__/chop-home.html` (sanitised) with assertions in `ffpc-parse.test.ts`.
- Roadmap entry added for this task when the work starts.
