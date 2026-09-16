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
    const multiplier = (_group: unknown, opp: string | null) =>
      opp === "CAR" ? 1.1 : opp === "KC" ? 0.9 : 1;
    const split = spreadSeasonTotals({ pass_yd: 300 }, weeks, "QB", multiplier);
    const total = split.reduce((sum, w) => sum + (w.stats["pass_yd"] ?? 0), 0);
    expect(total).toBeCloseTo(300, 1);
    const easy = split.find((w) => w.opponent === "CAR")!.stats["pass_yd"]!;
    const tough = split.find((w) => w.opponent === "KC")!.stats["pass_yd"]!;
    expect(easy).toBeGreaterThan(tough);
  });

  it("shapes each stat by its own category", () => {
    // Soft against the run, hard against the pass.
    const multiplier = (group: unknown, opp: string | null) =>
      opp !== "KC" ? 1 : group === "RB" ? 1.1 : group === "QB" ? 0.9 : 1;
    const split = spreadSeasonTotals({ pass_yd: 300, rush_yd: 300 }, weeks, "RB", multiplier);
    const kc = split.find((w) => w.opponent === "KC")!;
    expect(kc.stats["rush_yd"]!).toBeGreaterThan(kc.stats["pass_yd"]!);
    for (const key of ["pass_yd", "rush_yd"]) {
      const total = split.reduce((sum, w) => sum + (w.stats[key] ?? 0), 0);
      expect(total).toBeCloseTo(300, 1);
    }
  });
});

describe("schedule strength maths", () => {
  it("keeps multipliers inside the allowed band", () => {
    expect(clampMultiplier(2)).toBeLessThanOrEqual(1.1);
    expect(clampMultiplier(0)).toBeGreaterThanOrEqual(0.9);
  });

  it("calls a low multiplier tough and a high one easy", () => {
    expect(ratingOf(0.95)).toBe("tough");
    expect(ratingOf(1.05)).toBe("easy");
    expect(ratingOf(1)).toBe("neutral");
  });

  it("turns a measure into multipliers around one", () => {
    const m = multipliersFromMeasure(new Map([["KC", 20], ["CAR", 10], ["SF", 15], ["NYJ", 12]]), 1);
    const values = [...m.values()];
    expect(Math.max(...values)).toBeGreaterThan(1);
    expect(Math.min(...values)).toBeLessThan(1);
  });

  it("maps each stat to the position that governs it", () => {
    expect(categoryGroupFor("pass_yd", "QB")).toBe("QB");
    expect(categoryGroupFor("rush_td", "QB")).toBe("RB");
    expect(categoryGroupFor("rec_yd", "WR")).toBe("WR");
    expect(categoryGroupFor("rec_yd", "TE")).toBe("TE");
    expect(categoryGroupFor("fg_made", "K")).toBe("K");
    expect(categoryGroupFor("fum_lost", "RB")).toBeNull();
  });

  it("leans on last season until this season has eight games", () => {
    expect(blendWeight(0)).toBe(0);
    expect(blendWeight(4)).toBeCloseTo(0.5, 5);
    expect(blendWeight(12)).toBe(1);
    expect(blendMeasure(20, 10, 0)).toBe(20);
    expect(blendMeasure(20, 10, 4)).toBeCloseTo(15, 5);
    expect(blendMeasure(20, 10, 8)).toBeCloseTo(10, 5);
    expect(blendMeasure(null, 10, 2)).toBe(10);
    expect(blendMeasure(null, null, 2)).toBeNull();
  });
});


describe("real-world headings", () => {
  const header = [
    "Week", "Player", "Pos", "Team",
    "PASS YDS", "Pass TDs", "INTS", "RUSH_YDS", "Rush TDs",
    "REC", "Rec Yds", "REC TD", "FUMBLES LOST",
  ];

  it("maps third-party spellings onto the right stats", () => {
    const keys = mapHeaders("offense", header).map((m) => m.key);
    expect(keys).toContain("pass_yd");
    expect(keys).toContain("pass_td");
    expect(keys).toContain("pass_int");
    expect(keys).toContain("rush_yd");
    expect(keys).toContain("rush_td");
    expect(keys).toContain("rec");
    expect(keys).toContain("rec_yd");
    expect(keys).toContain("rec_td");
    expect(keys).toContain("fum_lost");
  });

  it("still recognises the file as an offence sheet", () => {
    expect(detectGroup(header)).toBe("offense");
  });

  it("does not read passing columns into a defence sheet", () => {
    const keys = mapHeaders("dst", ["Team", "SCK", "INT", "FR", "TD"]).map((m) => m.key);
    expect(keys).toContain("def_int");
    expect(keys).not.toContain("pass_int");
  });
});
