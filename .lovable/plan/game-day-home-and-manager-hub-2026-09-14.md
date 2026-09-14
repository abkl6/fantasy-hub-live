# Game Day Home and Manager Hub

## Goal
Make **Game Day** the signed-in home: a fast, compact command center for every tracked team. Move decision support and roster risk into a new **Manager Hub** so live scores stay focused.

## Game Day becomes the main screen
- Send successful email, Apple, and Google sign-ins to `/gameday`.
- Update signed-in calls to action and the Gridiron Edge logo to open Game Day.
- Make **Game Day** the first and visually strongest navigation item.
- Keep the existing league list at `/dashboard`, renamed **Leagues**, for adding, removing, and opening individual leagues.
- Add **Manager Hub** to the main navigation at `/manager-hub`.

## Live notification hub
- Place a compact **Live Updates** feed at the top of Game Day.
- Highlight the five newest scoring updates across all tracked teams and relevant opponents.
- Add one clear expand/collapse control to reveal or hide the remaining updates.
- Keep updates newest-first and show player, play, points gained or lost, league, side, and resulting score.
- Preserve automatic game-window refresh, manual refresh, loading, empty, and error states.

## Compact all-league scoreboard
- Replace always-open roster cards with one concise matchup row per tracked league.
- Each standard league row shows league, user team, opponent, live score, projected final, players remaining, game state, and current win probability.
- Use a clear probability bar and restrained status color so the most urgent or closest matchups are easy to scan.
- Sort live games first, then upcoming games, then finals.
- Expand a league row on demand to reveal both starting lineups and benches with live points, projection, clock/status, and opponent.
- Link each row to the full league analyzer without duplicating its trade, waiver, standings, or playoff tools.

## Best-ball presentation
- Detect best-ball leagues from their saved format.
- Replace the head-to-head opponent with the current weekly league leader.
- Show the user's live score, leader's live score and name, current league rank, projected finish, and simulated chance to finish first this week.
- Also show the user's season-long championship odds.
- Expand to show the user's roster and the current leader's roster, including which scores currently count toward the best-ball lineup.

## Win probability model
- Add weekly win probability fields to the Game Day response.
- For head-to-head leagues, combine current scores with each unfinished player's remaining projection and volatility; completed players contribute no remaining uncertainty.
- For best ball, simulate the remaining player outcomes for every team, rebuild each optimal best-ball lineup per simulation, and report the share where the user's team finishes first.
- Keep the existing season simulation as the source of season-long championship odds.
- Return enough context for honest labels when rosters, opponents, or projections are incomplete instead of displaying false precision.

## Manager Hub
Create `/manager-hub` with an all-league overview containing:
- **Recommended moves:** highest-impact lineup, waiver, and trade suggestions, ranked by championship impact and labeled by league.
- **Roster alerts:** injuries, status changes, bye conflicts, and relevant news for rostered players only, with links to the correct league action.
- **Player exposure:** ownership count and percentage across the user's leagues, with concentrated injury-risk players surfaced first.
- **League shortcuts:** compact league cards with record, title outlook, and direct links to the analyzer, waivers, and trade tools.

Detailed waiver lists, trade builders, lineup editing, standings, projections, and history remain on their existing pages; the Manager Hub summarizes and routes users to the right place.

## Technical details
- Extend the client-safe Game Day types and server builder with format-aware comparison data, weekly probability, season title odds, opponent/leader bench data, rank, and stable event ordering.
- Add pure, deterministic weekly probability helpers alongside the existing simulation engine so calculations are testable and shared.
- Add a dedicated authenticated Manager Hub server function that batches all-league reads and reuses existing suggestion and alert rules without exposing another user's data.
- Create the new authenticated route with its own metadata; update every current `/dashboard` post-login destination while preserving `/dashboard` as the Leagues route.
- Use the existing design tokens, buttons, badges, progress controls, query states, and refresh behavior. No database migration is expected.

## Validation
- Verify email and social sign-in destinations plus signed-in home links.
- Test standard, best-ball, missing-opponent, pregame, live, final, empty, loading, and error states.
- Confirm exactly five updates appear before expansion and that expanded roster details do not shift or overlap the compact scoreboard.
- Check Game Day and Manager Hub at mobile and desktop sizes.
- Confirm all new navigation and league deep links resolve and authenticated data remains user-scoped.
