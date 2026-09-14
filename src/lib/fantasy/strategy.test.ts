import { describe, expect, it } from "vitest";

import { ageLane, partnerModes, strategyFor, strategyMode } from "./strategy";

describe("strategyMode", () => {
  it("puts win-now badges in buy mode", () => {
    expect(strategyMode("top-seed")).toBe("buy");
    expect(strategyMode("dynasty-king")).toBe("buy");
    expect(strategyMode("win-now")).toBe("buy");
  });

  it("puts rebuilding badges in sell mode", () => {
    expect(strategyMode("bottom")).toBe("sell");
    expect(strategyMode("donator")).toBe("sell");
    expect(strategyMode("future-star")).toBe("sell");
  });

  it("treats middling badges as a pivot", () => {
    expect(strategyMode("filler")).toBe("pivot");
    expect(strategyMode("eternal-mediocrity")).toBe("pivot");
  });
});

describe("partnerModes", () => {
  it("never pairs a buyer with another buyer", () => {
    expect(partnerModes("buy")).not.toContain("buy");
    expect(partnerModes("sell")).not.toContain("sell");
    expect(partnerModes("pivot")).toEqual(["buy", "sell"]);
  });
});

describe("strategyFor", () => {
  it("asks contenders for veterans and rebuilders for picks", () => {
    expect(strategyFor("contender", true).wants).toContain("veteran");
    expect(strategyFor("donator", true).wants).toContain("picks");
  });
});

describe("ageLane", () => {
  it("ages running backs out earlier", () => {
    expect(ageLane("RB", 27, 5)).toBe("veteran");
    expect(ageLane("WR", 27, 5)).toBe("prime");
    expect(ageLane("WR", 30, 8)).toBe("veteran");
  });

  it("treats rookies as young even when old", () => {
    expect(ageLane("WR", 25, 1)).toBe("young");
    expect(ageLane("RB", 22, 0)).toBe("young");
  });

  it("falls back to prime without age data", () => {
    expect(ageLane("TE", null, null)).toBe("prime");
    expect(ageLane("TE", null, 1)).toBe("young");
  });
});
