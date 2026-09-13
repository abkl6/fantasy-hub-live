# Fantasy Football League Analyzer

A signed-in app where one person tracks all of their fantasy teams across different platforms in one place, with scores and analysis refreshed each time they open a page.

## What users get

1. **Sign in** — email and password account. Everything below is private to that account.
2. **My Teams dashboard** — every league/team the user tracks, showing platform, record, current matchup score, and a quick strength grade.
3. **Add a league** — pick a platform and connect it:
   - Sleeper: paste a username or league ID, leagues import automatically.
   - ESPN: paste a league ID (public leagues work immediately; private leagues need two values copied from the user's ESPN browser session).
   - Yahoo: sign in with Yahoo to import leagues (requires a Yahoo developer app; see Setup needed).
   - FFPC and NFL.com: no public connection exists, so these are added manually.
   - Manual: name the league, scoring type, and enter the roster by player.
   - **From screenshots**: upload one or more screenshots of a roster page or the league settings/scoring page from any app, and the roster and scoring rules are read out of the images automatically. The user sees what was read, fixes anything wrong inline, and confirms before it saves. Works for FFPC, NFL.com, or any league that can't be connected directly, and handles unusual scoring (custom point values, bonuses, unusual roster slots).

4. **League detail page** — roster with player status, live-ish matchup scoreboard (refreshed when the page opens or the user hits Refresh), standings, and schedule.
5. **Analyzer** per team:
   - Strength and weak spots: position-by-position grade vs. league average.
   - Start/sit: recommended lineup for the week with reasons.
   - Waiver targets: available players who beat a current starter at a weak position.
   - Trade evaluator: pick players from each side, get a fairness verdict and impact on both rosters.
6. **Championship projections** — for each team: odds to make the playoffs and to win the league title, projected final record, and a simple "why" (schedule difficulty, roster strength, injuries). Shown on the dashboard as a headline number per team and on the league page as a full standings-style odds table.
7. **Every suggestion shows win impact** — each waiver pickup, drop, start/sit swap, and trade is labeled with the change it makes to weekly win chance and to title odds (e.g. "+3.1% title odds"). Suggestions are ranked by that impact, so the top of the list is always the highest-value move. One-tap actions: accept a suggested lineup change, mark a waiver claim as planned, or save a trade idea to revisit.
8. **Refresh behavior** — data loads fresh on page load and via a manual Refresh button; no background polling.


## Build order

1. Accounts and sign-in, plus the empty dashboard shell and design system (bold sports-broadcast look, dark surface, one accent color, condensed headline type — no generic purple gradient).
2. Data storage: users, tracked leagues, teams, rosters, players, weekly scores, manual entries.
3. Sleeper integration end to end (fastest real data), including league import and scoreboard.
4. Manual league entry + roster editor.
5. ESPN integration (public league IDs first, private-league credentials second).
6. NFL player and stats reference data so analysis works for every platform, including manual leagues.
7. Analyzer features: strength grades, start/sit, waiver targets, trade evaluator.
8. Season simulation engine powering playoff and title odds, then win-impact labels on every suggestion.
9. Yahoo integration once Yahoo app credentials are available.
10. FFPC: manual entry only, with a clear note in the UI explaining why.


## Setup needed from you

- **Yahoo**: requires creating a free Yahoo developer app and giving me the client ID and secret. I will ask for these when we reach that step.
- **ESPN private leagues**: each user copies two values from their own ESPN session; I will show in-app instructions.
- **FFPC / NFL.com**: no public interface to connect to. These stay manual unless you have credentials or an export file from them.

## Technical notes

- Lovable Cloud for auth, database, and server-side API calls; all third-party requests run server-side so keys and league credentials never reach the browser.
- Per-platform adapter modules normalizing each provider into one internal league/team/roster/matchup shape, so the analyzer and UI are platform-agnostic.
- Player identity mapping table to reconcile provider player IDs against a canonical NFL player list.
- Fetch on load with short-lived server-side caching to avoid hammering provider APIs; manual Refresh bypasses cache.
- Row-level security scoping every league, roster, and credential row to its owner; stored ESPN/Yahoo credentials encrypted at rest and never returned to the client.
- Title odds come from a Monte Carlo simulation of the rest of the season (weekly team score distributions from player projections plus variance, run over the remaining schedule and playoff bracket). Runs server-side, results cached per league/week.
- Win impact of a move is the same simulation re-run with the hypothetical roster, differenced against the baseline — one shared routine used by waivers, start/sit, and trades so numbers always agree.

