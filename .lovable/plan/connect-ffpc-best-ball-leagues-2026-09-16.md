# Connect FFPC best ball leagues

## What I found

I read the league page behind the link you sent. Almost everything already comes through correctly: league name ($100 Empire BB Dynasty #24), season 2026, current week 2, your team (ID 12), your 22-player roster, and remaining FAAB ($999).

One thing stops the import: a best ball league's standings table only has two columns — Team and Pts — because there are no head-to-head records. The current reader insists on a full record row (W, L, T, points for and against), finds no teams, and gives up with "standings could not be read". There is also no weekly opponent schedule on the page, which the current reader expects.

## Changes

1. **Read best ball standings.** Accept a Team | Pts standings table: team name, total points, team ID from the row's roster element, keeping the existing crown/seed and "Ignore trade offers" clean-up. Records stay 0-0-0 because best ball has none.
2. **Treat a missing schedule as normal.** When the page has no Week | Opponent | Result table, import with no matchups instead of failing.
3. **Recognise the format.** When the league type says "Best Ball", set the league's contest to total points and its format to best ball, so the app uses the total-points views (rank this week, season standing, gap to the places above and below, chances of finishing 1st / top 3 / inside the cut) rather than an opponent card. Dynasty and Empire are already picked up from the league type text.
4. **Skip the pages best ball doesn't have.** Don't fail the import when per-team lineup pages or transaction/draft pages can't be read; keep the rest.
5. **Keep everything else as-is** — the private link stays encrypted and server-side, one request per second, last-good data plus "sync paused" on a bad page, and the existing head-to-head FFPC leagues keep parsing exactly as they do now.

## Verification

- Add a saved copy of this best ball page as a test fixture (with the private token stripped) and a test asserting: name `$100 Empire BB Dynasty #24`, season 2026, week 2, your team ID 12, 12 teams, first place `BoldNorth Empire24` with 214.20 points, 22 players on your roster, best ball / total points detected, and no schedule rows.
- Re-run the existing FFPC tests to confirm the head-to-head league still parses identically.
- Run type checks, the full test suite and the player-name guard, then connect this link in the signed-in app and confirm the league imports and its pages render.
