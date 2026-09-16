/**
 * Guards the fast path: reusing preallocated buffers and skipping brackets for
 * teams nobody asked about must not move a single number for a fixed seed.
 * The values below were captured from the implementation before those changes.
 */

import { describe, expect, it } from "vitest";

import { simulateSeason } from "./engine";

const TEAMS = Array.from({ length: 12 }, (_, i) => ({
  id: `t${i}`,
  name: `Team ${i}`,
  isMine: i === 0,
  wins: i % 3,
  losses: 2 - (i % 3),
  ties: 0,
  pointsFor: 200 + i * 7,
  mean: 95 + i * 2.5,
  sd: 20 + (i % 4),
  vp: i,
}));

const CONFIG = {
  playoffTeams: 6,
  regularSeasonWeeks: 14,
  currentWeek: 3,
  byes: 2,
  victoryPoints: true,
  allPlayWeeks: [6],
};

const GOLDEN: [string, number, number, number, number][] = [
  ["t0", 0.008, 0, 3.9, 14.6],
  ["t1", 0.028, 0, 5, 16.7],
  ["t2", 0.094, 0, 6.7, 20.3],
  ["t3", 0.142, 0.004, 5, 22.8],
  ["t4", 0.274, 0.014, 6.4, 25.5],
  ["t5", 0.398, 0.026, 7.7, 27.7],
  ["t6", 0.61, 0.054, 6.3, 31.3],
  ["t7", 0.736, 0.096, 7.6, 33.4],
  ["t8", 0.854, 0.124, 9, 36.5],
  ["t9", 0.91, 0.16, 7.5, 39.3],
  ["t10", 0.966, 0.256, 8.8, 42.1],
  ["t11", 0.98, 0.266, 10.1, 43.9],
];

describe("simulateSeason determinism", () => {
  it("matches the recorded output for a fixed seed", () => {
    const result = simulateSeason(TEAMS, CONFIG, [], 500, 7);
    expect(result.map((r) => [r.id, r.playoffOdds, r.titleOdds, r.projWins, r.projVp])).toEqual(
      GOLDEN,
    );
  });

  it("repeats itself across runs", () => {
    const a = simulateSeason(TEAMS, CONFIG, [], 300, 11);
    const b = simulateSeason(TEAMS, CONFIG, [], 300, 11);
    expect(a).toEqual(b);
  });

  it("gives one team the same odds when only its bracket is simulated", () => {
    const full = simulateSeason(TEAMS, CONFIG, [], 4000, 7);
    const focused = simulateSeason(TEAMS, { ...CONFIG, focusTeam: "t8" }, [], 4000, 7);
    const a = full.find((r) => r.id === "t8")!;
    const b = focused.find((r) => r.id === "t8")!;
    expect(b.playoffOdds).toBeCloseTo(a.playoffOdds, 1);
    expect(b.titleOdds).toBeCloseTo(a.titleOdds, 1);
  });

});
