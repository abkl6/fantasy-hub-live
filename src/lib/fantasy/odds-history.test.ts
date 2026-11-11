import { describe, expect, it } from "vitest";

import { oddsSeriesByLeague, toOddsPoints, withCurrentWeek } from "./odds-history";

describe("odds history", () => {
  it("keeps one point per week, in week order", () => {
    const points = toOddsPoints([
      { week: 3, title_odds: 0.2, playoff_odds: 0.6 },
      { week: 1, title_odds: "0.1", playoff_odds: "0.5" },
      { week: 3, title_odds: 0.9, playoff_odds: 0.9 },
    ]);
    expect(points).toEqual([
      { week: 1, titleOdds: 0.1, playoffOdds: 0.5 },
      { week: 3, titleOdds: 0.2, playoffOdds: 0.6 },
    ]);
  });

  it("shows this week's freshly calculated chances instead of the stored ones", () => {
    const points = withCurrentWeek(
      [
        { week: 1, titleOdds: 0.1, playoffOdds: 0.5 },
        { week: 2, titleOdds: 0.2, playoffOdds: 0.6 },
      ],
      { week: 2, titleOdds: 0.35, playoffOdds: 0.8 },
    );
    expect(points.at(-1)).toEqual({ week: 2, titleOdds: 0.35, playoffOdds: 0.8 });
    expect(points).toHaveLength(2);
  });

  it("puts every league with recorded weeks on the hub chart and marks guillotine leagues", () => {
    const series = oddsSeriesByLeague(
      [
        { id: "a", name: "Dynasty", abbrev: "DYN", color: "sky", variant: "none" },
        { id: "b", name: "Chop", abbrev: null, color: null, variant: "guillotine" },
        { id: "c", name: "Empty", abbrev: null, color: null, variant: null },
      ],
      [
        { league_id: "a", week: 1, title_odds: 0.3, playoff_odds: 0.7 },
        { league_id: "b", week: 1, title_odds: 0.1, playoff_odds: 1 },
      ],
    );
    expect(series.map((s) => s.leagueId)).toEqual(["a", "b"]);
    expect(series.find((s) => s.leagueId === "b")?.guillotine).toBe(true);
    expect(series.find((s) => s.leagueId === "a")?.guillotine).toBe(false);
  });
});
