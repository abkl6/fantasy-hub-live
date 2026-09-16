import { describe, expect, it } from "vitest";
import {
  brier,
  calibrationVerdict,
  maeByPosition,
  weeklyBrier,
  type CalibrationRow,
} from "./calibration";
import { correlationBetween, correlatedVariance } from "./correlation";
import { startSitCall, startSitMode } from "./startsit";
import { buildFaabPlan, paceBid } from "./faab-plan";
import { buildManagerProfile, estimateAcceptance } from "./manager-profile";
import { hitRates, weightFor } from "./hit-rate";
import { teamDistribution, type EnginePlayer, type Slot } from "./engine";

describe("calibration", () => {
  it("scores a confident right call better than a confident wrong one", () => {
    expect(brier(0.9, true)).toBeLessThan(brier(0.9, false));
  });

  it("averages the Brier score per week", () => {
    const rows: CalibrationRow[] = [
      { week: 1, kind: "win_prob", predicted: 0.8, actual: 1 },
      { week: 1, kind: "win_prob", predicted: 0.6, actual: 0 },
      { week: 2, kind: "win_prob", predicted: 0.5, actual: 1 },
    ];
    const out = weeklyBrier(rows);
    expect(out).toHaveLength(2);
    expect(out[0]!.samples).toBe(2);
    expect(out[0]!.brier).toBeCloseTo((0.04 + 0.36) / 2, 3);
  });

  it("reports projection error by position", () => {
    const rows: CalibrationRow[] = [
      { week: 1, kind: "projection", position: "RB", predicted: 12, actual: 10 },
      { week: 2, kind: "projection", position: "RB", predicted: 12, actual: 16 },
      { week: 1, kind: "projection", position: "QB", predicted: 20, actual: 20 },
    ];
    const out = maeByPosition(rows);
    expect(out.find((r) => r.position === "RB")!.mae).toBe(3);
    expect(out.find((r) => r.position === "QB")!.mae).toBe(0);
  });

  it("tightens spreads when favorites over-perform their stated chance", () => {
    const rows: CalibrationRow[] = Array.from({ length: 20 }, (_, i) => ({
      week: 5 + (i % 5),
      kind: "win_prob" as const,
      predicted: 0.7,
      // 18 of 20 favourites win — far above the stated 70%.
      actual: i < 18 ? 1 : 0,
    }));
    const verdict = calibrationVerdict(rows, 10);
    expect(verdict.factor).toBeCloseTo(0.9, 5);
    expect(verdict.gap).toBeGreaterThan(0.08);
  });

  it("loosens spreads when favorites under-perform", () => {
    const rows: CalibrationRow[] = Array.from({ length: 20 }, (_, i) => ({
      week: 5 + (i % 5),
      kind: "win_prob" as const,
      predicted: 0.75,
      actual: i < 10 ? 1 : 0,
    }));
    expect(calibrationVerdict(rows, 10).factor).toBeCloseTo(1.1, 5);
  });

  it("leaves the defaults alone on thin evidence", () => {
    const rows: CalibrationRow[] = [{ week: 9, kind: "win_prob", predicted: 0.7, actual: 1 }];
    expect(calibrationVerdict(rows, 10).factor).toBe(1);
  });
});

describe("lineup correlation", () => {
  it("links a quarterback with his own receiver", () => {
    expect(
      correlationBetween(
        { position: "QB", nflTeam: "MIA", opponent: "BUF" },
        { position: "WR", nflTeam: "MIA", opponent: "BUF" },
      ),
    ).toBeCloseTo(0.35);
  });

  it("links opposing players in the same game more loosely", () => {
    expect(
      correlationBetween(
        { position: "WR", nflTeam: "MIA", opponent: "BUF" },
        { position: "WR", nflTeam: "BUF", opponent: "MIA" },
      ),
    ).toBeCloseTo(0.15);
  });

  it("leaves unrelated players independent", () => {
    expect(
      correlationBetween(
        { position: "QB", nflTeam: "MIA", opponent: "BUF" },
        { position: "WR", nflTeam: "DAL", opponent: "PHI" },
      ),
    ).toBe(0);
  });

  it("makes a QB-WR stack swingier than the same two players apart", () => {
    const stacked = correlatedVariance([
      { sd: 6, player: { position: "QB", nflTeam: "MIA", opponent: "BUF" } },
      { sd: 5, player: { position: "WR", nflTeam: "MIA", opponent: "BUF" } },
    ]);
    const apart = correlatedVariance([
      { sd: 6, player: { position: "QB", nflTeam: "MIA", opponent: "BUF" } },
      { sd: 5, player: { position: "WR", nflTeam: "DAL", opponent: "PHI" } },
    ]);
    expect(stacked).toBeGreaterThan(apart);
  });

  it("widens a team's weekly spread when its lineup is stacked", () => {
    const slots: Slot[] = ["QB", "WR", "WR"];
    const base: EnginePlayer[] = [
      { id: "qb", name: "qb", position: "QB", proj: 22, volatility: 0.3, nflTeam: "MIA", opponent: "BUF" },
      { id: "wr1", name: "wr1", position: "WR", proj: 15, volatility: 0.4, nflTeam: "MIA", opponent: "BUF" },
      { id: "wr2", name: "wr2", position: "WR", proj: 12, volatility: 0.4, nflTeam: "DAL", opponent: "PHI" },
    ];
    const spread: EnginePlayer[] = base.map((p, i) =>
      i === 1 ? { ...p, nflTeam: "NYG", opponent: "WAS" } : p,
    );
    expect(teamDistribution(base, slots).sd).toBeGreaterThan(teamDistribution(spread, slots).sd);
  });
});

