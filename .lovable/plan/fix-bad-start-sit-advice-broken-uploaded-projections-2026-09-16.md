# Fix bad start/sit advice: broken uploaded projections

## What is actually wrong

Strength of schedule is not the cause. This league has schedule adjustment turned off, so no multiplier touched these numbers.

The real problem is in the projection numbers that were uploaded and are now in use:

- The league is set to "My projections". Those uploaded numbers cover 617 players for all 18 weeks.
- Every single uploaded row kept only receiving stats. Passing and rushing were dropped entirely on import: 0 rows out of 617 have passing yards, 0 have rushing yards.
- So De'Von Achane is priced on his catches alone — 7.4 points in week 2, with none of his rushing. Running backs as a group average 1.4 points a week and quarterbacks average *minus* 0.1.
- Kareem Hunt was never matched to a real player record, so he falls through to the number Sleeper sent with the roster (9 points) — a number from a completely different source. A stale bench name on the platform's scale therefore outranks a genuine star on the broken uploaded scale.

Two faults, then: the upload silently threw away most of the file, and the app happily mixes a broken uploaded number for one player with a platform number for another in the same comparison.

## Plan

### 1. Stop the bad numbers being used right now

Clear the damaged uploaded projections for the 2026 season so every league falls back to app/platform numbers, and tell the owner their file needs re-uploading. Advice becomes sane immediately, before any re-upload.

### 2. Make the upload accept real-world column names

Today a column only counts when its heading matches the template word for word. Add an alias list per stat (for example passing yards also as "PASS YDS", "PASS YARDS", "PA YD", "PYDS"; the same treatment for rushing, receiving, touchdowns, interceptions, fumbles, kicking and defensive columns), plus tolerance for punctuation and underscores. Reuse the alias table that already exists for scoring keys rather than writing a second one.

### 3. Refuse a file that lost whole categories

After mapping the columns, check the result before saving anything:

- If the file has quarterbacks but no passing column, or running backs but no rushing column, stop and say which headings were not recognised, listing the ones that were.
- Show a short preview of a few well-known players with their computed points so the numbers can be eyeballed before they go live.
- Record every upload in the existing batch table (name, headings recognised, rows, matched count) so a bad import can be traced and rolled back later. Uploads currently leave no trace at all.

### 4. Never mix sources inside one comparison

When a league reads from one source, a player with no number in that source must not silently inherit the platform's number:

- Fall back in a fixed order — chosen source, then app numbers, then platform — and remember which one was used for each player.
- Mark any player priced from a weaker source in the suggestion text ("no projection — platform estimate"), and never rank such a player above a player with a real projection from the league's own source.

### 5. Handle players who are not in the league

Kareem Hunt has no player record because he is not on an NFL roster. Treat an unmatched roster name as unknown: zero projection, flagged as "not found — likely not on an NFL roster", and excluded from start/sit suggestions instead of being promoted by a leftover platform number.

### 6. Verify

- Tests: alias mapping of a realistic third-party header row; rejection of a file missing passing and rushing; unmatched player never suggested as a starter; source-mixing rule.
- Live check on this league: Achane ranks above Hunt, quarterbacks have positive projections, running-back averages look like football.

## Technical notes

- `src/lib/fantasy/projection-templates.ts` — `mapHeaders` currently matches `clean(header)` exactly against template headings; add the alias map and reuse `STAT_ALIASES` from `scoring.ts`.
- `src/lib/projections.functions.ts` — `uploadMyProjections`: add post-mapping validation, the preview return, and a `projection_batches` insert (that table is empty today; nothing writes to it).
- `src/lib/fantasy/projections.server.ts` — `loadProjections`: the `week()` fallback `scoring.scale(position, base)` is where the platform number leaks in; carry a per-player source tag through `ProjectionSet`.
- `src/lib/fantasy/analysis.server.ts` (lines ~442, ~861, ~898) and `rosters.server.ts` (~207) pass `roster_spots.proj_points` as that base — they consume the new tag for ranking and labels.
- Deleting the damaged rows is a data change: `player_week_stats` where `season = 2026` and `source like 'user:%'`.
