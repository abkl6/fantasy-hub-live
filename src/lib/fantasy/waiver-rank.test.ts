import { describe, expect, it } from "vitest";

import {
  bidRecommendation,
  enforceBidOrder,
  isInjuredStatus,
  rankWaivers,
  type RankableRow,
} from "./waiver-rank";

const row = (p: Partial<RankableRow> & { id: string; position: string; projSeason: number }): RankableRow => ({
  status: "Active",
  projWeek: p.projSeason / 17,
  tradeValue: 0,
  ktcValue: null,
  projValue: 0,
  undervalued: false,
  bid: 0,
  titleDelta: null,
  survivalDelta: null,
  fromCutTeam: false,
  longTermValue: null,
  vor: 0,
  ruleScore: 1,
  ruleNote: null,
  ...p,
});

/** A chop league board: no season odds, only survival and projections. */
const guillotineBoard: RankableRow[] = [
  row({ id: "rb1", position: "RB", projSeason: 230 }),
  row({ id: "wr1", position: "WR", projSeason: 215 }),
  row({ id: "te1", position: "TE", projSeason: 190 }),
  row({ id: "wr2", position: "WR", projSeason: 120 }),
  row({ id: "k1", position: "K", projSeason: 260 }),
  row({ id: "def1", position: "DEF", projSeason: 240 }),
  row({ id: "rb-hurt", position: "RB", projSeason: 250, status: "IR" }),
  row({ id: "wr-out", position: "WR", projSeason: 245, status: "Out" }),
  row({ id: "rb-susp", position: "RB", projSeason: 244, status: "Suspended" }),
  row({ id: "cut-rb", position: "RB", projSeason: 150, fromCutTeam: true }),
];

const opts = {
  sort: "impact" as const,
  survival: true,
  showInjured: false,
};

describe("waiver ranking", () => {
  it("leads a guillotine board with the three best rest-of-season skill players", () => {
    const ranked = rankWaivers(guillotineBoard, opts);
    expect(ranked.slice(0, 3).map((r) => r.id)).toEqual(["rb1", "wr1", "te1"]);
  });

  it("never shows a kicker or a defence in the main list", () => {
    const ranked = rankWaivers(guillotineBoard, opts).map((r) => r.id);
    expect(ranked).not.toContain("k1");
    expect(ranked).not.toContain("def1");
  });


  it("hides injured, out and suspended players until asked", () => {
    const hidden = rankWaivers(guillotineBoard, opts).map((r) => r.id);
    expect(hidden).not.toContain("rb-hurt");
    expect(hidden).not.toContain("wr-out");
    expect(hidden).not.toContain("rb-susp");
    const shown = rankWaivers(guillotineBoard, { ...opts, showInjured: true }).map((r) => r.id);
    expect(shown).toContain("rb-hurt");
  });

  it("sorts by survival change when the simulation has one", () => {
    const ranked = rankWaivers(
      [
        row({ id: "a", position: "WR", projSeason: 300, survivalDelta: 0.01 }),
        row({ id: "b", position: "RB", projSeason: 100, survivalDelta: 0.08 }),
      ],
      opts,
    );
    expect(ranked[0]!.id).toBe("b");
  });

  it("reads IR, Out and Suspended as unavailable", () => {
    expect(isInjuredStatus("IR")).toBe(true);
    expect(isInjuredStatus("out")).toBe(true);
    expect(isInjuredStatus("Suspended")).toBe(true);
    expect(isInjuredStatus("Questionable")).toBe(false);
    expect(isInjuredStatus("Active")).toBe(false);
  });
});

describe("bid ceilings", () => {
  it("keeps a player who neither starts nor moves the odds cheap", () => {
    const bid = bidRecommendation({
      budget: 100,
      perWeek: 4.2,
      impact: 0,
      topImpact: 0.09,
      lineupGain: 0,
      winningBids: [40, 55, 70],
    });
    expect(bid.recommended).toBeLessThanOrEqual(5);
  });

  it("prices the best player on the wire off winning bid history", () => {
    const bid = bidRecommendation({
      budget: 100,
      perWeek: 16,
      winningBids: [20, 30, 45],
    });
    expect(bid.recommended).toBeGreaterThan(10);
    expect(bid.ceiling).toBeLessThanOrEqual(50);
    expect(bid.passive).toBe(Math.round(bid.recommended * 0.7));
    expect(bid.aggressive).toBe(Math.round(bid.recommended * 1.3));
  });

  it("prices the bigger simulated gain higher, whatever the position", () => {
    // The Bowers / Rodriguez case: a tight end who genuinely helps must not be
    // priced below a running back who happens to lead a thin position.
    const te = bidRecommendation({
      budget: 1000,
      remaining: 1000,
      perWeek: 9.9,
      impact: 0.05,
      topImpact: 0.05,
      lineupGain: 4,
      winningBids: [],
    });
    const rb = bidRecommendation({
      budget: 1000,
      remaining: 1000,
      perWeek: 6,
      impact: 0.01,
      topImpact: 0.05,
      lineupGain: 0.5,
      winningBids: [],
    });
    expect(te.recommended).toBeGreaterThan(rb.recommended);
  });

  it("never lets a lower-ranked player carry a bigger bid", () => {
    const rows = [
      { bid: 40 },
      { bid: 95 },
      { bid: 12 },
    ];
    expect(enforceBidOrder(rows).map((r) => r.bid)).toEqual([40, 40, 12]);
  });

  it("never bids more than is left in the budget", () => {
    const bid = bidRecommendation({
      budget: 1000,
      remaining: 25,
      perWeek: 18,
      impact: 0.08,
      topImpact: 0.08,
      lineupGain: 9,
      rivalFloor: 400,
      winningBids: [],
    });
    expect(bid.recommended).toBeLessThanOrEqual(25);
  });
});
