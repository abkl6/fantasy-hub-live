# Fetch market values automatically when a league is imported

## Goal

A newly imported league should have dynasty and trade values right away, without waiting for the weekly refresh — and the import must never slow down or fail because of it.

## Behaviour

- At the end of every successful league import or first sync (Sleeper, ESPN, Yahoo, FFPC, manual), kick off a full market-value refresh in the background.
- It only runs when values are actually needed: no market values stored at all, or the most recent successful refresh is more than 24 hours old. Otherwise it is skipped silently.
- The import returns as soon as the league is saved. The refresh runs after the response and cannot delay it.
- If the refresh fails, the import still succeeds. The failure is recorded in the refresh log and shows up in the admin Errors tab.
- The weekly scheduled refresh stays exactly as it is.
- Changing a league's type still triggers the same check as a fallback, with the same 24-hour rule.
- While values are still being fetched, the league page shows "Loading market values…" where dynasty numbers normally sit, instead of zeros, and fills in the numbers once they arrive.

## Technical notes

- New helper in `src/lib/fantasy/ktc.server.ts`:
  - `tradeValuesFresh(admin)` — true when `player_trade_values` has rows and the newest `trade_value_refresh_log` row with `status = 'ok'` and `scope = 'full'` is under 24 hours old.
  - `ensureTradeValuesAfterImport(admin, ctx)` — runs the freshness check, then `refreshTradeValues(admin, 'full')`; wraps everything in try/catch and on failure writes a `job_errors` row (`source: 'trade-values'`, scope `import`) in addition to the failed `trade_value_refresh_log` row that `refreshTradeValues` already writes. Never throws.
- Single hook point: call it at the end of `persistBundle` in `src/lib/fantasy/persist.server.ts` (covers Sleeper, ESPN, Yahoo and FFPC through `platforms.functions.ts` and `ffpc.functions.ts`), plus the manual league creation path in `src/lib/manual.functions.ts`, which does not go through `persistBundle`.
- Fire-and-forget: the promise is started and not awaited by the import, with a `.catch()` guard so an unhandled rejection can never surface. Where the runtime exposes it, the pending promise is handed to the request's waitUntil-style background hook so the worker does not cut it short.
- Keep `refreshTradeValuesIfStale` and the cron routes untouched; the league-type-change path in `src/lib/fantasy.functions.ts` calls the same `ensureTradeValuesAfterImport` helper.
- Loading state: `src/lib/fantasy/analysis.server.ts` adds a `valuesPending` boolean to the analysis payload — true when the league needs dynasty values (dynasty / keeper / empire) but `player_trade_values` is empty. `src/routes/_authenticated/league.$leagueId.tsx` and the Hub dynasty column render "Loading market values…" when it is set; the existing cached-query refresh brings in the numbers on the next poll.

## Verification

Typecheck, vitest, the player-name guard, and a browser pass: import a league, confirm the import returns immediately, values land shortly after, and the league page swaps the loading text for real numbers.
