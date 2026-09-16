import { describe, expect, it } from "vitest";

import { dynastyValue, dynastyValueDetail } from "./format";
import { leagueDynastyValues, type DynastyTeamInput } from "./dynasty-value";
import type { TradeValueBook } from "./trade-value";

describe("dynasty value with an unknown age", () => {
  it("is worth less than the same player known to be 24", () => {
    const known = dynastyValue("WR", 200, 300, 24, null);
    const unknown = dynastyValue("WR", 200, 300, null, null, 26);
    expect(unknown).toBeLessThan(known);
    expect(unknown).toBeGreaterThan(0);
  });

  it("reports where the age came from", () => {
    expect(dynastyValueDetail("RB", 150, 300, 23, null).ageSource).toBe("age");
    expect(dynastyValueDetail("RB", 150, 300, null, 2).ageSource).toBe("experience");
    expect(dynastyValueDetail("RB", 150, 300, null, null, 25).ageSource).toBe("unknown");
  });

  it("does not assume a player just short of their peak", () => {
    // Peak-minus-one used to hand an unknown age the ascending-curve bonus.
    const unknown = dynastyValueDetail("WR", 200, 300, null, null, null).value;
    expect(unknown).toBeLessThan(dynastyValue("WR", 200, 300, 24, null));
  });
});

const book = {
  format: "sf",
  lastRefreshed: null,
  covered: true,
  market: () => 1000,
  age: () => null,
  medianAge: () => 26,
  player: () => 1000,
  pick: () => 0,
} as unknown as TradeValueBook;

describe("leagueDynastyValues", () => {
  it("counts the players whose age we never learned", () => {
    const teams: DynastyTeamInput[] = [
      {
        id: "a",
        name: "Mine",
        isMine: true,
        players: [
          { id: null, name: "Known Player", position: "WR", projSeason: 200, ageKnown: true },
          { id: null, name: "Mystery Player", position: "RB", projSeason: 150, ageKnown: false },
        ],
        picks: [],
      },
      { id: "b", name: "Theirs", isMine: false, players: [], picks: [] },
    ];
    const rows = leagueDynastyValues(teams, book);
    expect(rows.find((r) => r.teamId === "a")?.unknownAgeCount).toBe(1);
    expect(rows.find((r) => r.teamId === "b")?.unknownAgeCount).toBe(0);
  });
});
