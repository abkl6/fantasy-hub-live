# Waiver Wire upgrade

Turn each league's "Available" tab into a full Waiver Wire board: every unowned player with projected points, a suggested waiver bid, a trade value number, and how much adding them lifts your championship chances — with a one-tap pickup.

## What you will see

Inside a league, the tab is renamed **Waiver Wire** and each row shows:

- **Player** — name, position, NFL team, bye week, injury/news status badge.
- **Points** — projected points this week and rest of season.
- **Bid** — suggested waiver budget bid as a percentage of a $100 FAAB pot, scaled by how much the player helps your team and how scarce the position is. Marked "no bid" for players who would not crack your lineup.
- **Trade value** — points this player adds above the worst startable player at his position (points above replacement), so you can tell a real asset from a streamer.
- **Title impact** — change in your championship odds and playoff odds if you add him, plus the player the app recommends dropping.
- **Add** button — picks him up, drops the suggested player, and refreshes your odds.

Controls at the top: search, position filter, and a sort switch (points, bid, trade value, title impact). A short summary line shows your remaining roster room and how many rival rosters are still estimates.

Championship impact is only calculated for the top candidates (the ones actually worth a claim) so the page stays fast; the rest of the list still shows points, bid and trade value.

## Technical approach

- `src/lib/fantasy/rosters.server.ts`: extend `leagueWaiverWire` to also return `proj_points_season`, and add a `replacementLevel` helper computing, per position, the projection of the worst player who would start across the league's rosters.
- New `src/lib/fantasy/waivers.server.ts`:
  - `buildWaiverBoard(supabase, leagueId)` — loads the waiver pool plus the same engine inputs `buildAnalysis` uses (teams, rosters, slots, schedule, sim config).
  - Trade value = `proj_points_season - replacement(position)`.
  - For the top ~12 candidates by trade value, reuse the existing `optimalLineup` + `whatIf` pattern from `analysis.server.ts` (lower iteration count) to get `titleDelta`, `playoffDelta`, `winDelta`, and the suggested drop.
  - FAAB bid = normalised blend of lineup points gained and title delta, clamped 0–60% of budget; 0 when the player does not improve the optimal lineup.
- `src/lib/fantasy.functions.ts`: add `getWaiverBoard` (auth middleware, `leagueId` + optional search/position/sort), returning plain rows. Keep `getWaiverWire` for existing callers.
- `src/routes/_authenticated/league.$leagueId.tsx`: rewrite `WaiverPanel` to render the new columns, sort control, and impact badges; the Add button keeps using `applyMoveFn` with `kind: "waiver"` but now sends the suggested `dropName`. Adding respects roster size: if the roster is full and no drop is chosen, the button prompts for one.
- No database changes needed.

## Out of scope

- Real FAAB budget tracking per league (the bid is a recommendation against a standard $100 pot).
- Processing actual waiver claims on Sleeper/ESPN/Yahoo — pickups update the analyzer roster only.
