# Fix "what you need" and On TV showing finished players as still to play

## What's wrong

Every player in the database is currently marked as "not started yet", including
Achane and Herbert whose games finished on Sunday. The scoreboard said their games
were final at the same moment the app saved them as pre-game, so anything that
counts "players left" is wrong: the what-you-need line, the yet-to-play counts,
the projected remaining points, the live/final styling on cards and On TV, and the
dimming of finished matchups.

The game status for each player comes from one place — the live NFL scoreboard read
during each refresh. When that read comes back empty, the refresh still writes
"not started" over every player, and nothing later corrects it. Confirmed: all 189
stored player rows say pre with a fresh timestamp, while the scoreboard itself lists
15 of 16 week-1 games as final.

The exact reason the scoreboard read came back empty is not yet confirmed, so step 1
is to establish that before changing behaviour.

## Plan

1. **Confirm the cause.** Run the live refresh and check what the scoreboard read
   returns from the app's own server environment (how many games, which team codes),
   rather than from a local test. Two candidates: the request is being refused there,
   or team codes don't line up.

2. **Never downgrade a known status.** A refresh that gets no scoreboard data must
   keep whatever status each player already had instead of resetting everyone to
   pre-game. Only real scoreboard data can change a status.

3. **Match team codes consistently.** The scoreboard entries are stored under raw
   codes while lookups use the app's normalised codes, so Washington (WSH vs WAS)
   never matches. Normalise on both sides, and add a second scoreboard request with
   explicit season and week parameters as a fallback when the first returns nothing.

4. **Correct at display time too.** When Game Day and On TV build their data, apply
   the current scoreboard status by team on top of the stored rows. Even with a stale
   or failed background refresh, a finished player is never counted as "left to play"
   and the matchup shows as final.

5. **Follow-through on the pieces fed by status:** players left, projected remaining
   points, the what-you-need line, the live pulse / final fade on both Game Day and
   On TV, and the kickoff countdown in the readiness bar, which currently uses fixed
   weekly time slots rather than the real kickoff times already available from the
   scoreboard.

6. **Verify with real data.** After the fix, check the stored statuses show finals
   for Sunday games, and open Game Day and On TV to confirm the line reads correctly
   for a finished matchup.

## Technical notes

- `gameStates()` in `src/lib/fantasy/live.server.ts`: key the map with `teamKey(abbr)`;
  return a null/empty marker distinct from "no games" so callers can tell a failed
  fetch from an empty week; add a `?dates=<season>&seasontype=2&week=<n>` retry.
- `refreshLiveScoring()`: when the state map is empty, omit `game_state`/`game_clock`/
  `opponent` from the upsert payload (merge-preserving) instead of writing `"pre"`.
- `buildGameDay()`: fetch `gameStates(week)` alongside the existing queries and let it
  override `snap.state` per player by `teamKey(nfl_team)`; `projectedFinal`, `needLine`,
  `yetToPlay`, `oppYetToPlay` and matchup `gameState` all derive from the corrected value.
- Readiness bar: source the next kickoff from the scoreboard's earliest future `date`
  for the week, falling back to the current `KICKOFF_SLOTS` heuristic in
  `src/lib/fantasy/gamewindow.ts`.
