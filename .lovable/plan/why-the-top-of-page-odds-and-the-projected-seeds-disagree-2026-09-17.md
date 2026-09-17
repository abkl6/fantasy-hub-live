# Why the top-of-page odds and the Projected seeds disagree

They are two completely separate calculations, not two views of one result.

## What's actually happening

The title/playoff odds in the cards at the top of the league page come from the main league analysis. The Projected seeds table on the Playoffs tab is produced by its own, much simpler routine that reloads the league from scratch and re-runs the season simulation with different inputs.

Confirmed differences in what each one feeds the simulation:

| Input | Top-of-page odds | Projected seeds |
| --- | --- | --- |
| Player points | Current projection source, with strength-of-schedule and actuals blending applied | Whatever was stored on the roster row at last sync |
| Player consistency | Real per-player volatility (position defaults, historical) | A flat 0.35 for every player |
| Best ball | Uses the best-ball scoring shape | Ignored — treated as a normal lineup |
| Victory points / all-play weeks | Included | Ignored |
| Divisions | Division winners seeded first | Ignored |
| Playoff byes | Included | Included |

On top of that, the two results are cached separately, so one can be several minutes older than the other even when the inputs match.

So for any league that is best ball, victory-point scored, has divisions, or whose projection source differs from the last synced values — which includes the FFPC leagues here — the two numbers will reliably disagree.

## The fix

Make the Playoffs tab read the same simulation the rest of the page already ran, instead of running its own.

1. The league analysis already builds a full playoff picture from its own baseline simulation and returns it. Have the Playoffs tab use that payload rather than calling the separate playoff loader.
2. Retire the separate simulation path so nothing else can drift: the standalone loader becomes a thin wrapper that returns the analysis payload's playoff section, keeping its existing cache entry and background-warm behaviour so the tab stays fast.
3. With one source, the seeds table, the top cards, the standings table and the trend chart all agree by construction.
4. Sort the seeds by the league's real seeding rule rather than always by projected wins — victory points where the league uses them, division winners first where divisions exist — matching how the simulation itself seeds.
5. Show the "updated N min ago" stamp on the Playoffs tab from the same computation, so it's obvious when a number is from an older run.

## Technical notes

- Top cards: `myTeam.titleOdds` / `playoffOdds` from `loadAnalysis` in `src/lib/fantasy/analysis.server.ts`, off `simulateSeason(simInputs, simConfig, schedule, 2500, 7)` (line 632), with `simInputs` built at line 579 from projection-sourced `engineTeams` and `bestBallDistribution`/`teamDistribution`.
- Projected seeds: `loadPlayoffPicture` in `src/lib/fantasy/playoff.server.ts` (line 255) rebuilds teams from `roster_spots.proj_points` with `volatility: 0.35` (line 283) and a `simConfig` (line 305) missing `victoryPoints`, `allPlayWeeks` and `divisions`, then runs its own `simulateSeason` (line 311).
- Analysis already computes `buildPlayoffPicture(simInputs, simConfig, schedule, baseline)` (analysis.server.ts line 1684) and returns it as `playoff`.
- Change `PlayoffPanel` (`src/routes/_authenticated/league.$leagueId.tsx` line 1765) to consume `analysis.playoff`; reduce `loadPlayoffPicture` to delegate to the analysis payload so `cache.server.ts:329` and `jobs.server.ts:94` keep working unchanged.
- Move the seed ordering in `buildPlayoffPicture` (playoff.server.ts line 87) behind the same VP/division rules the engine uses.

## Verification

- Existing suite plus a new test asserting the seeds table's title odds for each team equal the analysis simulation's odds for the same team in a VP + divisions fixture.
- Load an FFPC league page and confirm the top card percentage matches that team's row in Projected seeds.
