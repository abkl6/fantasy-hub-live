# Import your weekly-stats projection files

## What's in the ZIP

Five CSVs: offensive stat lines (11,538 rows), IDP (19,296), kickers (648), team defences (576), and an 18-week NFL opponent schedule. Every player has a row for all 18 weeks with projected stat lines (pass attempts, yards, TDs, catches, etc.) — keyed as `Name|TEAM`.

## Will it load today? No

The "My projections" upload expects fantasy **points** columns ("week points" / "season points"). Your files contain raw stat lines instead, so the current upload would reject them. These files are actually a richer format — the app can turn stat lines into points using each league's own scoring rules.

## What I'll build

1. **Accept the ZIP (or the individual CSVs) in "My projections"**
   - Unzip in the browser, auto-detect each file type (offence / IDP / kicker / defence / opponents) from its header row — no renaming needed.
   - Show the same preview/validation as today: rows read, players matched, anything unrecognized, then Save.

2. **Store stat-line projections in a new table** (`user_week_projection_stats`)
   - One row per player per week with the full stat line, private to your account.
   - Match players by the `Name|TEAM` key using the app's canonical name matching; report any unmatched names so you can fix them.

3. **Turn stats into points with each league's scoring rules**
   - Reuse the app's existing stat-to-points scorer; extend its column aliases to cover these headers (pa_att, rec_fd, FG distance bands, DST points-allowed bands, IDP solo/ast/tck, etc.).
   - Stats Hub "My projections" shows points computed with standard PPR; league analysis (lineup, waivers, trades, odds) applies each league's own scoring rules at read time — so the same file works across all your formats.
   - Your upload stays the default source everywhere, as set up previously.

4. **Use the opponents file**
   - Import the 18-week opponent grid to refresh schedule/matchup data used by strength-of-schedule and Game Day.

5. **After import**: clear cached analysis and recompute blends so every league page reflects the new numbers on next view.

6. **Tests**
   - Parse each of the four stat file types plus the opponents grid.
   - Stat-line → points conversion for offence, K, DEF, and IDP under two different scoring rule sets.
   - Unmatched-player reporting; "My projections" still wins over the app baseline.

## Technical notes

- New table gets the standard access rules (you only ever see your own rows).
- Unzipping uses a small pure-JS library that works in the browser; no server changes needed for that step.
- No changes to how actuals (real game results) are stored — these projections live separately and feed only the projection side.
