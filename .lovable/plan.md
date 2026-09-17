# Make the real Underdog exports import correctly

Short answer: not yet. All three files are genuine Underdog exports, but the reader expects older column names, so today each drafted player would become its own one-player entry and every roster would be wrong.

## What the three files actually contain

- File 1: 21 drafts, 20 picks each — "The Little Board" (20 drafts) and "The Big Board" (1)
- File 2: 5 drafts, 18 picks each — "The Pug", "The Corgi", "The Fast Puppy"
- File 3: 22 drafts, 18 picks each — all "Weekly Winners"

Only QB/RB/WR/TE are drafted, which already matches the best ball roster shape.

## What breaks

- The entry column is named `Draft Entry` and the draft column `Draft`; the reader only looks for `draft_entry_id` / `draft_id`. Result: no grouping — 420 separate "entries".
- The Weekly Winners file leaves `Tournament Title` blank and puts the name in `Weekly Winner Title`, so it would import as "Best ball tournament".
- There is no draft-slot column; slot is currently lost.
- Rosters of 20 picks (Big/Little Board) are as valid as 18; nothing should assume 18.

## Changes

1. Column names: accept `Draft Entry`, `Draft`, `Appearance`, and take the tournament name from the first non-empty of `Tournament Title`, `Draft Pool Title`, `Weekly Winner Title`.
2. Derive the draft slot from the entry's earliest pick number and `Draft Size` (slot = ((firstPick − 1) mod size) + 1), so entries still show a draft position.
3. Use `Draft Size` for the tournament's team count instead of counting my own entries.
4. Group one league per tournament title as today; a single file containing several tournaments creates several leagues, and re-importing a tournament replaces its entries.
5. Weekly Winners entries are scored week by week — show each week's score and rank, with no cumulative-through-week-14 total on that tournament (that total stays for the Board/Puppy tournaments).
6. Tests using these three real files: correct entry counts (21 / 5 / 22), correct rosters per entry, correct tournament names including the Weekly Winners case, and derived draft slots within 1..12.

## Verification

Import each of the three files in Connect → Underdog and confirm the tournament list, entry counts, roster sizes and weekly scores, then run the full test suite and typecheck.
