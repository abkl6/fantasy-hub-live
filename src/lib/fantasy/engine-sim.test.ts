import { describe, expect, it } from "vitest";

import { DEFAULT_VOLATILITY, seedOrder, simulateSeason, volatilityOf } from "./engine";

const standing = (rows: [wins: number, points: number][]) =>
  rows.map(([wins, points]) => ({ wins, points, vp: 0 }));

describe("playoff seeding with divisions", () => {
  // East: A is best. West: D is best, though C has more wins than D overall.
  const ids = ["A", "B", "C", "D"];
  const divisions = { A: "East", B: "East", C: "West", D: "West" };

  it("always seeds each division winner first and second", () => {
    const order = seedOrder(
      ids,
      standing([
        [9, 1400], // A — East winner
        [3, 900],
        [8, 1500], // C — most wins in the West's rival? no: C is West
        [4, 1000],
      ]),
      { divisions: { A: "East", B: "East", C: "West", D: "West" } },
    );
    expect(order.slice(0, 2).map((i) => ids[i])).toEqual(["A", "C"]);
  });

  it("puts a weaker division winner ahead of a stronger non-winner", () => {
    const order = seedOrder(
      ids,
      standing([
        [10, 1600], // A — East winner
        [9, 1550], // B — East runner-up, second best record overall
        [4, 1100], // C — West winner on wins
        [2, 900],
      ]),
      { divisions },
    );
    expect(order.map((i) => ids[i])).toEqual(["A", "C", "B", "D"]);
  });

  it("falls back to straight order without divisions", () => {
    const order = seedOrder(ids, standing([[10, 1600], [9, 1550], [4, 1100], [2, 900]]));
    expect(order.map((i) => ids[i])).toEqual(["A", "B", "C", "D"]);
  });

  it("gives both division leaders a playoff place in a full simulation", () => {
    const teams = ids.map((id, i) => ({
      id,
      name: id,
      isMine: i === 0,
      wins: [9, 3, 8, 4][i]!,
      losses: [1, 7, 2, 6][i]!,
      ties: 0,
      pointsFor: [1400, 900, 1500, 1000][i]!,
      mean: 110,
      sd: 20,
    }));
    const res = simulateSeason(
      teams,
      {
        playoffTeams: 2,
        regularSeasonWeeks: 10,
        currentWeek: 11, // season over: seeding is fixed
        divisions,
      },
      [],
      200,
    );
    const odds = new Map(res.map((r) => [r.id, r.playoffOdds]));
    expect(odds.get("A")).toBe(1);
    expect(odds.get("C")).toBe(1);
    expect(odds.get("B")).toBe(0);
  });
});

describe("default volatility", () => {
  it("is position specific", () => {
    expect(DEFAULT_VOLATILITY["QB"]).toBe(0.25);
    expect(volatilityOf({ id: null, name: "x", position: "RB", proj: 10 })).toBe(0.35);
    expect(volatilityOf({ id: null, name: "x", position: "K", proj: 10 })).toBe(0.5);
    expect(volatilityOf({ id: null, name: "x", position: "DEF", proj: 10 })).toBe(0.45);
    expect(volatilityOf({ id: null, name: "x", position: "WR", proj: 10, volatility: 0.1 })).toBe(
      0.1,
    );
  });
});
