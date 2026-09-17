# Simplify the league advice tabs

## Direction
The mixed recommendation feed shown in the screenshot will be removed. It currently repeats waiver and lineup advice that already has a clearer home, while pushing the actual waiver wire too far down the page.

The league tabs will become:

```text
Lineup | Waivers | Trade | League | Live
```

## Changes
- Rename **Moves** to **Waivers** and keep its existing URL compatible so saved links continue to work.
- Put **Fill empty slots**, streaming options, and the full **Waiver wire** at the top of the Waivers tab.
- Remove the strategy summary and mixed recommendation-card feed above the waiver wire.
- Add a dedicated **Trade** tab containing:
  - trade recommendations from the former mixed feed;
  - Buy and Sell targets;
  - Trade Builder and trade evaluation;
  - draft-pick values where the league supports them.
- Keep lineup/start-sit advice in **Lineup** rather than duplicating it as a move card.
- Update alerts, This Week links, the persistent league strip, swipe navigation, and default-tab behavior so waiver items open **Waivers** and trade items open **Trade**.
- Preserve recommendation action tracking for trade recommendations displayed in the new Trade tab.

## Validation
- Confirm the waiver wire begins directly below the tab controls.
- Confirm trade recommendations and tools appear only under Trade.
- Confirm switching leagues preserves Waivers or Trade, including swipe navigation.
- Confirm old `?tab=moves` links open Waivers without breaking.
- Run the focused tests, full test suite, typecheck, and browser checks on desktop and mobile.
