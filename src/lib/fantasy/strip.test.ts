import { describe, expect, it } from "vitest";

import { stripTargetTab } from "@/components/LeagueStrip";
import { leagueInitials } from "@/lib/league-colors";

describe("league strip tab targeting", () => {
  it("keeps the tab the user is already reading", () => {
    expect(stripTargetTab("/league/abc", "league", "waivers")).toBe("league");
    expect(stripTargetTab("/league/abc", "live", "waivers")).toBe("live");
    expect(stripTargetTab("/league/abc", "trade", "waivers")).toBe("trade");
    expect(stripTargetTab("/league/abc", "moves", "league")).toBe("waivers");
  });

  it("maps cross-league screens onto the matching league tab", () => {
    expect(stripTargetTab("/gameday", undefined, "waivers")).toBe("live");
    expect(stripTargetTab("/this-week", undefined, "league")).toBe("waivers");
    expect(stripTargetTab("/lineup-check", undefined, "league")).toBe("lineup");
    expect(stripTargetTab("/trade-desk", undefined, "league")).toBe("trade");
  });

  it("falls back to the league's own default tab", () => {
    expect(stripTargetTab("/manager-hub", undefined, "live")).toBe("live");
    expect(stripTargetTab("/league/abc", "nonsense", "waivers")).toBe("waivers");
  });
});

describe("tile abbreviations", () => {
  it("defaults from the league name", () => {
    expect(leagueInitials("Chop Best Ball")).toBe("CBB");
    expect(leagueInitials("Dynasty")).toBe("DYN");
  });
});