describe("favorite-aware start/sit", () => {
  it("picks a mode from the matchup", () => {
    expect(startSitMode(0.8)).toBe("floor");
    expect(startSitMode(0.2)).toBe("ceiling");
    expect(startSitMode(0.5)).toBe("mean");
  });

  it("plays the safer player when heavily favored", () => {
    const steady = { name: "Burden", position: "WR", proj: 11, volatility: 0.2 };
    const boom = { name: "Swinger", position: "WR", proj: 12, volatility: 0.7 };
    const call = startSitCall(boom, steady, 0.75);
    expect(call.start.name).toBe("Burden");
    expect(call.line).toBe("You're favored — playing it safe with Burden.");
  });

  it("chases the ceiling when a big underdog", () => {
    const steady = { name: "Burden", position: "WR", proj: 11, volatility: 0.2 };
    const boom = { name: "Swinger", position: "WR", proj: 12, volatility: 0.7 };
    expect(startSitCall(steady, boom, 0.2).start.name).toBe("Swinger");
  });

  it("ignores the mode when the projections are far apart", () => {
    const steady = { name: "Burden", position: "WR", proj: 6, volatility: 0.2 };
    const stud = { name: "Stud", position: "WR", proj: 18, volatility: 0.7 };
    const call = startSitCall(steady, stud, 0.9);
    expect(call.start.name).toBe("Stud");
    expect(call.line).toBeNull();
  });
});

describe("FAAB pacing", () => {
  const plan = buildFaabPlan({
    currentWeek: 5,
    lastWeek: 13,
    remaining: 100,
    starterByeWeeks: [9, 10, 10, 11],
    historicalWins: [
      { week: 3, amount: 10 },
      { week: 9, amount: 30 },
      { week: 10, amount: 40 },
    ],
  });

  it("holds money back for the bye stretch", () => {
    expect(plan.reserve).toBeGreaterThan(0);
    expect(plan.reserveWeeks).toContain("9");
    expect(plan.line).toContain("reserve");
  });

  it("never reserves more than is left", () => {
    expect(plan.reserve).toBeLessThanOrEqual(100);
    expect(plan.spendableNow).toBe(100 - plan.reserve);
  });

  it("trims a bid that would break the plan", () => {
    const paced = paceBid(plan.spendableNow + 25, plan);
    expect(paced.bid).toBeLessThanOrEqual(plan.spendableNow);
    expect(paced.note).toContain("held back");
  });

  it("leaves an affordable bid alone", () => {
    expect(paceBid(1, plan).note).toBeNull();
  });
});

describe("manager profiles", () => {
  const profile = buildManagerProfile("t1", [
    {
      gotAges: [23],
      gotPositions: ["WR"],
      gotPicks: 1,
      gaveAges: [29],
      gavePositions: ["RB"],
      gavePicks: 0,
      valueGap: -8,
      accepted: true,
    },
    {
      gotAges: [22],
      gotPositions: ["WR"],
      gotPicks: 2,
      gaveAges: [30],
      gavePositions: ["TE"],
      gavePicks: 0,
      valueGap: -6,
      accepted: true,
    },
    {
      gotAges: [24],
      gotPositions: ["RB"],
      gotPicks: 0,
      gaveAges: [25],
      gavePositions: ["WR"],
      gavePicks: 1,
      valueGap: 2,
      accepted: false,
    },
  ]);

  it("spots a youth-buying, pick-hoarding manager", () => {
    expect(profile.youthLean).toBeGreaterThan(0);
    expect(profile.pickLean).toBeGreaterThan(0);
    expect(profile.overpays).toContain("WR");
    expect(profile.acceptRate).toBeCloseTo(0.67, 2);
  });

  it("rates an offer they historically like above a plain one", () => {
    const liked = estimateAcceptance(profile, {
      fairness: 0.5,
      theyGet: ["WR"],
      theyGetAge: 22,
      theyGiveAge: 30,
      picksToThem: 1,
    });
    const plain = estimateAcceptance(profile, {
      fairness: 0.5,
      theyGet: ["TE"],
      theyGetAge: 31,
      theyGiveAge: 24,
      picksToThem: 0,
    });
    expect(liked.probability).toBeGreaterThan(plain.probability);
    expect(liked.label).toMatch(/Likely to accept/);
  });
});

describe("advice hit rates", () => {
  const rows = [
    ...Array.from({ length: 7 }, (_, i) => ({ kind: "waiver", week: 5 + (i % 5), grade: "right" })),
    ...Array.from({ length: 3 }, (_, i) => ({ kind: "waiver", week: 5 + i, grade: "wrong" })),
    { kind: "trade", week: 9, grade: "push" },
    { kind: "start", week: 1, grade: "right" },
  ];

  it("counts hits over the trailing weeks only", () => {
    const rates = hitRates(rows, 10);
    const waiver = rates.find((r) => r.kind === "waiver")!;
    expect(waiver.hits).toBe(7);
    expect(waiver.graded).toBe(10);
    expect(waiver.label).toBe("Waiver picks: 7 of 10 right this season");
    // Week 1 is outside the six-week window.
    expect(rates.find((r) => r.kind === "start")).toBeUndefined();
  });

  it("weights a reliable kind of advice above an unproven one", () => {
    const rates = hitRates(rows, 10);
    expect(weightFor(rates, "waiver")).toBeGreaterThan(1);
    expect(weightFor(rates, "trade")).toBe(1);
  });
});
