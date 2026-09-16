import { describe, expect, it } from "vitest";

import { bidRecommendation, isInjuredStatus, rankWaivers, type RankableRow } from "./waiver-rank";

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
  needsKicker: false,
  needsDefense: false,
};

describe("waiver ranking", () => {
  it("leads a guillotine board with the three best rest-of-season skill players", () => {
    const ranked = rankWaivers(guillotineBoard, opts);
    expect(ranked.slice(0, 3).map((r) => r.id)).toEqual(["rb1", "wr1", "te1"]);
  });

  it("never ranks a kicker above a starting-caliber running back", () => {
    const ranked = rankWaivers(guillotineBoard, opts);
    const k = ranked.findIndex((r) => r.id === "k1");
    const rb = ranked.findIndex((r) => r.id === "rb1");
    expect(k).toBeGreaterThan(rb);
    expect(ranked.findIndex((r) => r.id === "def1")).toBeGreaterThan(rb);
  });

  it("lets a kicker back in when the kicker slot is empty", () => {
    const ranked = rankWaivers(guillotineBoard, { ...opts, needsKicker: true });
    expect(ranked[0]!.id).toBe("k1");
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
  it("keeps a low-projection player under 3% of the budget", () => {
    const bid = bidRecommendation({
      budget: 100,
      perWeek: 4.2,
      bestAtPositionPerWeek: 16,
      winningBids: [40, 55, 70],
    });
    expect(bid.recommended).toBeLessThanOrEqual(3);
  });

  it("prices the best player on the wire off winning bid history", () => {
    const bid = bidRecommendation({
      budget: 100,
      perWeek: 16,
      bestAtPositionPerWeek: 16,
      winningBids: [20, 30, 45],
    });
    expect(bid.recommended).toBeGreaterThan(10);
    expect(bid.ceiling).toBeLessThanOrEqual(50);
    expect(bid.passive).toBe(Math.round(bid.recommended * 0.7));
    expect(bid.aggressive).toBe(Math.round(bid.recommended * 1.3));
  });
});
