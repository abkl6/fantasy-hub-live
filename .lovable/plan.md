# Fill empty slots, separate from the waiver wire

Empty starting spots become their own short strip at the top of the waivers list, and kickers and defences disappear from the main list entirely.

## What you will see

**Fill empty slots** — a strip above the waiver list, shown only when one of your league's starting spots has nobody in it:

- Kicker or defence: the best free agent for this week's matchup (how many points the opponent is expected to score and how generous that defence has been to the position), always at the minimum bid, with one line of reason — "vs. CAR, 3rd-easiest matchup".
- Any other spot: the best free agent by rest-of-season value over the next-best free agent at that spot, with the normal bid recommendation.
- Each row shows the projected weekly gain, and in guillotine leagues the change in your survival odds.

**Stream** — one row under the strip, only when your current kicker or defence has a bottom-8 matchup this week and someone with a top-8 matchup is free. It suggests the swap at the minimum bid.

**The main list** never contains kickers or defences again. Their only appearances are the fill strip and the stream row, and the position buttons drop them too.

Everything in the strip, the stream row, the buttons and the list comes from the league's own starting-spot definition, never from who happens to be on your roster. A position your league does not start never appears anywhere, even when free agents exist.

The same strip appears on the cross-league Waivers page (one group per league) and as a "Fill empty slots" group in This week.

## Technical approach

New `src/lib/fantasy/slot-fill.ts` (pure, tested):

- `emptySlots(slots, roster)` — counts each league slot's capacity against rostered players who can fill it, flex-aware via `slotAccepts`; returns the positions still unfilled. Derived only from `slots`.
- `matchupScore(position, nflTeam, opponent, implied, defenseRank)` — combines the opponent's implied total and its rank against that position; returns `{ score, rank, reason }` with reason text like "vs. CAR, 3rd-easiest matchup".
- `buildFills(...)` / `buildStream(...)` — returns `SlotFill[]` and `StreamSuggestion | null`. K/DEF fills sort by matchup score and are always priced at `MIN_BID`; other positions sort by value over replacement and keep the existing `bidRecommendation` + `applyBidRules` + `paceBid` pricing.
- Stream fires only when the current starter's matchup rank is in the bottom 8 and a free agent's is in the top 8.

`src/lib/fantasy/waivers.server.ts`:

- Loads `team_implied_totals` (via `loadImpliedBook`/`impliedFor`), `defense_ranks` and `nfl_schedule` for the current week.
- Filters `K`/`DEF`/`DST`/`PK` out of `freeAgents` for the main list and out of replacement/VOR pools for the list; keeps a separate unfiltered pool for the strip.
- Adds `fills: SlotFill[]` and `stream: StreamSuggestion | null` to `WaiverBoard`; weekly gain from `optimalLineup` before/after, survival delta from `simulateGuillotine` as today (fills are scored like the existing top candidates).
- `needsKicker`/`needsDefense` tiering in `waiver-rank.ts` becomes unnecessary; K/DEF handling there is removed so the ranking never has to special-case them.

`src/lib/fantasy/waiver-hub.server.ts` + `waiver-hub-types.ts`: each league summary gains `fills` and `stream`; `SKIP_POSITIONS` already excludes K/DEF from the pool.

`src/lib/fantasy/this-week.server.ts` + `this-week-types.ts`: new `fill` kind with priority above lineup risks, one item per empty slot, carrying the reason and the bid.

UI: a `FillStrip` component rendered in `WaiverPanel` (league page) and on `/waivers`; chips filter to eligible positions minus K/DEF; This week gets a "Fill empty slots" group.

## Tests (`src/lib/fantasy/slot-fill.test.ts`)

- A roster with an empty kicker slot produces a fill row at the minimum bid.
- A roster that already has a kicker never yields a K in the main list.
- A kicker's recommended bid is the minimum whatever the rivals' budgets or bid history.
- A league with no K slot shows no K in the strip, the stream row or the list.
