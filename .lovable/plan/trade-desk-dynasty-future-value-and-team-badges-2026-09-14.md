# Trade Desk, Dynasty Future Value, and team badges

## 1. Trade Desk (new page + inside each league)

A real trade builder, replacing today's two text boxes.

- New page **Trade Desk** in the top nav. Pick a league, then pick the two teams — any two teams in the league, not just yours.
- Each side gets a searchable picker for **players and future draft picks** from that team's actual roster and pick inventory. Click to add, click to remove.
- The league's Trade tab shows the same builder inline, pre-set to your team.

### What a proposal shows

- **Value** — Keep Trade Cut market total for each side, the gap, and a fairness read ("fair both ways", "tilts to Team A").
- **Likelihood of acceptance** — a 0–100% read with a plain-language reason ("They're rebuilding and this sends them a first — likely", "Costs them their best starter while they're chasing a bye — unlikely").
- **Impact on both teams** — playoff chance and championship chance before/after for each side, plus weekly points change. Both teams' seasons are re-simulated, not just yours.
- **Dynasty leagues also show** — each team's Dynasty Future Value before and after, their rank in the league, and the swing.
- Save as an idea, mark as completed, or copy the offer as text (already supported by trade history).

### How likelihood is calculated

Blend of: market value gap, the other team's playoff/title swing, and team-type fit — a win-now team weights this season's odds, a rebuilding team weights dynasty value and picks. Shown as a band (Very likely / Likely / Coin flip / Unlikely / Long shot) so it never reads as a guarantee.

## 2. Dynasty Future Value (DFV)

For dynasty and keeper leagues only:

- DFV = the market value of everything a team owns: every rostered player plus every future draft pick, in the league's format (superflex or one-QB).
- Shown on the league page as a ranked table of all teams with a bar chart, each team's total, and how far above/below league average they are.
- Each team's DFV rank feeds the badges and the trade impact.

## 3. Team quality badges

Every team gets one badge, computed from championship odds, playoff odds, projected weekly points, and (dynasty) DFV rank.

**All leagues**
- **Top Seed** — best title odds in the league
- **Contender** — strong playoff odds
- **League Filler** — in the middle, unlikely to matter
- **Bottom Feeder** — bottom of the league

**Dynasty/keeper adds** (checked in this order, first match wins)
- **Dynasty King** — win-now and the league's best dynasty value
- **Dynasty Contender** — win-now and top-4 dynasty value
- **Win-Now** — built to win this year, future is thin
- **Future Star** — not winning now, top-4 dynasty value
- **Donator** — not winning now, bottom-5 dynasty value
- **Eternal Mediocrity** — not winning now, not building either

Badges appear in: league standings and team lists, Game Day matchup rows (you and your opponent), Manager Hub league cards, and both sides of a proposed trade. Hovering explains why a team got that badge.

## 4. Other suggestions

Worth adding alongside this — say which you want:

1. **Counter-offer builder** — when a proposal is lopsided, auto-suggest the piece that makes it fair.
2. **"What they'd say yes to"** — given a player you want, the app builds the cheapest package that team would likely accept.
3. **Trade block** — mark your own players as available; the app then targets them in cross-league suggestions.
4. **Dynasty value trend** — a week-by-week chart of your DFV so you can see whether you're gaining or bleeding future value.
5. **Value movement alerts** — a nudge when a player you own or target jumps or drops sharply on the market.

## Technical notes

- `src/lib/fantasy/team-class.ts` — shared classifier taking `{ titleOdds, playoffOdds, projPointsRank, dynastyRank, teamCount, isDynasty }` and returning `{ badge, tone, reason }`. Unit-tested.
- `src/lib/fantasy/dynasty-value.ts` — `teamDynastyValue(roster, picks, book)` and `leagueDynastyValues(...)`, built on the existing `loadTradeValues` / `pickLabel` from `trade-value.ts`. All name matching goes through `normalizeName`/`playerKey`.
- `analysis.server.ts` — `AnalysisPayload` gains `dynastyValues` (per team: total, rank, vs average) and each standings row gains `badge`. Extract the current one-team `whatIf` into a reusable two-team simulator so a trade can be scored for both sides in one `simulateSeason` pass.
- New `src/lib/fantasy/proposal.server.ts` — `evaluateProposal(supabase, { leagueId, teamA, teamB, assetsA, assetsB })` returning per-side value, DFV before/after, odds before/after, fairness, and an acceptance score; exposed via `evaluateProposalFn` in a new `src/lib/proposal.functions.ts` (auth middleware; league ownership checked).
- New route `src/routes/_authenticated/trade-desk.tsx` with its own `head()` metadata; `TradeBuilder` extracted to `src/components/TradeBuilder.tsx` and reused in `league.$leagueId.tsx`'s Trade tab (replacing `TradePanel`). `TeamBadge` in `src/components/TeamBadge.tsx`, used by standings, `GameDayBoard`, `manager-hub`, and the builder.
- Acceptance model lives in `proposal.server.ts` as a pure scoring function so it can be unit-tested; no schema changes are needed — picks, values, and snapshots already exist.
