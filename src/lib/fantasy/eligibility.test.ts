import { describe, expect, it } from "vitest";

import {
  asEligiblePositions,
  eligiblePositions,
  isEligiblePosition,
} from "./eligibility";
import { parseLeagueRules } from "./ffpc-parse";

describe("eligiblePositions", () => {
  it("expands flex slots and ignores the bench", () => {
    expect(eligiblePositions(["QB", "RB", "WR", "TE", "FLEX", "BN", "IR"])).toEqual([
      "QB",
      "RB",
      "WR",
      "TE",
    ]);
  });

  it("a superflex league with no K or DEF exposes only skill positions", () => {
    const slots = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "SUPER_FLEX"];
    const eligible = eligiblePositions(slots);
    expect(eligible).toEqual(["QB", "RB", "WR", "TE"]);
    for (const pos of ["K", "DEF", "DST", "DL", "LB", "DB"]) {
      expect(isEligiblePosition(pos, eligible)).toBe(false);
    }
  });

  it("an IDP_FLEX slot exposes DL, LB and DB", () => {
    const eligible = eligiblePositions(["QB", "RB", "WR", "TE", "IDP_FLEX"]);
    expect(eligible).toContain("DL");
    expect(eligible).toContain("LB");
    expect(eligible).toContain("DB");
    for (const pos of ["DL", "LB", "DB", "DE", "CB"]) {
      expect(isEligiblePosition(pos, eligible)).toBe(true);
    }
  });

  it("reads custom flex slots the platform spells out", () => {
    expect(eligiblePositions(["QB", "RB/WR/TE"])).toEqual(["QB", "RB", "WR", "TE"]);
  });

  it("treats DST as DEF and PK as K", () => {
    const eligible = eligiblePositions(["QB", "PK", "DST"]);
    expect(eligible).toEqual(["QB", "K", "DEF"]);
    expect(isEligiblePosition("DEF", eligible)).toBe(true);
    expect(isEligiblePosition("K", eligible)).toBe(true);
  });

  it("falls back to the standard set when nothing is recorded", () => {
    expect(eligiblePositions([])).toEqual(["QB", "RB", "WR", "TE", "K", "DEF"]);
    expect(asEligiblePositions(null, ["QB", "SUPER_FLEX"])).toEqual(["QB", "RB", "WR", "TE"]);
    expect(asEligiblePositions(["QB", "RB"], ["QB", "K"])).toEqual(["QB", "RB"]);
  });
});

describe("FFPC rules page", () => {
  it("sets eligibility from the league's roster slots", async () => {
    const fs = await import("node:fs/promises");
    const url = new URL("./ffpc/__fixtures__/league-rules.html", import.meta.url);
    const html = await fs.readFile(url, "utf8");
    const rules = parseLeagueRules(html);
    const eligible = eligiblePositions(rules.rosterSlots);
    expect(rules.rosterSlots.length).toBeGreaterThan(0);
    expect(eligible).toContain("QB");
    expect(eligible).toContain("RB");
    expect(eligible).toContain("WR");
    expect(eligible).toContain("TE");
    // FFPC rosters carry a kicker and a defence.
    expect(eligible).toContain("K");
    expect(eligible).toContain("DEF");
    expect(eligible).not.toContain("LB");
  });
});
