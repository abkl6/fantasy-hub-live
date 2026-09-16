# Dynasty value works the same in every league

## What I found

I opened your FFPC league and your Sleeper leagues and checked the data behind them.

- The dynasty sections do appear on the FFPC league, but every player reads "age unknown · Future 0 · Overall 0", so there is nothing useful to look at.
- The cause is not the platform. Every player record in the app has a blank age (0 of 1,780 have one), and all season projections are currently empty because the old uploads were cleared. The long-term score is built only from age plus season projection, so it collapses to zero — on Sleeper leagues too.
- Meanwhile the market values that power team dynasty totals are present and cover your rosters well (about 85-95% of players in each league, including FFPC), and those same records carry an age for every player in them.
- Two smaller gaps: no league of any platform currently has future draft picks stored, so pick value counts as zero everywhere; and a league marked both dynasty and guillotine loses its dynasty features, because the guillotine setting overwrites the internal format switch the dynasty checks read.

## What I'll change

1. **Long-term value uses the market first.** A player's future value comes from the dynasty market price (the same source already used for team dynasty totals), scaled 0-100 against the top player in the league, then adjusted by the age curve. Only when a player has no market price does it fall back to today's projection. This makes FFPC, Yahoo, ESPN and manual leagues produce the same numbers as Sleeper, and it keeps working while projections are empty.
2. **Fill in ages.** Copy each player's age from the market data onto the player record, both as a one-off backfill and on every scheduled market refresh, so the age column and the age curve stop reading "age unknown".
3. **Dynasty switched on by league type, not the old format field.** The dynasty checks will read the league's type and variant (dynasty / keeper / empire), so a dynasty guillotine league and any imported or manually created dynasty league show pick values, the long-term list, the dynasty column in Hub standings and dynasty deltas in trade ideas — exactly as Sleeper does.
4. **Default future pick inventory.** For dynasty, keeper and empire leagues with no stored picks, assume each team owns its own picks for the next three seasons so pick value contributes to team dynasty totals; any picks a platform actually reports (FFPC portfolio, manual entry) override the assumption.

## Technical notes

- `src/lib/fantasy/dynasty-value.ts` / `format.ts`: add a market-first long-term score; `dynastyValue()` keeps the age curve but takes a market value as its primary input with the projection ratio as fallback.
- `src/lib/fantasy/analysis.server.ts`: replace `isMultiYear(format)` gating for the team dynasty totals and the `dynasty` rows with `showsPickValues(leagueType, variant)`; pass the trade-value book and KTC age into the per-player rows. Same swap for `isDynasty` in `manager.server.ts`.
- Age backfill: migration updating `players.age` / `years_exp` from `player_trade_values` matched on `norm_player_name`, plus the same upsert inside `ktc.server.ts` so refreshes keep it current.
- Default picks: synthesised in `analysis.server.ts` / `proposal.server.ts` when `team_draft_picks` has no rows for the league, priced from `pick_values`; nothing written to the database.
- Verify with typecheck, vitest, the player-name guard, and a browser pass over the FFPC league, a Sleeper league and Manager Hub.

Not included: importing Sleeper traded future picks (Sleeper exposes them, but none are stored today) — say the word and I'll add it.
