# Keep rosters and FAAB current after waivers run

## What I found (checked against your live data)

Your leagues are **not** picking up Wednesday's waiver results automatically:

- Every FFPC league still shows data from **Sept 16**, even though the 6am refresh was triggered on time this morning.
- The reason: the scheduled refresh is being turned away with "Unauthorized". Two jobs (live scoring and the background worker) were given a second way to identify themselves and work fine; the FFPC refresh, injury feed, weekly results, odds and market-value jobs were never given it, so every one of their runs has been rejected.
- Your two Sleeper leagues do update, but only when you open the app (and only if the last read was over 10 minutes old).
- FFPC budgets: only **your own** remaining FAAB is read. Rivals' budgets are blank, so bid advice can't tell what others can afford.
- Winning-bid history is empty (0 rows). FFPC's transaction page is already read and includes bid amounts, but nothing is ever saved from it.

## The fix

1. **Make every scheduled job accept the same key.** Move the dual-key check into the shared cron helper so all scheduled jobs use it. This alone restores the daily 6am and Sunday 11am FFPC refresh — rosters, records, standings and your FAAB will reflect waivers the morning after they run.
2. **Read every team's remaining budget** from the FFPC pages where it is shown, instead of only yours; where a team's number isn't published, derive it from the league budget minus that team's recorded winning bids.
3. **Save winning bids.** Store each waiver claim from the transaction page (week, team, player, amount) with a dedupe key so repeated reads don't double-count. This fills in spent/remaining per team and gives bid suggestions real market prices from your own league.
4. **Refresh Sleeper on a schedule too**, in the same daily pass, so those leagues are current before you open the app rather than because you did.
5. **After each refresh**, the existing rebuild queue already recomputes the waiver board and odds — no change needed, but I'll confirm the cached pages clear so nothing stale shows.
6. **Make staleness visible:** the admin Overview gains a row per league showing when it last refreshed successfully and a count of rejected scheduled runs, so a silent failure like this one is caught immediately instead of weeks later.
7. **Backfill now:** run one full refresh across all leagues as soon as the fix lands, so this week's waiver results appear right away.

## Technical notes

- `src/integrations/supabase/cron-auth.ts` is generated, so the dual-key fallback (platform secret, else `cron_keys` token) goes into a small local wrapper used by every route under `src/routes/api/public/cron/*`; the duplicated inline checks in `live-scoring.ts` and `compute.ts` collapse into it.
- FFPC: extend the roster/standings parse for a per-team FAAB column; `applyFfpcBundle` starts consuming `bundle.transactions` and upserts into `faab_bids` on a dedupe key, then writes `teams.faab_spent` / `faab_remaining` from parsed values first, recorded bids second.
- Sleeper already reports `waiver_budget_used` per roster, so its FAAB is correct once the daily pass calls `refreshSleeperLeague`.
- Small migration: unique index on `faab_bids` (league_id, week, player_name, amount, team_id) for idempotent upserts.

## Validation

- Confirm the scheduled FFPC run returns success and that `last_synced_at` moves to today for all nine FFPC leagues.
- Check a chop league: rosters match the FFPC site after waivers, every team shows a remaining budget, and past winning bids appear.
- Tests: cron auth accepts both keys and rejects a wrong one; transaction rows map to bid records without duplicates on a repeat read; per-team FAAB parsing against a saved FFPC page.
