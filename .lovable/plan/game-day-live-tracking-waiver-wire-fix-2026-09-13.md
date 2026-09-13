# Game day live tracking + waiver wire fix

Two things: turn the app into a live game-day tracker with a running scoring log per league, and fix the available-player list so rostered players never appear as free agents.

## Part 1 — The waiver wire bug (confirmed)

Your player list contains the same player twice under two spellings. Checked in the database right now:

| Duplicate pair | Teams listed |
| --- | --- |
| Kenneth Walker III / Kenneth Walker | SEA / KC |
| Marvin Harrison Jr. / Marvin Harrison | ARI / ARI |
| Brian Thomas Jr. / Brian Thomas | JAX / JAX |
| Travis Etienne Jr. / Travis Etienne | JAX / NO |
| Tyrone Tracy Jr. / Tyrone Tracy | NYG / NYG |

Your Sleeper rosters store the suffix-free spelling ("Kenneth Walker"), and availability is matched on the exact name, so the suffixed copy looks unowned and lands on the waiver wire.

Fix, in three parts:

1. **Merge the duplicates.** Keep one row per real player, carrying the correct real-world name (Kenneth Walker III, Marvin Harrison Jr., Travis Etienne Jr., Brian Thomas Jr., Tyrone Tracy Jr.), the Sleeper link the rosters already point at, and the better projection of the pair. Roster rows are renamed to the surviving name in the same step.
2. **Match on a normalised name everywhere.** Ignore case, punctuation (periods, apostrophes, hyphens) and generational suffixes (Jr., Sr., II–V), and require the position to match. This is what availability, roster imports, screenshot import and trade lookups will all use, so a spelling difference can never split a player in two again.
3. **Guard rail.** A uniqueness rule on the normalised name plus position, so a second spelling cannot be inserted again by an import.

Also corrected while merging: a rostered player's NFL team follows the Sleeper record, so Walker shows SEA rather than KC.

## Part 2 — Live game-day scoring

### What you get

A **Game Day** page (and a matching Live tab inside each league) that is useful with the phone propped up on the couch:

- **Your matchups, one card per league** — your live score vs your opponent's, each player's live points, who has not played yet, who is in progress, who is done, and a live projected final for both sides that updates as the games run.
- **Scoring log** — a running feed, newest first, of every point-scoring play by a player in one of your lineups or your opponent's. Each entry names the league it matters to, the play ("32-yd TD catch"), the points it was worth *in that league's scoring*, and the matchup score right after it.
- **Filters** — all leagues, or one league; mine only, or mine and opponent.
- Bench players are shown separately and greyed, so you can see what you left on the bench without it polluting the score.

Because every league re-scores the same play with its own rules, the same touchdown can be worth different points in two of your leagues, and the log shows that.

### Updating

Auto-refresh only during game windows (Thursday evening, Sunday from early afternoon through the night game, Monday evening, US Eastern), roughly every 45 seconds, and only while the page is actually in front of you. Outside those windows it refreshes on page load with a manual refresh button. A "last updated" stamp is always visible.

## Technical approach

**Data source.** Sleeper's public stats endpoints (no key, no account): `GET /v1/state/nfl` for the live season/week/phase, and `GET /v1/stats/nfl/regular/{season}/{week}` for cumulative per-player stat lines, joined to our players via `sleeper_id`. Game status/clock comes from the public ESPN scoreboard endpoint so we know who has played, who is playing, and how much game is left.

**New tables (migration).**
- `live_player_stats` — one row per player/season/week holding the latest raw stat line (`jsonb`), game state (pre/in/final), and fetched-at. Readable by any signed-in user, written only by the server.
- `scoring_events` — one row per detected stat change: player, season, week, the stat delta (`jsonb`), a generated description, and occurred-at. League-agnostic and scored per league at read time.

**Refresh path.** A server function `refreshLiveScoring()` pulls the Sleeper snapshot, diffs it against `live_player_stats`, writes the deltas into `scoring_events`, and updates the snapshot. It is safe to call concurrently (upsert by player/week, events deduped by player/week/stat-delta hash). A public cron route `/api/public/cron/live-scoring` calls the same helper with the cron secret so the log keeps filling even when nobody has the page open.

**Scoring the log.** Points per event come from the existing `src/lib/fantasy/scoring.ts` (`leagueScoring` + `scoreStats`) applied to the stat delta with that league's rules — the same path already used for projections, so live and projected numbers are consistent.

**Live projected final.** For each starter: finished players contribute actual points; in-progress players contribute actual points plus their remaining weekly projection pro-rated by game clock remaining; players yet to start contribute their full weekly projection.

**New files.**
- `src/lib/fantasy/live.server.ts` — Sleeper/ESPN fetch, diffing, `buildGameDay(supabase, userId, opts)` returning matchup cards plus the scored event feed.
- `src/lib/fantasy/names.ts` — the shared name normaliser used by availability, importers and the merge.
- `src/routes/_authenticated/gameday.tsx` — the cross-league page, plus a Live tab wired into `league.$leagueId.tsx`.
- Server functions `getGameDay` and `refreshLiveScoring` in `src/lib/fantasy.functions.ts`.

**Touched.** `rosters.server.ts` and `waivers.server.ts` switch to normalised matching; `sleeper.server.ts` / `espn.server.ts` / `yahoo.server.ts` / `persist.server.ts` resolve players through the same normaliser.

## Out of scope

- Play-by-play descriptions richer than what the stat delta supports (we say "receiving TD, 1 rec, 32 yds", not a narrated play call).
- Live scoring for FFPC/NFL.com rosters beyond the players we can match to Sleeper IDs.
- Push notifications.
