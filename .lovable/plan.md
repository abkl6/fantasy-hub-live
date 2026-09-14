# Guillotine survival badges and three-tier FAAB bids

Guillotine is its own game: no playoffs, no titles — every week the lowest scorer is gone, and the eliminated roster dumps into the pool. Team quality and bidding advice both get rebuilt around survival.

## Survival-based team classifications

In guillotine leagues, the usual Top Seed / Contender / Dynasty badges are replaced by survival badges, driven by each team's weekly survival odds, win-it-all odds, and remaining budget:

- **Safe** — very low chance of going out soon; can sit out most bidding wars.
- **Comfortable** — clearly above the chopping block but not untouchable.
- **On the Bubble** — a bad week away from elimination.
- **Chopping Block** — worst or near-worst weekly projection; needs help now.
- **Broke and Exposed** — on the bubble with little FAAB left to fix it (the team you can outbid cheaply).
- **Loaded** — safe and still holding a big budget (the team that can outbid you whenever it wants).

Badges appear everywhere the current badges do: standings, Game Day matchups, Manager Hub, and both sides of a proposed trade. Hovering explains why.

## FAAB tracking

Each league gets a budget size ($100 or $1000, editable) and each team a remaining balance. Sleeper reports what's been spent, so those leagues fill in automatically on sync; other platforms get a simple editable amount per team on the league page, plus a "log a winning bid" box so balances stay current as the season goes.

## Three bid numbers per player

Every player on a guillotine waiver board shows three suggested bids, in dollars and as a percentage of your remaining budget:

- **Aggressive** — the price that wins the player against a desperate rival, for when he genuinely changes your survival odds.
- **Optimal** — the recommended number: the best balance of winning the bid and keeping powder dry, highlighted as the default.
- **Passive** — the value price; you get him only if the room is asleep.

Each comes with a one-line read, e.g. "Two teams on the chopping block have $60+ left — expect heat" or "Only bubble teams need this position and they're broke."

### What drives the numbers

- How much the player raises *your* weekly survival odds (re-simulated with him in your lineup) — the ceiling on what he's worth to you.
- How much he raises the survival odds of each *rival*, weighted by how desperate they are: teams near the cut line pay far more than safe teams.
- Each rival's remaining budget — a desperate team with $8 left can't outbid you no matter how badly they want him.
- Where you sit: safer teams bid lower across the board (your ask, exactly), teams on the block bid up to what survival is worth.
- Scarcity: weeks with a fresh eliminated roster flood the pool and depress prices; thin weeks push them up.
- Season stage: budget held into the final weeks is worth less, so late-season bids scale up.

Non-guillotine leagues keep today's single suggested bid, unchanged.

## Technical notes

- Migration: `leagues.faab_budget` (default 100), `teams.faab_remaining` / `teams.faab_spent`, and a `faab_bids` table (league, team, player, amount, week, won) for logging bids; standard RLS scoped to `auth.uid()` plus grants.
- `sleeper-sync.server.ts`: read `settings.waiver_budget_used` per roster and `league.settings.waiver_budget` to populate budgets.
- New `src/lib/fantasy/faab.ts`: pure functions `desperationOf(team)`, `rivalPressure(...)`, `bidLadder(...)` returning `{ aggressive, optimal, passive, reason }`, with unit tests.
- `team-class.ts`: add a survival branch keyed off `isSurvival(format)` returning the six survival badge keys, fed by `simulateGuillotine` results already computed in `analysis.server.ts`.
- `waivers.server.ts`: for survival leagues compute each candidate's survival delta for my team and for every rival, then call `bidLadder`; extend `WaiverBoardRow` with `bids`.
- League page waivers tab and Manager Hub waiver rows render the three bids; budget editing lives on the league page.
