# Projections: admin baseline + personal adjustments

## Where projections come from today

Every player's weekly and season projection is a fixed number that was loaded once when the player list was first created (251 players, last touched 13 Sep). Nothing refreshes them. The only live piece is team, injury status and news from Sleeper. Each league then re-scores those numbers for its own scoring rules, but the underlying projection is the same for everybody.

## What we'll build

**1. A baseline projection set you control**

A new "Projections" page, visible only to your account:
- Searchable, sortable table of all players: name, position, team, bye, weekly points, season points.
- Edit weekly/season points inline; changes save as you go.
- Upload or paste a CSV to update many players at once (columns: player, position, week points, season points). Before anything is saved you see a preview: how many rows matched, which names didn't match, and what's changing.
- Name matching ignores Jr./III-style differences, so "Kenneth Walker III" and "Kenneth Walker" land on the same player.

**2. Personal adjustments for every member**

On any player anywhere in the app (waiver board, roster, available list) a small "Adjust" control opens a panel with:
- A slider from -40% to +40% of the baseline, showing the resulting points live.
- A number box for typing an exact season and weekly figure.
- "Reset to baseline".

A "My projections" page lists everything you've changed, with the baseline next to your number, and a "reset all" button.

Adjustments belong to the member and apply across all of their leagues.

**3. Everything uses the adjusted numbers**

Team strength, start/sit, waiver board, trade evaluation, championship and playoff odds, and projected finals all read your personal number when one exists, otherwise the baseline. League scoring rules still apply on top, so a half-PPR or TE-premium league keeps rescaling as it does now.

## Technical notes

- New `user_roles` table with an `app_role` enum and a `has_role()` security-definer function; your user id is seeded as `admin`. Baseline writes are gated on `has_role(auth.uid(),'admin')`; everyone else keeps read-only access to `players`.
- New `player_projection_overrides` table: `user_id`, `player_id`, `proj_points_week`, `proj_points_season`, timestamps, unique on `(user_id, player_id)`, RLS scoped to `auth.uid()`, GRANTs for `authenticated` and `service_role`.
- A shared `loadProjections(userId)` helper in `src/lib/fantasy/projections.server.ts` returns a per-player map of effective weekly/season points (override falling back to baseline). `analysis.server.ts`, `waivers.server.ts`, `rosters.server.ts` and `live.server.ts` read through that map instead of the raw `proj_points_*` columns; league scoring scaling is unchanged and still applied afterwards.
- Server functions in `src/lib/projections.functions.ts`: `listBaseline`, `updateBaseline` (admin), `bulkUpsertBaseline` (CSV, admin), `setOverride`, `clearOverride`, `listOverrides`.
- CSV parsing happens server-side with zod validation; unmatched rows are reported back, never silently dropped.
- New routes `src/routes/_authenticated/projections.tsx` (admin table + CSV) and `src/routes/_authenticated/my-projections.tsx`, plus a reusable `ProjectionAdjuster` component used inline elsewhere.
