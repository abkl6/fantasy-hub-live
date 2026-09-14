# Hide "Rooting interests" until the playoff race is real

## What changes

The Rooting interests section on the league page currently appears from week 1, when every game technically shifts the odds by a rounding error. It will only appear once the playoff picture actually matters:

- **Late season:** within the final 4 weeks of the regular season, or
- **Clinch/elimination watch:** your team's magic number to clinch a playoff spot (or bye) is 2 or less, or your elimination number is 2 or less.

Until one of those is true the section stays hidden entirely — no empty placeholder. The UI already hides the section when there are no entries, so this is a data-side change only.

## Technical details

- `src/lib/fantasy/playoff.server.ts`: gate the rooting-interest loop behind a `playoffRaceRelevant` check — `config.currentWeek > config.regularSeasonWeeks - 4`, or my scenario's `magicNumberPlayoff`/`magicNumberBye`/`eliminationNumber` ≤ 2. When not relevant, return `rootingInterests: []`.
- No UI changes needed (`league.$leagueId.tsx` already skips the section when the list is empty).
- Typecheck + vitest, then confirm live that the section no longer shows in week 1.
