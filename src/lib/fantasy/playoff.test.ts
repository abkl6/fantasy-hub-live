import { describe, expect, it } from "vitest";

import { simulateSeason, type ScheduleGame } from "./engine";
import { buildPlayoffPicture, type PlayoffTeam } from "./playoff.server";

function league(): { teams: PlayoffTeam[]; schedule: ScheduleGame[]; divisions: Record<string, string> } {
  const names = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot"];
  const teams: PlayoffTeam[] = names.map((name, i) => ({
    id: `t${i}`,
    name,
    isMine: i === 0,
    wins: 3,
    losses: 3,
    ties: 0,
    pointsFor: 600 + i,
    mean: 100 + i,
    sd: 20,
    // Bravo (east) and Foxtrot (west) lead their divisions on victory points.
    vp: [4, 12, 5, 6, 7, 11][i]!,
  }));
  const divisions: Record<string, string> = {
    t0: "east",
    t1: "east",
    t2: "east",
    t3: "west",
    t4: "west",
    t5: "west",
  };
  const schedule: ScheduleGame[] = [];
  for (let week = 7; week <= 12; week += 1) {
    schedule.push({ week, homeTeamId: "t0", awayTeamId: "t1" });
    schedule.push({ week, homeTeamId: "t2", awayTeamId: "t3" });
    schedule.push({ week, homeTeamId: "t4", awayTeamId: "t5" });
  }
  return { teams, schedule, divisions };
}

describe("projected seeds", () => {
  const { teams, schedule, divisions } = league();
  const config = {
    playoffTeams: 4,
    regularSeasonWeeks: 12,
    currentWeek: 7,
    victoryPoints: true,
    divisions,
  };
  const sim = simulateSeason(teams, config, schedule, 2500, 7);
  const picture = buildPlayoffPicture(teams, config, schedule, sim);

  it("shows the same odds the simulation produced for every team", () => {
    for (const seed of picture.seeds) {
      const row = sim.find((r) => r.id === seed.teamId)!;
      expect(seed.titleOdds).toBe(row.titleOdds);
      expect(seed.playoffOdds).toBe(row.playoffOdds);
      expect(seed.projWins).toBe(row.projWins);
    }
  });

  it("seeds the division leaders first and orders on victory points", () => {
    expect(picture.seeds.slice(0, 2).map((s) => s.name).sort()).toEqual(["Bravo", "Foxtrot"]);
    expect(picture.seeds[0]!.name).toBe("Bravo");
    expect(picture.seeds.map((s) => s.seed)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
