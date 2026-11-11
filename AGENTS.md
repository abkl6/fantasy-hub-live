<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Performance rules

- Read the full players table through `loadAllPlayers` (src/lib/fantasy/shared-data.server.ts), never a fresh paged download — it is shared reference data and one short-lived copy serves every caller.
- League cache keys come from the `league_inputs_digest` database function (content of settings, rosters, standings, results), never from sync timestamps — a sync that brings nothing new must keep stored results valid.
- Screens read stored results through `cachedOrStale`: unchanged inputs past expiry are shown at once and rebuilt in the background; only changed inputs build while the member waits.
- Queue background work only through the `enqueue_compute_jobs` function — members cannot insert into compute_jobs, and it skips jobs already waiting.
- Cross-league builders (This Week, waivers hub, strip, lineup check, hub, Game Day) take an explicit `userId` and filter leagues by it — the worker's client and admins can read every member's leagues.
- Slow external refreshes (Sleeper sync) never block a page load; the page asks for them separately after it renders.
