import { describe, expect, it } from "vitest";

import {
  MIN_BID,
  applyBidRules,
  dropAllowed,
  faabReserve,
  hasProof,
  isStreamPosition,
  replacementLevels,
  ruleBook,
  tradeAllowed,
  valueOverReplacement,
} from "./rules";

const book = ruleBook([]);

describe("streaming kickers and defences", () => {
  it("never recommends a defence bid above the minimum", () => {
    const result = applyBidRules(book, {
      position: "DEF",
      bid: 42,
      budget: 100,
      remaining: 100,
      weeksLeft: 10,
    });
    expect(result.bid).toBe(MIN_BID);
    expect(result.note).toBeTruthy();
  });

  it("caps kickers too, and leaves skill players alone", () => {
    expect(applyBidRules(book, { position: "K", bid: 20, budget: 100, remaining: 100, weeksLeft: 8 }).bid).toBe(
      MIN_BID,
    );
    expect(applyBidRules(book, { position: "WR", bid: 20, budget: 100, remaining: 100, weeksLeft: 8 }).bid).toBe(20);
  });

  it("recognises every streamer spelling and blocks trading for them", () => {
    for (const pos of ["K", "PK", "DEF", "DST", "D/ST"]) {
      expect(isStreamPosition(pos)).toBe(true);
    }
    expect(isStreamPosition("RB")).toBe(false);
    expect(tradeAllowed(book, ["RB", "DEF"])).toBe(false);
    expect(tradeAllowed(book, ["RB", "WR"])).toBe(true);
  });
});

describe("value over replacement", () => {
  it("ranks a WR 8 over replacement 6 above a DEF 9 over replacement 8", () => {
    const levels = replacementLevels([
      { id: "wr1", position: "WR", proj: 8 },
      { id: "wr2", position: "WR", proj: 6 },
      { id: "d1", position: "DEF", proj: 9 },
      { id: "d2", position: "DEF", proj: 8 },
    ]);
    const wr = valueOverReplacement(8, "WR", levels);
    const def = valueOverReplacement(9, "DEF", levels);
    expect(wr).toBeCloseTo(2);
    expect(def).toBeCloseTo(1);
    expect(wr).toBeGreaterThan(def);
  });
});

describe("the remaining guard rails", () => {
  it("holds back part of the budget", () => {
    const reserve = faabReserve(100, 8);
    expect(reserve).toBeGreaterThan(0);
    const capped = applyBidRules(book, {
      position: "RB",
      bid: 100,
      budget: 100,
      remaining: 100,
      weeksLeft: 8,
    });
    expect(capped.bid).toBeLessThan(100);
  });

  it("wants two strong weeks or a role change before displacing a steady bench", () => {
    expect(hasProof({ strongWeeks: 0, roleChange: false, benchProj: 10, proj: 10.5 })).toBe(false);
    expect(hasProof({ strongWeeks: 2, roleChange: false, benchProj: 10, proj: 9 })).toBe(true);
    expect(hasProof({ strongWeeks: 0, roleChange: true, benchProj: 10, proj: 9 })).toBe(true);
  });

  it("refuses to drop a player who would be a top-five pickup", () => {
    const wire = [20, 18, 16, 14, 12];
    expect(dropAllowed(book, 19, wire)).toBe(false);
    expect(dropAllowed(book, 4, wire)).toBe(true);
  });
});
