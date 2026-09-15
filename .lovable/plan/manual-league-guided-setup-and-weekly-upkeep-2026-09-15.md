# Manual league: guided setup and weekly upkeep

Replaces today's two-step "Screenshot or manual" panel with a proper manual league experience: a four-step setup wizard, a weekly upkeep loop, and a clear signal of how current each manual league's data is.

## 1. Setup wizard (four steps)

**Step 1 — League basics**
Name, number of teams, playoff teams, regular season length, current week, format, starting slots, and scoring. Extras:
- FFPC presets (TE-premium scoring and the standard FFPC starting lineup) selectable in one tap.
- "Copy scoring from an existing league" — pick any league already connected and pull its scoring rules and slots across.
- The existing screenshot read of a scoring page stays available.

**Step 2 — Draft board**
Import every team's roster at once from pasted text, a CSV, or screenshots. The importer figures out which team each pick belongs to (snake order for a plain pick list, or by team column/heading). Anything it can't confidently match goes to a review list where each name can be linked to the right player or skipped, using the same matching rules as the rest of the app.

**Step 3 — Schedule**
Either paste/upload the league schedule, or auto-generate a standard round robin over the regular season weeks. A preview grid shows the weeks before saving.

**Step 4 — My team**
Pick which team is mine from the imported list, then finish. The league is stored with platform `manual` and lands on its league page.

Existing manual leagues keep working; nothing is migrated away.

## 2. Weekly upkeep

- **Wednesday reminder** on This Week: paste or upload the league's transaction log. Adds, drops and trades are applied to the tracked rosters; entries already seen (same date, same players) are ignored, so pasting the whole log again is safe.
- **Saturday reminder**: confirm my lineup for the week. The form comes pre-filled with the best lineup under the league's scoring, so confirming is one tap.
- **Opponent lineups** default to their best lineup under league scoring and carry an "est." label everywhere they appear. Each opponent has an optional paste box for their actual lineup, which replaces the estimate for that week.
- **Reconcile** action on the league page: paste or screenshot a full roster listing, see a diff against what's tracked (added, dropped, moved), and apply what's confirmed.

## 3. Freshness badge

Every manual league shows one of three states next to its name, on the league page and in the Hub:
- **Synced** — rosters confirmed within the last 3 days.
- **Tracking** — confirmed within 10 days, or updated from a transaction log since.
- **Stale** — nothing confirmed for over 10 days; the badge links to Reconcile.

## Technical notes

- Migration: `manual_transactions` (league, date, kind, player, from/to team, dedupe key with a unique index), `manual_lineups` (league, team, week, confirmed flag, slots jsonb) and `leagues.last_confirmed_at`. Grants + own-rows RLS on both, per the public-schema grant rule.
- `src/lib/fantasy/manual.server.ts`: `parseDraftBoard` (text/CSV, snake or team-grouped), `parseTransactionLog`, `parseRosterPaste`, `reconcileRoster` (diff vs `roster_spots`), `generateSchedule` (round robin into `matchups`), `freshnessOf(league)`. Name matching goes through `normalizeName`/`playerKey`; unresolved rows land in `unmatched_players` and reuse the existing review UI.
- `readScreenshot` gains `draft`, `schedule` and `transactions` modes alongside `roster`/`scoring`.
- New server fns in `src/lib/fantasy.functions.ts`: `createManualLeagueFull`, `importDraftBoardFn`, `importScheduleFn`, `saveManualLineupFn`, `importTransactionsFn`, `reconcileRosterFn`.
- Estimated opponent lineups keep using `roster_spots.is_auto`; the "est." label reads from that flag, so no new state is needed for it.
- `ManualPanel` in `connect.tsx` is rewritten as a four-step wizard; This Week gains the two reminder rows through `this-week.server.ts` (day-of-week gated, one row per manual league).
