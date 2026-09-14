# Weekly odds view on Game Day

Add a dedicated odds panel to Game Day that answers two questions per league, at a glance:

1. What are my chances of winning **this week**?
2. What are my chances of making the playoffs and winning the **title** this season?

Both numbers will be driven by the full player database (the imported weekly stats plus each member's own projection adjustments), not the numbers frozen at import time.

## What changes for you

- A new "Weekly odds" strip near the top of Game Day, under the live updates hub. One compact row per league:
  - Win-this-week percentage with a bar, and the matchup it refers to (opponent, or "vs the league leader" for best ball).
  - Playoff chance and title chance for the season.
  - The change since last week, once more than one week of history exists (today each league has only week 1 recorded, so the trend appears from week 2 onward).
  - A small week-by-week bar strip of title and playoff odds as the season fills in.
- Clicking a row jumps to that league's full matchup card further down the page.
- The numbers on the existing matchup cards come from the same calculation, so nothing disagrees between sections.

## Accuracy improvements behind the numbers

- Game Day currently projects each rostered player from the value stored when the league was imported. It will instead use the shared projection database, including any personal adjustments made in Stats Hub, and the position/scoring scaling for that league. This changes live projected finals, the win probability, and the odds.
- Season playoff/title chances are currently read from whatever snapshot was last saved by the league analysis page, which can be stale or missing. Game Day will compute them for the current week and store that snapshot, so history keeps building every week.

## Technical notes

- `src/lib/fantasy/live.server.ts`
  - Load projections once per request with `loadProjections(supabase, { scoring, week })` per league and use `proj.week(player_id, name, position, stored)` inside `toRow`, replacing the raw `scoring.scale(position, s.proj_points)` path.
  - After the per-league rosters are built, run the season simulation (`teamDistribution` / `bestBallDistribution` + `simulateSeason(inputs, config, schedule, 1500, 7)`), matching the settings used in `analysis.server.ts`, to get my team's `titleOdds` and `playoffOdds` for the current week; upsert into `weekly_snapshots` on `league_id,team_id,week`. Fall back to the latest stored snapshot if the simulation cannot run (no schedule, no roster).
  - Fetch my team's full snapshot series per league and attach it as `oddsHistory`.
- `src/lib/fantasy/live-types.ts`: add `oddsHistory: { week: number; titleOdds: number; playoffOdds: number }[]` to `LiveMatchup`; `titleOdds` / `playoffOdds` keep their current meaning (0-1 fractions).
- `src/components/GameDayBoard.tsx`: new `WeeklyOddsPanel` section rendering one row per matchup (win-prob bar, playoff %, title %, delta badge, mini week bars), with an anchor link to the matchup card below.
- Two leagues currently exist and both are 12-team dynasty, so the added simulation is a small, bounded cost per Game Day load; it runs once per league per request.
