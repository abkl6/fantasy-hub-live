# Suggestions that match your team's situation

Right now every team gets the same kind of idea: trade a surplus player for a starter at your weakest spot. That is the correct advice for a contender and the wrong advice for a team going nowhere. This makes the suggestion engine read your team's badge first, then suggest moves that fit that badge.

## How suggestions change by badge

| Badge | What the engine will push |
| --- | --- |
| Top Seed / Contender / Dynasty King / Dynasty Contender / Win-Now | Buy now. Send future picks and young unproven players to rebuilding teams for their best veteran starters. Waiver advice favours immediate weekly points. |
| League Filler / Eternal Mediocrity | Pick a lane. Show the best buy idea and the best sell idea side by side, with a plain note that standing still is the worst option. |
| Bottom Feeder / Donator / Future Star | Sell now. Send your veterans to contenders for their draft picks and young risers. Waiver advice favours young stash players over a small weekly bump. |

Every suggestion gets a one-line reason tied to the badge, e.g. "You're a Contender — this costs future value but adds points now", or "You're a Bottom Feeder — Kupp won't matter in two years, this pick will."

## Trade partner matching

Trades are only suggested between teams whose situations actually fit:

- Contenders are paired with rebuilding teams (Donator, Future Star, Bottom Feeder, Eternal Mediocrity) — they want picks/youth, you want their veterans.
- Rebuilders are paired with contenders (Top Seed, Contender, Dynasty King/Contender, Win-Now) — they have picks and young depth to give.
- In redraft (no draft picks and no future), partner matching still applies but the currency stays players only: contenders buy the best available starter, bottom teams take the best of everything back at the weak spot rather than plugging one hole.

## Veterans vs. youth

Each player gets an "age lane" from the age and experience already stored in the player database:

- Young riser: age 24 or under, or two years or less of experience.
- Prime: 25 to 28.
- Veteran: 29 and up (26 and up for running backs, who fall off earlier).

Contenders offer picks + young risers and ask for prime/veteran producers. Rebuilders offer veterans and ask for picks + young risers. Offers stay balanced on the Keep Trade Cut market exactly as they do today, but sweeteners are drawn from the pool that matches your lane instead of "cheapest thing that fits".

## Where you'll see it

- League page → Suggestions and Trade tabs
- Manager Hub → Trade suggestions and Waiver wire sections
- Each suggestion card shows your badge and the strategy line ("Buying" / "Selling" / "Pick a lane")

## Technical notes

- `analysis.server.ts`: compute the dynasty value table (`leagueDynastyValues`, already used elsewhere) before standings so `classifyTeam` gets a real `dynastyRank` instead of the `null` it currently passes; this is also what makes badges correct on the league page.
- New `src/lib/fantasy/strategy.ts`: `strategyFor(badge, isDynasty)` → `{ mode: "buy" | "sell" | "pivot", wants, gives, rationale }`, plus `ageLane(position, age, yearsExp)`. Unit tests alongside the existing `team-class.test.ts`.
- Rewrite the trade-ideas loop in `analysis.server.ts` to iterate partner teams filtered by their badge's complementary mode, pick the target asset by strategy (`buy` → their best veteran/prime starter at my weak spot; `sell` → their picks and young risers for my best veteran), and restrict the sweetener pools passed to `balanceTrade` to lane-appropriate assets.
- Suggestion scoring: `buy` mode keeps ordering by `titleDelta`; `sell` mode orders by value gained (KTC delta + dynasty rank swing) since title odds legitimately drop on a sell. `Suggestion` gains `strategy`, `rationale`, and `dynastyDelta` fields; the existing `titleDelta`/`playoffDelta` badges still render.
- Waiver ordering in `waivers.server.ts` takes the same strategy: `sell` mode weights `longTermValue`/KTC market value ahead of the weekly points gain.
- UI: `MoveRow` in `manager-hub.tsx` and the suggestion cards in `league.$leagueId.tsx` render the strategy chip and rationale line.
