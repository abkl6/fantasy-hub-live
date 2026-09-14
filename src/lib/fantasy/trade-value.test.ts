import { describe, expect, it } from "vitest";

import { parsePickName } from "./ktc.server";
import { balanceTrade, fairnessOf, leagueValueFormat, pickLabel, type TradeAsset } from "./trade-value";

const player = (name: string, value: number): TradeAsset => ({
  kind: "player",
  id: null,
  name,
  position: "WR",
  value,
});

const pick = (season: number, round: number, value: number): TradeAsset => ({
  kind: "pick",
  season,
  round,
  slot: "mid",
  label: pickLabel(season, round, "mid"),
  value,
});

describe("pick names", () => {
  it("reads round wording", () => {
    expect(parsePickName("2027 Early 1st")).toEqual({ season: 2027, round: 1, slot: "early" });
    expect(parsePickName("2026 Late 3rd")).toEqual({ season: 2026, round: 3, slot: "late" });
  });

  it("reads numbered picks", () => {
    expect(parsePickName("2026 Pick 1.03")).toEqual({ season: 2026, round: 1, slot: "early" });
  });

  it("ignores real players", () => {
    expect(parsePickName("Ja'Marr Chase")).toBeNull();
  });
});

describe("league format", () => {
  it("prices superflex separately", () => {
    expect(leagueValueFormat(["QB", "RB", "WR", "TE", "FLEX"])).toBe("1qb");
    expect(leagueValueFormat(["QB", "SUPERFLEX", "RB"])).toBe("sf");
    expect(leagueValueFormat(["QB", "QB", "RB"])).toBe("sf");
  });
});

describe("balancing an offer", () => {
  it("adds a sweetener from the side that owes value", () => {
    const result = balanceTrade(
      [player("Mine", 3000)],
      [player("Theirs", 5000)],
      [player("Bench A", 1900), player("Bench B", 400)],
      [pick(2027, 1, 2000)],
    );
    expect(result.give.length).toBe(2);
    expect(result.fairness).toBe("even");
  });

  it("leaves an already even offer alone", () => {
    const result = balanceTrade([player("A", 5000)], [player("B", 5100)], [player("C", 100)], []);
    expect(result.give.length).toBe(1);
    expect(result.get.length).toBe(1);
  });

  it("reads which way value tilts", () => {
    expect(fairnessOf(1000, 2000)).toBe("you-win");
    expect(fairnessOf(2000, 1000)).toBe("they-win");
    expect(fairnessOf(1000, 1050)).toBe("even");
  });
});
