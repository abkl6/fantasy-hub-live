import { describe, expect, it } from "vitest";

import {
  classifyTrajectory,
  curveValueAt,
  dispersionAt,
  dispersionFromPairs,
  fitAgeCurves,
  fitFromPairs,
  handCurve,
  isUncertain,
  MIN_PAIRS,
  qbVariant,
  riseSlope,
  situationShift,
  trajectoryFor,
  trajectoryLabel,
} from "./age-curve";

/** Builds a synthetic market table: peak value at `peak`, decaying after. */
function marketRows(position: string, peak: number, decline: number) {
  const rows: { position: string; age: number | null; value: number }[] = [];
  for (let age = 21; age <= 34; age += 1) {
    const base = age <= peak ? Math.pow(0.95, peak - age) : Math.pow(1 - decline, age - peak);
    for (let i = 0; i < 4; i += 1) rows.push({ position, age, value: Math.round(base * 8000) });
  }
  return rows;
}

describe("fitted age curves", () => {
  const curves = fitAgeCurves([...marketRows("RB", 24, 0.18), ...marketRows("QB", 29, 0.05)]);
  const rb = curves.find((c) => c.position === "RB")!;
  const qb = curves.find((c) => c.position === "QB")!;

  it("fits from the market when there is enough data", () => {
    expect(rb.source).toBe("market");
    expect(rb.points.length).toBeGreaterThan(10);
  });

  it("declines faster for running backs than quarterbacks", () => {
    const drop = (curve: typeof rb, from: number) =>
      1 - curveValueAt(curve, from + 3) / curveValueAt(curve, from);
    expect(drop(rb, 27)).toBeGreaterThan(drop(qb, 27));
    expect(drop(rb, 29)).toBeGreaterThan(drop(qb, 29));
  });

  it("falls back to the hand-set shape with no market rows", () => {
    expect(fitAgeCurves([]).every((c) => c.source === "hand")).toBe(true);
  });
});

describe("trajectories", () => {
  it("puts a cliff player at least 20% below their current value in a year", () => {
    const rb = fitAgeCurves(marketRows("RB", 24, 0.3)).find((c) => c.position === "RB")!;
    const t = trajectoryFor({ position: "RB", age: 30, value: 4000, tier: "replacement", curve: rb });
    expect(t.classification).toBe("cliff");
    expect(t.plus1).toBeLessThanOrEqual(t.now * 0.8);
  });

  it("calls a young riser rising and a peaked player peak", () => {
    const wr = handCurve("WR");
    expect(trajectoryFor({ position: "WR", age: 22, value: 5000, tier: "elite", curve: wr }).classification).toBe("rising");
    const qb = handCurve("QB");
    expect(trajectoryFor({ position: "QB", age: 29, value: 5000, tier: "elite", curve: qb }).classification).toBe("peak");
  });

  it("ages elite production more slowly than replacement production", () => {
    const rb = handCurve("RB");
    const elite = trajectoryFor({ position: "RB", age: 28, value: 3000, tier: "elite", curve: rb });
    const scrub = trajectoryFor({ position: "RB", age: 28, value: 3000, tier: "replacement", curve: rb });
    expect(elite.plus1).toBeGreaterThan(scrub.plus1);
  });

  it("classifies by the one-year change", () => {
    expect(classifyTrajectory(0.1)).toBe("rising");
    expect(classifyTrajectory(-0.02)).toBe("peak");
    expect(classifyTrajectory(-0.12)).toBe("declining");
    expect(classifyTrajectory(-0.31)).toBe("cliff");
  });
});

describe("year-over-year fitting", () => {
  /** Same-player moves: value holds to `peak`, then drops `decline` a year. */
  function pairs(peak: number, decline: number, count = 8) {
    const out: { age: number; ratio: number }[] = [];
    for (let age = 21; age <= 33; age += 1) {
      const ratio = age < peak ? 1.08 : 1 - decline;
      for (let i = 0; i < count; i += 1) out.push({ age, ratio: ratio + (i % 3) * 0.01 });
    }
    return out;
  }

  it("prefers same-player pairs once there are enough of them", () => {
    const curve = fitFromPairs("RB", pairs(25, 0.2));
    expect(curve).not.toBeNull();
    expect(curve!.pairCount).toBeGreaterThanOrEqual(MIN_PAIRS);
    expect(curveValueAt(curve!, 30)).toBeLessThan(curveValueAt(curve!, 25));
  });

  it("refuses to fit from too few pairs", () => {
    expect(fitFromPairs("RB", pairs(25, 0.2, 1))).toBeNull();
  });

  it("measures dispersion from the real spread", () => {
    const wide = dispersionFromPairs(
      Array.from({ length: 60 }, (_, i) => ({ age: 27, ratio: 1 + (i % 2 ? 0.4 : -0.4) })),
    );
    const tight = dispersionFromPairs(
      Array.from({ length: 60 }, (_, i) => ({ age: 27, ratio: 1 + (i % 2 ? 0.02 : -0.02) })),
    );
    expect(dispersionAt(wide, 27)).toBeGreaterThan(dispersionAt(tight, 27));
  });
});

describe("splits, tiers and situation", () => {
  it("splits quarterbacks by rushing share", () => {
    expect(qbVariant(0.3)).toBe("rush");
    expect(qbVariant(0.05)).toBe("pocket");
    expect(qbVariant(null)).toBe("all");
  });

  it("lifts risers with production or first-round capital and damps day-three misses", () => {
    expect(riseSlope("elite", null)).toBeGreaterThan(1);
    expect(riseSlope("starter", 1)).toBeGreaterThan(1);
    expect(riseSlope("replacement", 6)).toBeLessThan(1);
  });

  it("nudges young players by role trend and leaves veterans alone", () => {
    expect(situationShift(23, { roleTrend: 0.1 })).toBeGreaterThan(0);
    expect(situationShift(23, { roleTrend: -0.1 })).toBeLessThan(0);
    expect(situationShift(31, { roleTrend: 0.1 })).toBe(
      situationShift(31, { roleTrend: -0.1 }),
    );
  });

  it("keeps every shift inside its cap", () => {
    const extreme = situationShift(23, {
      roleTrend: 5,
      draftRound: 1,
      contractYear: true,
      gamesMissed2y: 30,
    });
    expect(Math.abs(extreme)).toBeLessThanOrEqual(0.12);
  });

  it("flags a call as uncertain only near a class boundary", () => {
    expect(isUncertain(-0.05, 0.3)).toBe(true);
    expect(isUncertain(0.045, 0.3)).toBe(true);
    expect(isUncertain(-0.12, 0.3)).toBe(false);
    expect(trajectoryLabel("declining", true)).toContain("uncertain");
  });

  it("names the sell window for a pick differently to a veteran", () => {
    const wr = handCurve("WR");
    const rookie = trajectoryFor({
      position: "WR",
      age: 22,
      value: 5000,
      tier: "starter",
      curve: wr,
      sell: { rookieOrPick: true, month: 1 },
    });
    const vet = trajectoryFor({
      position: "WR",
      age: 30,
      value: 3000,
      tier: "starter",
      curve: wr,
      sell: { rookieOrPick: false, month: 1 },
    });
    expect(rookie.sentence).not.toBe(vet.sentence);
  });
});
