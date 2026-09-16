import { describe, expect, it } from "vitest";

import {
  classifyTrajectory,
  curveValueAt,
  fitAgeCurves,
  handCurve,
  trajectoryFor,
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
    expect(trajectoryFor({ position: "WR", age: 26, value: 5000, tier: "elite", curve: wr }).classification).toBe("peak");
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
