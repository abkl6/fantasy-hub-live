import { describe, expect, it } from "vitest";

import { simulateSeason, type ScheduleGame, type SimTeamInput } from "./engine";
import { outcomeOf, playoffCutLine } from "./season.server";

function league(n = 8): SimTeamInput[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `t${i}`,
    name: `Team ${i}`,
    isMine: i === 0,
    wins: 0,
    losses: 0,
    ties: 0,
    pointsFor: 0,
    mean: 110 - i * 4,
    sd: 20,
  }));
}

function schedule(n: number, weeks: number): ScheduleGame[] {
  const games: ScheduleGame[] = [];
  for (let w = 1; w <= weeks; w++) {
    for (let i = 0; i < n / 2; i++) {
      games.push({ week: w, homeTeamId: `t${i}`, awayTeamId: `t${n - 1 - i}` });
    }
  }
  return games;
}

const config = {
  playoffTeams: 4,
  regularSeasonWeeks: 8,
  currentWeek: 1,
  byes: 0,
  distributions: true as const,
};

describe("season spreads", () => {
  const teams = league(8);
  const results = simulateSeason(teams, config, schedule(8, 8), 400, 7);
  const mine = results.find((r) => r.isMine)!;

  it("reports how many seasons were played out", () => {
    expect(mine.iterations).toBe(400);
  });

  it("splits every season into exactly one finish", () => {
    const f = mine.finish!;
    const total = f.missed + f.wildCard + f.bye + f.semifinal + f.final + f.champion;
    expect(total).toBeCloseTo(1, 5);
    expect(f.champion).toBeCloseTo(mine.titleOdds, 5);
    expect(1 - f.missed).toBeCloseTo(mine.playoffOdds, 5);
  });

  it("returns a win spread that sums to one and brackets the average", () => {
    const spread = mine.winCounts!;
    expect(spread.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
    const mean = spread.reduce((sum, share, wins) => sum + share * wins, 0);
    expect(Math.abs(mean - mine.projWins)).toBeLessThan(0.6);
  });

  it("returns a seed spread adding up to the playoff odds", () => {
    const seeds = mine.seedCounts!;
    expect(seeds.length).toBe(4);
    expect(seeds.reduce((a, b) => a + b, 0)).toBeCloseTo(mine.playoffOdds, 5);
  });

  it("locks in forced results", () => {
    const forcedLosses = simulateSeason(
      teams,
      { ...config, forced: Array.from({ length: 8 }, (_, i) => ({ week: i + 1, teamId: "t0", win: false })) },
      schedule(8, 8),
      200,
      7,
    ).find((r) => r.id === "t0")!;
    expect(forcedLosses.projWins).toBe(0);
    expect(forcedLosses.playoffOdds).toBeLessThan(mine.playoffOdds);

    const forcedWins = simulateSeason(
      teams,
      { ...config, forced: Array.from({ length: 8 }, (_, i) => ({ week: i + 1, teamId: "t0", win: true })) },
      schedule(8, 8),
      200,
      7,
    ).find((r) => r.id === "t0")!;
    expect(forcedWins.projWins).toBe(8);
    expect(forcedWins.playoffOdds).toBeGreaterThan(mine.playoffOdds);
  });

  it("reads the spread and the cut line for the Season tab", () => {
    const outcome = outcomeOf(mine);
    expect(outcome.winSpread.length).toBeGreaterThan(1);
    expect(outcome.seedSpread.every((s) => s.seed >= 1 && s.seed <= 4)).toBe(true);
    expect(playoffCutLine(results, 4)).toBeGreaterThan(0);
  });

  it("leaves results unchanged when spreads are not asked for", () => {
    const plain = simulateSeason(teams, { ...config, distributions: false }, schedule(8, 8), 400, 7);
    const plainMine = plain.find((r) => r.isMine)!;
    expect(plainMine.titleOdds).toBeCloseTo(mine.titleOdds, 10);
    expect(plainMine.projWins).toBeCloseTo(mine.projWins, 10);
    expect(plainMine.winCounts).toBeUndefined();
  });
});
