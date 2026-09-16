# Fix the FFPC League Home importer

## Goal
Rebuild FFPC parsing around the page’s stable labels and table shapes so league details, standings, schedules, rosters, lineups, transactions, and FAAB import accurately. FFPC will identify the manager’s team automatically from `Team ID` and will no longer ask them to choose it.

## Implementation

1. **Capture safe regression fixtures**
   - Fetch the supplied league’s `LeagueHome.aspx`, `Rosters.aspx`, and one `SetLineup.aspx` page server-side using the existing throttled FFPC reader.
   - Save sanitized HTML under `src/lib/fantasy/ffpc/__fixtures__/`, replacing every private `ltuid` occurrence before writing while preserving the relevant markup.
   - Keep fixture access test-only; no private token will enter source, browser responses, errors, or logs.

2. **Replace broad League Home guesses with anchored parsing**
   - Locate the league-information block by `League ID`, `League Type Description`, and `Team ID`.
   - Read the league name from the first `<h3>` after that block, league type from the labeled value, team count from `Teams:`, and manager team ID from `Team ID:`.
   - Read the active season only from the year marked `*` in the Season selector.
   - Read current week from the NFL scoreboard heading, with `Scoreboard.aspx`’s `Week N (Current)` as the fallback; ignore playoff bracket week labels.
   - Parse `Remaining FAAB Dollars` exactly, including commas and decimals.

3. **Parse FFPC standings by their real row shape**
   - Match the exact standings header and parse data rows positionally as `[team, W, L, T, VP, Pts, Pts Against]`, accounting for FFPC omitting the Waiver cell.
   - Treat one-cell `Division N` rows as grouping markers, not teams; skip `#` footnotes.
   - Strip a trailing `#N` from the display name into `playoffSeed`, while retaining tags such as `(C)`.
   - Remove `Ignore trade offers` text from the trailing cell.
   - Set contest format to `vp` whenever `Season VP` is present.

4. **Parse schedule, rosters, lineups, and transactions to the specified shapes**
   - Schedule: parse `Week | Opponent | Result`, take opponent ID from `viewingTeam`, parse `W/L/T score-score`, preserve `homeTeamID`, and represent unplayed ties correctly.
   - My roster: parse `SLOT | PLAYER | POS | BYE`, convert `Last, First TEAM` to `First Last`, normalize PK/DST positions, and mark only `BN` as bench.
   - All rosters: parse each `Rosters.aspx` team row and linked players, then overlay each team’s `SetLineup.aspx` slot assignments.
   - Match roster players using normalized name plus NFL team, while retaining the shared name-normalization safeguards.
   - Transactions: parse `Date | Team | Player | Action`, team IDs from `viewingTeam`, and Added/optional Drop player details.

5. **Persist the newly parsed team metadata**
   - Add authenticated, RLS-protected `division` and `playoff_seed` fields to teams, with the required grants preserved.
   - Carry those fields through FFPC bundle types, initial persistence, and refresh updates.
   - Keep the existing last-good-data behavior: malformed required FFPC pages pause sync instead of replacing valid league data.

6. **Remove the FFPC team picker**
   - Make import use the manager team ID parsed from League Home as the sole FFPC selection.
   - Replace the team-choice list with a concise confirmation of the detected team; fail clearly if FFPC does not provide a usable Team ID rather than asking the user to guess.

## Verification

- Add a fixture-backed parser test asserting exactly:
  - league `$100 Empire Standard Dynasty #39`
  - season `2026`
  - current week `2`
  - manager team ID `7`
  - `12` teams across `3` divisions
  - `Mingos (C)`: `1-0-0`, `4 VP`, `162.95` points, playoff seed `3`
  - manager roster has `19` players and Jalen Hurts is in the `QB` slot
- Add focused checks for schedule results/opponent IDs, FAAB commas/decimals, transaction add/drop parsing, division/footnote exclusion, and VP detection.
- Run the FFPC fixture tests, the complete fantasy test suite, type checks, and the player-name guard.
- Verify the signed-in Connect flow shows the detected FFPC team without a picker and imports the fixture-shaped league successfully.
- The parser is not considered complete until the required fixture-backed test passes.
