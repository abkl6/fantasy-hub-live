# Fix "Jr. / II / III" name mismatches for good

## What's wrong

Players whose names carry a generational suffix (Marvin Harrison Jr., Kenneth Walker III, Michael Pittman Jr.) get treated as two different people, because one feed writes the suffix and another doesn't.

There is already a shared name cleaner in the app (it lowercases, strips punctuation and drops the suffix), and the database has a matching one. The problem is that several parts of the app still compare names the raw way instead of going through it. Those are the places where duplicates show up: waiver wire availability, dynasty ages, injury/bye badges, injury status sync from Sleeper, manual roster entry, draft picks, starter highlighting, and the cross-league player exposure list.

## The fix

1. Route every remaining name comparison through the one shared cleaner, so there is a single definition of "same player" in the app:
   - waiver availability and the rostered-player set
   - dynasty age/experience lookup
   - player status, team and bye-week badges
   - Sleeper injury sync matching
   - manual roster entry, draft pick matching, starter highlighting
   - player exposure grouping in the Manager Hub

2. Harden the cleaner itself so it also handles cases the current one misses:
   - repeated or stacked suffixes ("Jr II")
   - suffixes written as "II"/"2nd" or with periods/commas ("Walker, III")
   - accents and hyphens (Amon-Ra St. Brown vs Amon Ra St Brown)
   - team defenses written several ways
   Update the database cleaner to match, and re-run the duplicate merge so any duplicates created since the last cleanup are folded together.

3. Prevent regressions rather than patching the next one by hand:
   - a small test file that locks in the tricky name pairs (Walker/Walker III, Harrison/Harrison Jr., St. Brown, defenses) so a future change can't silently break matching
   - a check that fails if new code compares player names with raw lowercase instead of the shared helper
   - the database already has a uniqueness rule on cleaned name + position; keep it and confirm it still holds after the merge

## Technical notes

- `src/lib/fantasy/names.ts` — extend `normalizeName` (loop-strip suffixes, unicode fold, drop `.`/`,`/`-`, map `2nd/3rd` → suffix), keep `playerKey`/`playerIndex` API unchanged.
- Replace raw `.trim().toLowerCase()` keys with `normalizeName`/`playerKey` in `analysis.server.ts` (lines ~182, 369, 466, 496), `sleeper.server.ts` (~104, 116), `fantasy.functions.ts` (~172, 210, 355–364, 490–495, 725–732, 893–897), `manager.server.ts` (~85).
- New migration: `CREATE OR REPLACE FUNCTION public.norm_player_name` with the same rules as the TS version, re-run the dup merge against `players` (remap `roster_spots`, `draft_picks`, `player_week_stats`, `player_projection_overrides`), then re-create `players_norm_name_position_key`.
- Tests with `bunx vitest run` over `src/lib/fantasy/names.test.ts`; add a `rg`-based guard script for raw name lowercasing.
