# Why Bowers is $19 and Rodriguez is $95 — and the fix

## What's actually wrong

Two separate problems stack up on the CHOP Mingos - 1 waiver board.

**1. All nine FFPC leagues are being scored with no points for catches.**
When those leagues were imported, the FFPC rules page didn't parse, so the app
saved the scoring as "standard" (0 per reception) with no rules at all. Checked
in the database: every FFPC league, including $35 Chop Classic #113758, is
stored that way.

That single setting explains the example. Brock Bowers is a catch-heavy tight
end, so under no-PPR scoring his week drops to roughly half of what it should
be — under 5 points a week. Chris Rodriguez Jr. is a runner, so he barely
loses anything. The bid rules treat anyone under 5 points a week as a lottery
ticket capped at 3% of the budget, which is exactly the $19. Rodriguez keeps
his points, happens to be the best running back left on the wire, and prices
near the top of the scale at $95.

This is not just a bid problem: wrong scoring also warps lineup advice,
survival odds and every ranking in those nine leagues.

**2. The bid number is calculated from something other than the ranking.**
Today the price is a share of "the best free agent at that position," so a
mediocre back on a barren running back wire prices like a star, while a genuine
stud at a deep position gets a discount. The list order (survival impact in chop
leagues, title impact elsewhere) never feeds the price at all, so the top-ranked
player can carry the lowest bid.

## The fix

### Scoring

- Set FFPC leagues to 1 point per catch, 1.5 per catch for tight ends,
  4-point passing touchdowns, 6-point rushing/receiving touchdowns, 1 point per
  25 passing yards, 1 per 10 rushing/receiving yards, -2 for interceptions and
  lost fumbles.
- Make that the FFPC default when the rules page can't be read, instead of
  silently falling back to no-PPR — and flag on the league page when scoring
  was assumed rather than read, with an edit link.
- Repair the nine existing FFPC leagues and clear their stored results so every
  page rebuilds with correct points.

### Bid math

Rebuild the price so it comes from the same number that orders the board:

- Start from what the player is worth to *you* — the simulated gain (survival
  odds in a chop league, title odds elsewhere) plus points added to your best
  lineup — scaled to your remaining budget.
- Blend in what rivals can pay for him: in chop leagues the existing survival
  bidding math already prices the most desperate rival who still has money; keep
  that as the competitive floor.
- Keep the sanity caps (budget reserve, minimum bids for streamed positions,
  never more than half the budget), but drop the flat "under 5 points = 3% of
  budget" cliff and the position-relative share that caused the inversion.
- Guarantee ordering: within a board, a higher-ranked player can never carry a
  lower recommended bid than someone below him.
- Passive and aggressive stay at ±30% of the recommendation.

## Technical notes

- `src/lib/fantasy/ffpc.server.ts`: `scoringType` fallback becomes the FFPC
  preset rather than `standard`; add a `te_premium_4ptpass` preset (or explicit
  rules object) in `scoring.ts` and record `settings_source.scoring = "assumed"`
  when the rules page was unrecognised.
- Migration: update `scoring_type` / `scoring_rules` for the nine FFPC leagues
  and delete their `analysis_cache` rows.
- `src/lib/fantasy/waiver-rank.ts`: replace `bidRecommendation`'s
  `bestAtPositionPerWeek` share model with an impact-driven valuation taking
  `{ budget, remaining, impactScore, lineupGain, rivalFloor, winningBids }`;
  keep `applyBidRules` and `paceBid` as the only downward adjustments; add a
  monotonicity pass over the ranked rows.
- `src/lib/fantasy/waivers.server.ts` and `waiver-hub.server.ts` pass the
  already-computed survival/title delta into the bid call.
- Tests: FFPC default scoring, Bowers-vs-Rodriguez style fixture asserting the
  higher-impact player prices higher, existing streamed-position and reserve
  rules still hold.
