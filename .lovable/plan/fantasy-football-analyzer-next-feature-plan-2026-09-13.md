# Fantasy Football Analyzer — Next Feature Plan

## Goal
Make the playoff picture impossible to miss, keep rosters current with live injury and news, and let managers act on advice in one tap. Add league history so they can see how power shifted week to week and how the draft shaped the season.

## What we will build

### 1. Playoff Tracking (primary)
A new "Playoff" tab inside every league that answers the questions managers ask in November and December.

- **Clinching scenarios**: what record is needed to clinch a playoff spot, a first-round bye, or the division.
- **Magic / elimination numbers**: how many wins separate each team from clinching or elimination.
- **Seed projections**: projected 1–7 seed order and who gets the bye.
- **Remaining strength of schedule**: average projected points of each team's remaining opponents.
- **Who to root for**: in matchups that do not involve the user's team, highlight which result helps the user's playoff chances.
- **Playoff bracket preview**: projected bracket based on current seeds and remaining schedule.

### 2. Live injury, news, and bye alerts (freshness priority)
Keep rosters accurate without manual refreshing.

- Pull live player status (Active, Questionable, Doubtful, Out, IR) from Sleeper's public player feed and update the local player pool.
- Surface status badges on the Lineup, Available, and Moves tabs.
- Add an "Alerts" section on the league page listing:
  - starters who are out or on bye this week,
  - bench players with favorable matchups who could replace them,
  - waiver targets that fill the gap.
- Add a one-tap "Set best lineup" button that swaps out inactive/benched players for the highest-projected legal lineup.

### 3. One-tap actions (automation preference)
Turn every suggestion into something the manager can act on instantly.

- **Moves tab**: "Apply this lineup" for start/sit suggestions; "Add to roster" for waiver targets (updates the local roster and removes the player from Available); "Save to watchlist" for later.
- **Trade tab**: "Copy trade offer text" that drafts a message to the other manager with the projected title-odds impact.
- **Waiver tab**: "Replace on my roster" that drops the lowest-value player at the same position and adds the target.

### 4. Power-rank history (league context)
Show how each team's fortune changed over the season.

- Snapshot each team's title odds, playoff odds, projected wins, and power score at the start of every week.
- Render a line chart of title-odds movement for every team in the league.
- Add a "Trending up / Trending down" badge on the standings tab based on the last three weeks.
- Make snapshots visible on a new "Trends" tab and as small sparklines on the standings table.

### 5. Draft recap grades (league context)
Grade each team's draft and surface the picks that mattered.

- For Sleeper leagues: import the real draft results and compare each pick to current rest-of-season value.
- For manual/ESPN/Yahoo leagues: let the user upload a screenshot of the draft board or enter picks manually; AI reads the board and assigns grades.
- Show team draft grade, best value pick, biggest reach, and total projected value versus ADP.
- Add a "Draft" tab to the league page when draft data exists.

## Technical approach

- Add a `weekly_snapshots` table to store per-team title odds, playoff odds, projected wins, and power score each week.
- Add a `draft_picks` table to store pick number, player, team, position, and ADP/value data.
- Add a `player_news` table for injury/status updates with a timestamp, so the UI can show "out 2 hours ago" style badges.
- Extend the existing simulation engine to compute magic numbers, clinching thresholds, seed projections, and strength of schedule.
- Use Sleeper's public player endpoint as the live status source; for platforms without a public feed, let the user override status in the roster editor.
- Reuse the existing screenshot-reading AI flow for draft boards and manual roster status updates.

## Out of scope for this plan
- Real-time score tickers during games (the app refreshes on page load only).
- Automatic lineup changes on the actual fantasy platform (we update the analyzer roster, not the platform API).
- Push notifications.

## Success criteria
- The user can open a league, click "Playoff," and immediately see their clinching path, seed, and who to root for.
- Inactive starters are flagged on the league page with a one-tap fix.
- Every suggestion has a clear one-tap action.
- The Trends tab shows title-odds movement for every team across the season.
- Sleeper leagues show a Draft tab with grades and value picks; other leagues can add one via screenshot.
