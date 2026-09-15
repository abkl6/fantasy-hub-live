import { describe, expect, it } from "vitest";

import { asContestFormat, contestFormatFromPlatform, hasPointsRace, pointsPlayoffLabel } from "./contest";
import { simulatePointsRace, simulateWeeklyHigh } from "./engine";

describe("contest format", () => {
  it("falls back to head to head", () => {
    expect(asContestFormat(undefined)).toBe("h2h");
    expect(asContestFormat("points")).toBe("points");
    expect(asContestFormat("nonsense")).toBe("h2h");
  });

  it("knows which formats run a points race", () => {
    expect(hasPointsRace("h2h")).toBe(false);
    expect(hasPointsRace("points")).toBe(true);
    expect(hasPointsRace("hybrid")).toBe(true);
  });

  it("reads the format platforms expose", () => {
    expect(contestFormatFromPlatform("yahoo", { scoringType: "point" })).toBe("points");
    expect(contestFormatFromPlatform("yahoo", { scoringType: "head" })).toBe("h2h");
    expect(contestFormatFromPlatform("espn", { scoringType: "TOTAL_POINTS" })).toBe("points");
    expect(contestFormatFromPlatform("sleeper", { bestBall: true })).toBe("points");
  });

  it("describes the playoff rule", () => {
    expect(pointsPlayoffLabel({ teams: null, afterWeek: null })).toMatch(/No playoffs/);
    expect(pointsPlayoffLabel({ teams: 4, afterWeek: 14 })).toBe(
      "Top 4 by total points after week 14",
    );
  });
});

describe("points race simulation", () => {
  const teams = [
    { id: "a", name: "A", isMine: true, pointsFor: 400, mean: 120, sd: 20 },
    { id: "b", name: "B", isMine: false, pointsFor: 300, mean: 100, sd: 20 },
    { id: "c", name: "C", isMine: false, pointsFor: 250, mean: 95, sd: 20 },
  ];

  it("gives the leader the best chance and totals to one", () => {
    const rows = simulatePointsRace(teams, { weeksLeft: 5, topN: 2 }, 400, 3);
    const a = rows.find((r) => r.id === "a")!;
    const c = rows.find((r) => r.id === "c")!;
    expect(a.firstOdds).toBeGreaterThan(c.firstOdds);
    expect(rows.reduce((s, r) => s + r.firstOdds, 0)).toBeCloseTo(1, 5);
    expect(a.rank).toBe(1);
    expect(a.topNOdds).not.toBeNull();
  });

  it("reports no cut odds when the league has no playoffs", () => {
    const rows = simulatePointsRace(teams, { weeksLeft: 3, topN: null }, 200, 3);
    expect(rows.every((r) => r.topNOdds === null)).toBe(true);
  });
});

describe("weekly high simulation", () => {
  it("favours the team with the biggest projected finish", () => {
    const rows = simulateWeeklyHigh(
      [
        { id: "a", name: "A", isMine: true, livePoints: 80, projectedRemaining: 40, sd: 8 },
        { id: "b", name: "B", isMine: false, livePoints: 60, projectedRemaining: 30, sd: 8 },
      ],
      500,
      9,
    );
    const a = rows.find((r) => r.id === "a")!;
    expect(a.probability).toBeGreaterThan(0.8);
    expect(a.projectedFinal).toBe(120);
    expect(rows.reduce((s, r) => s + r.probability, 0)).toBeCloseTo(1, 5);
  });
});
