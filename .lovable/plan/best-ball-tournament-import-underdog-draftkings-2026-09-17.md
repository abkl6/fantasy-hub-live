# Best ball tournament import (Underdog & DraftKings)

## What you'll get

Two new options on Add a league — **Underdog** and **DraftKings** — that take the CSV of entries you export from each site. Each tournament becomes its own best-ball entry group in the app, with a new **Entries** tab showing every draft you have in it, its weekly and running score, and where it ranks among your own entries.

## Import

- Upload one or more CSV files. The reader detects the site from the headers and shows a preview: tournament name, number of entries, players matched, and any names it couldn't find, before you save.
- One entry per draft: tournament name, entry ID, draft slot, and the full roster.
- A league record is created per tournament with format "best ball", total-points contest, and the site's own settings:
  - Underdog: half point per catch, 4-point passing TDs, 1 QB / 2 RB / 3 WR / 1 TE / 1 FLEX.
  - DraftKings: full point per catch, 4-point passing TDs, their 100-yard rushing/receiving and 300-yard passing bonuses, same lineup shape.
- Re-importing the same tournament replaces its entries entirely.

## Scores

- Each week, an entry's score is the best valid lineup from that week's actual stats, scored with the tournament's rules.
- Weeks not yet played use projections the same way.
- Running total through Week 14 is the round-one total shown on the Entries tab.

## Where entries show up

- **Entries tab**: every entry with weekly scores, cumulative score, and rank among your entries in that tournament.
- **Exposure**: best-ball players merge into the existing exposure list — number of entries, percent of entries, and share of your total projected points, alongside your managed leagues.
- **Games**: best-ball players appear under their NFL game like your other players.

## What's hidden for these leagues

Lineup check, Waivers, Trade Finder, This Week items, and playoff/title odds are all hidden for best-ball tournaments — there are no decisions to make there. No advance-rate estimates in this version.

## Technical notes

- New tables: `bestball_entries` (league_id, entry_id, tournament, draft_slot) and `bestball_entry_players` (entry_id, player_id, player_name, position, nfl_team), both user-scoped with RLS and grants; tournaments reuse `leagues` with `platform` = `underdog` / `draftkings`, `format` = `best_ball`, `contest_format` = `points`.
- Scoring presets `underdog` and `draftkings` added to `src/lib/fantasy/scoring.ts` (DK bonuses via existing bonus keys).
- Parsing in a new `src/lib/fantasy/bestball-parse.ts` (pure, tested with fixtures) with tolerant header matching; server work in `bestball.server.ts` + `bestball.functions.ts`; player matching through the existing `playerIndex`/`normalizeName` path.
- Weekly best-ball scores computed from `player_week_stats` (actuals) and projections via the existing `optimalLineup`, cached per league in `analysis_cache`.
- Gating keyed off `format === 'best_ball'` in the league page tabs, This Week, and the cross-league waiver/trade surfaces.

## Verification

Fixture tests for both CSV shapes, best-ball weekly scoring under both rule sets, and exposure merging; then typecheck, full test suite, and a browser pass over Connect, Entries, Exposure and Games.

## One thing I need

I've written the reader to accept the usual column names, but a real export from each site makes it exact. If you can attach one Underdog and one DraftKings entries CSV, I'll lock the parsing to them.
