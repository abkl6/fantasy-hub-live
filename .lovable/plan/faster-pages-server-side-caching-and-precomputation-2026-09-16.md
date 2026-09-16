# Faster pages: server-side caching and precomputation

Today every league page load recomputes everything from scratch — rosters, projections, thousands of simulated seasons — inside the request. This makes the app read from a stored result instead, and does the heavy work in the background after a sync or a live refresh.

## What changes for you

- League pages, Game Day, the playoff picture and This week load from a stored result, so they appear quickly instead of waiting on a full recalculation.
- A **Recompute** button on every league page clears that league's stored result and rebuilds it on the spot.
- Stored results are thrown away after 15 minutes anyway (5 minutes while games are being played), so nothing goes stale.
- Waiver and trade candidates get a fast first pass, and only the handful actually shown to you get the full-accuracy treatment — same answers at the top, far less waiting.
- The admin Overview gains a panel showing how long each kind of calculation takes, so slowdowns are visible.

## Storage

New `analysis_cache` table: `league_id` (nullable, for the cross-league This week list), `user_id`, `kind`, `inputs_hash`, `payload`, `compute_ms`, `computed_at`, `expires_at`. Unique on `(user_id, league_id, kind, inputs_hash)`. Owner-only access; service role full. Indexed on `(user_id, league_id, kind)`.

## Technical approach

**1. Cache wrapper.** New `src/lib/fantasy/cache.server.ts` exporting `cached(supabase, {userId, leagueId, kind, ttlMs}, hashParts, compute)`. It hashes the inputs, reads the row, returns the payload when the hash matches and `expires_at` is in the future, otherwise runs `compute`, times it, and upserts. TTL defaults to 15 min, 5 min when `gameWindow(now).live`.

Inputs hash is built from: max `roster_spots.created_at` + row count per league, `projection_source`, a stable stringify of `scoring_rules` + `roster_slots` + `sos_adjust` + `class_override`, `current_week`, and the newest `player_week_stats.week` for the season. One small query per league gathers these.

Wrapped kinds: `analysis` (`buildAnalysis`), `gameday` (`buildGameDay` per league), `playoff` (`loadPlayoffPicture`), `this-week` (`buildThisWeek`, league-less row keyed on the combined hash of every league).

**2. Background precompute.** New `warmLeagueCache(supabase, userId, leagueId)` that recomputes all four kinds and stores them. Called after `refreshSleeperLeague` / FFPC sync / roster sync completes, and at the end of `refreshLiveScoring` for leagues in a live window. Failures are swallowed — a cold cache just means the next page load computes normally.

**3. Two-stage simulation.** `recommendationImpact` gains an `iterations` pass-through already present; waivers and Trade Finder change to rank all candidates at 300 iterations, then re-run the top five at 1,500 for the displayed numbers. Per-candidate results are cached in `analysis_cache` under kind `impact` with the league's inputs hash plus a candidate key, so repeat page loads skip the sim entirely.

**4. Code splitting.** Authenticated route components move to `React.lazy` + `Suspense` inside each route file (heaviest first: `league.$leagueId`, `admin`, `projections`, `gameday`). Note: `recharts` is currently imported only by the unused `src/components/ui/chart.tsx`; every chart in the app is hand-drawn SVG. That file gets removed rather than lazy-loaded, which drops recharts from the bundle entirely.

**5. Timing panel.** `getAdminOverview` returns the last 50 `analysis_cache` rows grouped by kind with median and worst `compute_ms` plus hit rate; the Overview tab renders it as a small table.

**6. Recompute action.** A server function `clearLeagueCache({leagueId})` deletes that league's rows and the This week row, then the page refetches. Button sits in the league page header next to the existing refresh.

## Tests

- Second `getAnalysis` call with unchanged inputs does not call `simulateSeason` (spy on the engine, assert one call across two invocations).
- Hash changes when scoring rules, projection source, or the latest actuals week change.
- Expired entry recomputes even when the hash matches.
- Top-five candidates are re-simulated at 1,500 iterations while the rest stay at 300.
