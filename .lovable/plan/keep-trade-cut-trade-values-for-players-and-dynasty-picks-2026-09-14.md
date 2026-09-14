# Keep Trade Cut trade values for players and dynasty picks

Today trade suggestions are built only from weekly projections: the app swaps a surplus starter for another team's player at your weak spot. There is no concept of what a player is actually worth in a dynasty market, and draft picks don't exist at all. This adds a real value currency.

## What you get

- Every player carries a dynasty trade value in both 1QB and Superflex flavours; each league automatically uses the one matching its lineup.
- Future draft picks (2027 1st, 2028 2nd, and so on, split early/mid/late) carry values too, and each team's pick inventory is tracked per league.
- Trade suggestions become balanced two-sided offers: they can include picks on either side and show a fairness read ("you give 6,100, you get 5,850 — slightly in their favour") alongside the existing title/playoff odds impact.
- A values refresh runs automatically every Wednesday. Any player listed as IR also refreshes every 24 hours for the next three weeks, so injury crashes show up fast.
- Stats Hub gains a Trade Values tab: searchable value table, last-refresh time, a manual "Refresh now" button, and CSV upload as a backup if the automatic pull ever fails.
- Each league gets a Draft Picks panel where you set who owns which picks (defaults to every team owning its own picks for the next three years, then you adjust for trades).

## Sourcing note

Keep Trade Cut does not publish an official data feed, so the weekly refresh reads their public dynasty rankings pages. That works today but is outside our control — if they change or block the page, the refresh logs a failure, keeps the last good values, and flags it in Stats Hub so you can upload a file instead. Nothing in the app goes blank.

## Technical detail

Database (one migration):
- `player_trade_values` — player_id (nullable), norm_name, position, `format` ('1qb' | 'sf'), value int, tier, overall_rank, position_rank, source, fetched_at. Unique on (norm_name, position, format). Matching to `players` goes through `norm_player_name` per the existing name rule.
- `pick_values` — season_offset (1..3), round, slot ('early'|'mid'|'late'|'unknown'), format, value. Unique on (season_offset, round, slot, format).
- `team_draft_picks` — league_id, team_id, user_id, season, round, slot, original_team_id, count. RLS scoped to `auth.uid()`; grants per the standard block. Values tables readable by authenticated, writable by admins only (`has_role`).
- `trade_value_refresh_log` — run_at, source, format, rows_upserted, status, error.

Fetching (`src/lib/fantasy/ktc.server.ts`):
- Parse the `playersArray` JSON embedded in the dynasty-rankings HTML for both `format=1` (1QB) and `format=2` (SF); map each entry to name/position/value/tier/rank. Picks arrive in the same payload as entries like "2027 Early 1st" and are routed into `pick_values`.
- Upsert by normalized name + position + format; write a refresh-log row; never delete existing values on failure.

Cron routes under `src/routes/api/public/cron/` using the existing `authenticateCronRequest` + `supabaseAdmin` pattern:
- `trade-values` — full refresh, scheduled Wednesdays.
- `trade-values-ir` — daily; refreshes only players whose status is IR (or that went IR within the last 21 days, tracked via a `ir_since` timestamp set when status flips).
- Both registered with `cron.schedule` against the stable project URL.

Valuation layer (`src/lib/fantasy/trade-value.ts`):
- `leagueValueFormat(league)` returns 'sf' when roster slots include SUPER_FLEX/OP, else '1qb'.
- `loadTradeValues(supabase, format)` returns lookups by player id and by `playerKey`, plus pick values; falls back to a projection-derived value when a player is missing so nothing scores zero.

Suggestions (`analysis.server.ts`):
- Candidate trades are generated as before from surplus vs. need, then balanced: the side that owes value adds the cheapest bench player or draft pick from its own inventory until the gap is within ~10%.
- Each suggestion carries `giveValue`, `getValue`, `fairness` and the asset list; `MoveSuggestion` gains those fields and `manager.server.ts` passes them through.

UI:
- `manager-hub.tsx` trade cards show give/get value chips and the fairness badge.
- `projections.tsx` (Stats Hub) gains the Trade Values tab with search, format toggle, refresh button, CSV upload, and last-refresh status.
- New `DraftPicks` panel on `league.$leagueId.tsx` for pick inventory editing, backed by `picks.functions.ts` (list/set/reset-to-default).

Verification: `bunx vitest run` (new tests for pick parsing and trade balancing), the name guard script, and `bunx tsc --noEmit`.
