import { describe, expect, it } from "vitest";

import { detectGroup, mapHeaders, templateColumns, templateHeaderRow } from "./projection-templates";
import {
  blendMeasure,
  blendWeight,
  categoryGroupFor,
  clampMultiplier,
  multipliersFromMeasure,
  ratingOf,
  spreadSeasonTotals,
} from "./sos";


describe("projection templates", () => {
  it("tells the four layouts apart from their headings", () => {
    const header = (group: "offense" | "dst" | "idp" | "k") =>
      templateHeaderRow(group).split(",").map((h) => h.replace(/"/g, ""));
    expect(detectGroup(header("offense"))).toBe("offense");
    expect(detectGroup(header("dst"))).toBe("dst");
    expect(detectGroup(header("idp"))).toBe("idp");
    expect(detectGroup(header("k"))).toBe("k");
  });

  it("maps kicker headings onto scoring keys", () => {
    const header = templateHeaderRow("k").split(",");
    const mapped = mapHeaders("k", header);
    expect(mapped.length).toBeGreaterThan(0);
    expect(mapped.every((m) => m.index >= 0 && m.key)).toBe(true);
  });

  it("gives every group an identifier, name, position, team and bye column", () => {
    for (const group of ["offense", "dst", "idp", "k"] as const) {
      const cols = templateColumns(group).map((c) => c.header);
      expect(cols.slice(0, 5)).toEqual(["player_key", "name", "pos", "nfl_team", "bye"]);
    }
  });
});

describe("season totals split", () => {
  const weeks = [
    { week: 1, opponent: "KC" },
    { week: 2, opponent: "SF" },
    { week: 3, opponent: "CAR" },
  ];

  it("splits evenly and keeps the season total", () => {
    const split = spreadSeasonTotals({ pass_yd: 300, rush_td: 3 }, weeks);
    const total = split.reduce((sum, w) => sum + (w.stats["pass_yd"] ?? 0), 0);
    expect(total).toBeCloseTo(300, 1);
    expect(split[0]?.stats["rush_td"]).toBeCloseTo(1, 3);
  });

  it("shapes weeks by opponent strength without changing the season total", () => {
    const multiplier = (opp: string | null) => (opp === "CAR" ? 1.15 : opp === "KC" ? 0.85 : 1);
    const split = spreadSeasonTotals({ pass_yd: 300 }, weeks, multiplier);
    const total = split.reduce((sum, w) => sum + (w.stats["pass_yd"] ?? 0), 0);
    expect(total).toBeCloseTo(300, 1);
    const easy = split.find((w) => w.opponent === "CAR")!.stats["pass_yd"]!;
    const tough = split.find((w) => w.opponent === "KC")!.stats["pass_yd"]!;
    expect(easy).toBeGreaterThan(tough);
  });
});

describe("schedule strength maths", () => {
  it("keeps multipliers inside the allowed band", () => {
    expect(clampMultiplier(2)).toBeLessThanOrEqual(1.15);
    expect(clampMultiplier(0)).toBeGreaterThanOrEqual(0.85);
  });

  it("calls a low multiplier tough and a high one easy", () => {
    expect(ratingOf(0.9)).toBe("tough");
    expect(ratingOf(1.1)).toBe("easy");
    expect(ratingOf(1)).toBe("neutral");
  });

  it("turns a measure into multipliers around one", () => {
    const m = multipliersFromMeasure(new Map([["KC", 20], ["CAR", 10], ["SF", 15], ["NYJ", 12]]), 1);
    const values = [...m.values()];
    expect(Math.max(...values)).toBeGreaterThan(1);
    expect(Math.min(...values)).toBeLessThan(1);
  });
});
