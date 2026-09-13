# League format and scoring-aware analysis

## Where things stand today

Honest answer to the question, based on the current code:

- **Roster setup: yes.** Every league stores its own starting slots, and the lineup optimizer, position grades, waiver board and trade math all respect them — including superflex, two-QB, extra flex, and no-kicker setups. Imported leagues bring their real slots across from Sleeper, ESPN and Yahoo.
- **Scoring settings: stored, not used.** Each league's scoring rules are saved on import, but every player's projection comes from one league-agnostic number. A tight-end-premium, half-PPR, 6-point-passing-TD or big-bonus league currently gets the same projections as a standard PPR league.
- **League type: not tracked at all.** There is no dynasty / redraft / keeper / guillotine distinction, so advice is always "win this season with a full waiver wire", which is wrong for two of those formats.

This plan closes both gaps.

## What you will get

**League format on every league**

A format setting — Redraft, Keeper, Dynasty, Guillotine, Best Ball — detected automatically on import where the platform exposes it, and editable by hand. It changes the advice:

- **Redraft** — as today: win now, championship odds drive everything.
- **Keeper / Dynasty** — each player also gets a long-term value based on age and position curve. Trade and waiver advice shows both "helps you this year" and "helps you in future years", and flags win-now trades that mortgage the future. Draft grades judge picks on long-term value, not just this season.
- **Guillotine** — the goal is survival, not a title. The odds card switches to "chance of surviving this week" and "weeks you are projected to last", and the board highlights the lowest-scoring team each week. Waiver advice prioritises this week's floor over rest-of-season upside.
- **Best Ball** — no start/sit advice (there are no lineup decisions); grades and waiver value are computed on expected best-ball output instead of an optimal manual lineup.

**Scoring-aware projections**

Every projection gets recalculated against your league's own scoring rules, so:

- Half-PPR and standard leagues rank running backs and pass-catching backs differently from PPR.
- TE-premium correctly lifts tight ends.
- 6-point passing TDs and per-yard bonuses lift quarterbacks.
- Superflex leagues already start two quarterbacks; now the quarterbacks are also valued accordingly.

A small line on the league page states which scoring profile is in use, so you can tell at a glance the analysis matched your league.

**Format-aware advice everywhere**

Start/sit, waiver bids, trade evaluation, position grades and draft recap all read the format and scoring, so the same player can be a strong add in one of your leagues and a pass in another.

## Technical approach

**Database**

- `leagues`: add `format text not null default 'redraft'` (redraft | keeper | dynasty | guillotine | best_ball).
- `players`: add projected stat components so scoring rules can be applied — `stat_projections jsonb` (pass_yd, pass_td, int, rush_yd, rush_td, rec, rec_yd, rec_td, fum, plus kicker/defense buckets) and `age numeric`, `years_exp integer` for dynasty value. Backfill from Sleeper's player and projection data.
- Grants and RLS unchanged (both tables already covered).

**Scoring engine** — new `src/lib/fantasy/scoring.ts` (pure):
- `scorePlayer(stats, rules)` applies a league's `scoring_rules` to the stat components; falls back to the stored `proj_points_week` / `proj_points_season` when a player has no component breakdown.
- `normalizeRules(scoringType, scoringRules)` fills defaults for the three preset types so manual leagues work without full rule sets.

**Format engine** — new `src/lib/fantasy/format.ts` (pure):
- `dynastyValue(player, seasonProj)` — age/position decay curve producing a 0–100 long-term score.
- `blendedValue(format, seasonProj, dynastyValue)` — weights win-now vs future by format.
- Guillotine helpers: `survivalOdds(teamDist, leagueDists, weeksLeft)` via the existing Monte Carlo distributions, replacing playoff/title odds for that format.
- Best-ball expectation: expected max over correlated draws rather than `optimalLineup`.

**Wiring**
- `analysis.server.ts`: resolve per-league projections through `scorePlayer` once, at load, so every downstream consumer (lineup, grades, suggestions, simulation, snapshots) uses league-correct numbers. Branch odds computation on format (playoff/title vs survival) and skip start/sit suggestions for best ball.
- `waivers.server.ts`: trade value and FAAB bid use the league-scored season projection; dynasty/keeper rows add a long-term value column.
- `analysis.server.ts` trade math and `trade_history` verdicts gain a future-value note for dynasty/keeper.
- Importers (`sleeper.server.ts`, `espn.server.ts`, `yahoo.server.ts`, `persist.server.ts`): detect format where available (Sleeper `settings.type` 2 = dynasty/keeper, best-ball flag; ESPN keeper settings) and persist it.
- `connect.tsx` manual form and league settings: format selector.
- `league.$leagueId.tsx`: format badge and scoring profile line in the header; odds card, waiver columns and tab set adapt to format.

## Out of scope

- Trading future draft picks (dynasty pick valuation) — player value only for now.
- Auction-budget-specific valuations.
