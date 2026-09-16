# Faster still: component caches, a job queue, and leaner payloads

Today a page load either hits one big stored result or rebuilds everything. This splits the stored results into parts, moves the heavy simulations to a background worker, and sends each screen only what it draws.

## What changes for you

- Changing one thing (a roster move, a scoring tweak) only rebuilds the parts that depend on it, instead of the whole league page.
- Waiver and trade impact numbers are ready before you open the page: after every sync the top 30 free agents and top 20 trade targets are scored in the background.
- Pages never wait on a simulation. They read the last stored result and show "updated 4 min ago". The background worker refreshes after each sync and every 5 minutes while games are on.
- Game Day shows the matchup summaries straight away; the player rows load when you open a card.
- The admin Overview gains per-stage timings so a slow step is visible.

## Component caches

Replace the four coarse kinds with fine-grained ones, each with its own hash so a change invalidates only what it touches:

| kind | scope | hash inputs |
|---|---|---|
| `lineup` | one team | that team's roster rows + slots + projection source + week |
| `distribution` | one team | same as `lineup` + volatility/correlation inputs |
| `schedule` | league | matchups rows + team list |
| `sim` | league | all team distribution hashes + schedule hash + playoff settings |
| `this-week` | user | per-league component hashes |
| `impact` | league + candidate | league sim hash + candidate key |

`cache.server.ts` gains `componentHash(supabase, leagueId)` returning `{ teams: Map<teamId, hash>, schedule, sim, league }`, built from one query set per league (roster_spots max(updated_at)+count per team, matchups max(updated_at)+count, league settings, latest actuals week). `cached()` stays as-is; `analysis_cache.kind` accepts the new values and `inputs_hash` carries the team id as suffix.

`buildAnalysis` is refactored so the per-team lineup/distribution step and the simulation step are separately callable and separately cached; the assembled payload is still cached under `analysis` keyed on the combination, so one unchanged team's work is reused.

## Job queue

New `compute_jobs` table: `user_id`, `league_id`, `kind`, `priority`, `status` (`queued`/`running`/`done`/`failed`), `attempts`, `error`, `run_after`, timestamps. Unique on `(user_id, league_id, kind)` while queued so a job is never duplicated.

- `enqueueLeagueJobs(userId, leagueId)` replaces the direct `warmLeagueCache` call after Sleeper/FFPC/manual sync and after a live poll in a game window.
- New route `src/routes/api/public/cron/compute.ts` (cron-secret protected, same pattern as live-scoring) claims up to N queued jobs, runs them with the admin client, writes results through `cached(..., force: true)`, and records `compute_ms` per stage.
- pg_cron: every 5 minutes, with the existing fallback-reviewed comment; the worker returns immediately when no jobs are queued.
- Server functions (`getAnalysis`, `getGameDay`, `getPlayoffPicture`, `getThisWeek`, waiver/trade impact) become read-only: they return the stored payload plus `computedAt` and `stale`. On a cache miss they enqueue the job and compute once inline so the first visit still works.
- `computedAt` surfaces in the existing `CacheStatus` component as "updated N min ago", with a Recompute button that enqueues at top priority.

## Precomputed impact

After each sync the worker queues `impact` jobs for the top 30 free agents (ranked by the cheap VOR pass) and the top 20 trade targets, each cached under kind `impact` with the candidate key. Waivers and Trade Finder read those rows; anything missing falls back to today's coarse-then-full two-stage path.

## Engine work

In `simulateSeason`:
- Preallocate `Float64Array` buffers for weekly draws, season totals and points-for, and reuse them across iterations instead of allocating per iteration; same for the seeding scratch arrays.
- New `config.focusTeam`: when only that team's odds are requested, skip the bracket simulation for iterations where the focus team misses the playoff field.
- A test asserts byte-identical output for a fixed seed before and after both changes (golden values captured from the current implementation and committed).

## Shared per-request loading

New `src/lib/fantasy/context.server.ts` exporting `loadComputeContext(supabase, { season, week })` which fetches projections, trade values, NFL schedule and injury status once and returns lookup maps. `buildAnalysis`, `buildGameDay`, `buildThisWeek`, waivers and trade finder accept an optional context and only load what is missing. The worker builds one context per run and passes it to every league.

## Leaner payloads

- Each server function projects only the fields its screen renders; the shared analysis payload is split so waiver/trade/buy-sell blocks are fetched by their own tab rather than shipped with the first load.
- `getGameDay` gains a `summariesOnly` mode returning matchup headers (teams, scores, projected finals, win probability) without player rows; `GameDayBoard` fetches a card's player rows on expand and caches them client-side.

## Timings

Each stage writes `compute_ms` with its kind; `getAdminOverview` groups by kind as it does now, and the Overview panel gains queue depth, failed jobs and last worker run.

## Tests

- Changing one team's roster invalidates that team's `lineup`/`distribution` and the league `sim`, but not the other teams' components.
- Fixed-seed `simulateSeason` output is unchanged by the typed-array and focus-team changes.
- A queued job is not duplicated by a second sync; a failed job retries and then marks failed.
- A cached `impact` row is served without calling `simulateSeason`.
