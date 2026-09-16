import { describe, expect, it } from "vitest";

import { blendRates, blendSeasonTotals, blendWeightForGames, ratesToTotals } from "./blend";
import { buildImpliedBook, clampImplied } from "./implied";
import { playerIndex } from "./names";
import { hasScoringGap, reconcileTeam, reconciliationBanner } from "./reconcile";
import { historicalVolatility } from "./volatility";

describe("rest-of-season blend", () => {
  it("weights this season's games at half after six games", () => {
    expect(blendWeightForGames(6)).toBeCloseTo(0.5, 6);
    const out = blendRates({ rec_yd: 100 }, { rec_yd: 50 }, 6);
    expect(out.weight).toBeCloseTo(0.5, 6);
    expect(out.perGame['rec_yd']).toBeCloseTo(75, 4);
  });

  it("ignores actuals before any game is played", () => {
    const out = blendRates({ rush_yd: 200 }, { rush_yd: 60 }, 0);
    expect(out.weight).toBe(0);
    expect(out.perGame['rush_yd']).toBeCloseTo(60, 4);
  });

  it("blends every stat category, including new usage", () => {
    const out = blendSeasonTotals({ rush_yd: 240, rec: 12 }, { rush_yd: 850 }, 6, 17);
    expect(out.perGame['rec']).toBeCloseTo(1, 4);
    expect(out.perGame['rush_yd']).toBeGreaterThan(0);
  });

  it("spreads a rate back over remaining games", () => {
    expect(ratesToTotals({ rec_yd: 75 }, 4)['rec_yd']).toBeCloseTo(300, 4);
  });
});

describe("volatility", () => {
  it("falls back below six games", () => {
    expect(historicalVolatility([10, 12, 9, 14, 11])).toBeNull();
  });

  it("measures swing as a fraction of the mean", () => {
    const steady = historicalVolatility([14, 15, 13, 16, 15, 14]);
    const wild = historicalVolatility([2, 30, 1, 28, 3, 26]);
    expect(steady).not.toBeNull();
    expect(wild).not.toBeNull();
    expect(wild!).toBeGreaterThan(steady!);
  });
});

describe("score reconciliation", () => {
  const ppr = { pass_yd: 0.04, pass_td: 4, rush_yd: 0.1, rush_td: 6, rec: 1, rec_yd: 0.1, rec_td: 6 };

  it("matches when the rules are complete", () => {
    const out = reconcileTeam(
      [{ name: "A Receiver", position: "WR", stats: { rec: 8, rec_yd: 100, rec_td: 1 } }],
      ppr,
      24,
    );
    expect(out.computed).toBeCloseTo(24, 1);
    expect(hasScoringGap(out.diff)).toBe(false);
  });

  it("flags a missing rule and names the likeliest player", () => {
    const noBonus = { ...ppr, rec: 0 };
    const out = reconcileTeam(
      [
        { name: "A Receiver", position: "WR", stats: { rec: 8, rec_yd: 100 } },
        { name: "A Runner", position: "RB", stats: { rush_yd: 50 } },
      ],
      noBonus,
      23,
    );
    expect(hasScoringGap(out.diff)).toBe(true);
    expect(out.topPlayerName).toBe("A Receiver");
    expect(reconciliationBanner([{ week: 3, diff: out.diff }])?.text).toContain("Week 3");
  });
});

describe("implied totals", () => {
  it("caps the adjustment at 15%", () => {
    expect(clampImplied(2)).toBe(1.15);
    expect(clampImplied(0.1)).toBe(0.85);
  });

  it("compares a week's line with the team's own average", () => {
    const book = buildImpliedBook([
      { week: 1, nflTeam: "MIA", implied: 20 },
      { week: 2, nflTeam: "MIA", implied: 30 },
    ]);
    expect(book.covered).toBe(true);
    expect(book.multiplier("mia", 2)).toBeGreaterThan(1);
    expect(book.multiplier("MIA", 1)).toBeLessThan(1);
    expect(book.multiplier("BUF", 1)).toBe(1);
  });
});

describe("canonical identifiers", () => {
  const rows = [
    { id: "p1", full_name: "De'Von Achane", position: "RB", sleeper_id: "9509", espn_id: null },
    { id: "p2", full_name: "Marvin Harrison Jr.", position: "WR", sleeper_id: null, espn_id: null },
  ];

  it("matches on the identifier before the name", () => {
    const index = playerIndex(rows);
    const hit = index.findWithId("sleeper_id", "9509", "Devon Achane Sr", "RB");
    expect(hit.row?.id).toBe("p1");
    expect(hit.matchedById).toBe(true);
  });

  it("reports a name match so the importer can write the id back", () => {
    const index = playerIndex(rows);
    const hit = index.findWithId("sleeper_id", "1234", "Marvin Harrison", "WR");
    expect(hit.row?.id).toBe("p2");
    expect(hit.matchedById).toBe(false);
  });
});
