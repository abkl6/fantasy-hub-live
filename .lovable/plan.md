# Leave kickers and defences out of leagues that don't start them

## What's actually wrong

Verified in the database for **$35 Chop Best Ball - 2hr Slow #113762**:

- Its stored starting spots are `QB, RB, RB, WR, WR, WR, TE, TE, FLEX, K, DEF` — an exact match for the app's hardcoded FFPC fallback lineup, not this league's real lineup.
- There is a logged import warning for FFPC: "leagueRulesFFPC.aspx: layout not recognised; kept League Home settings." So the rules page was never read, and the fallback silently invented a kicker and a defence spot.
- The rosters agree with you: across all teams there are 100 WR, 74 RB, 40 TE, 39 QB, and exactly 1 kicker and 1 defence (stray entries). Nobody is rostering them.

Because the spots list includes K and DEF, the league's allowed positions include them, so kickers and defences appear in advice, lists and position buttons.

## The fix

1. **Stop inventing spots.** When FFPC's rules page can't be read, no longer assume the standard lineup with K and DEF. Fall back to a lineup built from what teams actually roster, and mark those spots as guessed rather than confirmed.

2. **Read more FFPC rules layouts.** Add a second way to read the starting lineup off the rules page: a text-based reading ("Starting Lineup: 1 QB, 2 RB, 3 WR, 2 TE, 1 Flex") in addition to the current table reading, and treat best-ball pages the same way.

3. **Guess from the rosters when the page still can't be read.** Count positions held across all teams; any position that essentially nobody rosters (under a small threshold relative to team count) gets no starting spot. This produces QB/RB/WR/TE/FLEX for #113762 and leaves K and DEF out entirely.

4. **Ask you to confirm.** Guessed lineups show the existing confirm banner on the league page. Once confirmed, syncing never overwrites it.

5. **Let you correct any league yourself.** The slot editor that manual leagues already have becomes available for connected leagues too, from the league page, so a wrong lineup is a 30-second fix rather than a support issue.

6. **Repair the leagues already affected.** Recompute the starting spots and allowed positions for FFPC leagues whose spots came from the fallback and whose rosters show no kickers or defences, and clear their stored results so the pages rebuild without K/DEF.

## Tests

- A best-ball FFPC league whose rules page fails to parse produces no K or DEF spot and no K or DEF anywhere in its lists, wire, fills, or position buttons.
- The text-style FFPC rules layout parses into the correct counts.
- A league that genuinely does roster kickers and defences still keeps them.

## Technical notes

- `src/lib/fantasy/ffpc.server.ts` line ~668: drop the literal `["QB","RB","RB","WR","WR","WR","TE","TE","FLEX","K","DEF"]` fallback; return an empty slot list plus a warning and let the slot layer infer.
- `src/lib/fantasy/ffpc-parse.ts` `parseRules`: add a regex-based starting-lineup reader alongside the current `findTable("position","starters")` path.
- `src/lib/fantasy/slots.server.ts`: add roster-observation inference (`source: 'inferred'`) used when a sync supplies no slots; never overwrite `source: 'user'`.
- Recompute `leagues.eligible_positions` from `league_slots` and call `clearCache` per repaired league.
