/** Playoff tracking math built on top of the season simulation. Server-only. */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  simulateSeason,
  teamDistribution,
  type EnginePlayer,
  type ScheduleGame,
} from "./engine";

type DB = SupabaseClient<Database>;

export interface PlayoffTeam {
  id: string;
  name: string;
  isMine: boolean;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  mean: number;
  sd: number;
}

export interface PlayoffScenario {
  teamId: string;
  clinchPlayoffRecord: number | null;
  clinchByeRecord: number | null;
  eliminationRecord: number | null;
  magicNumberPlayoff: number | null;
  magicNumberBye: number | null;
  eliminationNumber: number | null;
}

export interface SeedProjection {
  teamId: string;
  name: string;
  isMine: boolean;
  seed: number;
  playoffOdds: number;
  titleOdds: number;
  projWins: number;
}

export interface RemainingSOS {
  teamId: string;
  name: string;
  isMine: boolean;
  avgOpponentMean: number;
  gamesLeft: number;
  rank: number;
}

export interface RootingInterest {
  week: number;
  homeTeamId: string;
  homeName: string;
  awayTeamId: string;
  awayName: string;
  rootFor: "home" | "away" | null;
  reason: string;
}

export interface PlayoffPayload {
  scenarios: PlayoffScenario[];
  seeds: SeedProjection[];
  strengthOfSchedule: RemainingSOS[];
  rootingInterests: RootingInterest[];
  myScenario: PlayoffScenario | null;
  mySeed: SeedProjection | null;
  mySOS: RemainingSOS | null;
}

export function buildPlayoffPicture(
  teams: PlayoffTeam[],
  config: { playoffTeams: number; regularSeasonWeeks: number; currentWeek: number },
  schedule: ScheduleGame[],
  simResults: { id: string; name: string; isMine: boolean; playoffOdds: number; titleOdds: number; projWins: number; projLosses: number; powerRank: number }[],
): PlayoffPayload {
  const n = teams.length;
  const weeksLeft = Math.max(0, config.regularSeasonWeeks - (config.currentWeek - 1));
  const playoffTeams = Math.min(n, Math.max(2, config.playoffTeams));

  // Sort by projected wins descending for seed projection.
  const seeds: SeedProjection[] = [...simResults]
    .sort((a, b) => b.projWins - a.projWins || b.titleOdds - a.titleOdds)
    .map((r, i) => ({
      teamId: r.id,
      name: r.name,
      isMine: r.isMine,
      seed: i + 1,
      playoffOdds: r.playoffOdds,
      titleOdds: r.titleOdds,
      projWins: r.projWins,
    }));

  // Remaining strength of schedule: average opponent weekly mean.
  const opponentMean = new Map<string, number[]>();
  const teamById = new Map(teams.map((t) => [t.id, t]));
  for (const g of schedule) {
    if (g.week < config.currentWeek) continue;
    const home = teamById.get(g.homeTeamId);
    const away = teamById.get(g.awayTeamId);
    if (!home || !away) continue;
    const homeList = opponentMean.get(home.id) ?? [];
    homeList.push(away.mean);
    opponentMean.set(home.id, homeList);
    const awayList = opponentMean.get(away.id) ?? [];
    awayList.push(home.mean);
    opponentMean.set(away.id, awayList);
  }

  const sos: RemainingSOS[] = teams
    .map((t) => {
      const list = opponentMean.get(t.id) ?? [];
      return {
        teamId: t.id,
        name: t.name,
        isMine: t.isMine,
        avgOpponentMean: list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0,
        gamesLeft: list.length || weeksLeft,
      };
    })
    .sort((a, b) => a.avgOpponentMean - b.avgOpponentMean)
    .map((r, i) => ({ ...r, rank: i + 1 }));

  // Clinching / elimination scenarios.
  const scenarios: PlayoffScenario[] = teams.map((t) => {
    const others = teams.filter((o) => o.id !== t.id);
    const currentWins = t.wins + t.ties * 0.5;

    let clinchPlayoff: number | null = null;
    let clinchBye: number | null = null;
    let elimination: number | null = null;

    // Try every possible final win total for this team and see if it guarantees a playoff spot / bye.
    for (let add = weeksLeft; add >= 0; add--) {
      const finalWins = currentWins + add;
      const myPoints = t.pointsFor + add * t.mean;

      // Worst case for playoffs: every other team wins all remaining games.
      const othersBest = others.map((o) => ({
        id: o.id,
        wins: o.wins + o.ties * 0.5 + weeksLeft,
        points: o.pointsFor + weeksLeft * o.mean,
      }));
      const rankIfClinch = 1 + othersBest.filter((o) => o.wins > finalWins || (o.wins === finalWins && o.points > myPoints)).length;
      if (rankIfClinch <= playoffTeams && clinchPlayoff == null) clinchPlayoff = finalWins;
      if (rankIfClinch <= 1 && clinchBye == null) clinchBye = finalWins;

      // Best case for elimination: every other team loses all remaining games.
      const othersWorst = others.map((o) => ({
        id: o.id,
        wins: o.wins + o.ties * 0.5,
        points: o.pointsFor,
      }));
      const rankIfElim = 1 + othersWorst.filter((o) => o.wins > finalWins || (o.wins === finalWins && o.points > myPoints)).length;
      if (rankIfElim > playoffTeams && elimination == null) elimination = finalWins;
    }

    const magicPlayoff = clinchPlayoff != null ? Math.max(0, clinchPlayoff - currentWins) : null;
    const magicBye = clinchBye != null ? Math.max(0, clinchBye - currentWins) : null;
    const elimNumber = elimination != null ? Math.max(0, elimination - currentWins) : null;

    return {
      teamId: t.id,
      clinchPlayoffRecord: clinchPlayoff,
      clinchByeRecord: clinchBye,
      eliminationRecord: elimination,
      magicNumberPlayoff: magicPlayoff,
      magicNumberBye: magicBye,
      eliminationNumber: elimNumber,
    };
  });

  // Rooting interests: for each remaining game not involving the user's team,
  // which result helps the user's playoff odds the most? Only relevant once
  // the playoff race is real: the final 4 weeks of the regular season, or the
  // user's team is within 2 wins of clinching (or 2 of elimination).
  const mine = teams.find((t) => t.isMine);
  const myScenarioRow = mine ? scenarios.find((s) => s.teamId === mine.id) : undefined;
  const closeToClinch =
    myScenarioRow != null &&
    ((myScenarioRow.magicNumberPlayoff != null && myScenarioRow.magicNumberPlayoff <= 2) ||
      (myScenarioRow.magicNumberBye != null && myScenarioRow.magicNumberBye <= 2) ||
      (myScenarioRow.eliminationNumber != null && myScenarioRow.eliminationNumber <= 2));
  const lateSeason = config.currentWeek > config.regularSeasonWeeks - 4;
  const playoffRaceRelevant = lateSeason || closeToClinch;
  const rooting: RootingInterest[] = [];
  if (mine && playoffRaceRelevant) {
    for (const g of schedule.filter((x) => x.week > config.currentWeek)) {
      if (g.homeTeamId === mine.id || g.awayTeamId === mine.id) continue;
      const home = teamById.get(g.homeTeamId);
      const away = teamById.get(g.awayTeamId);
      if (!home || !away) continue;

      // Prefer the team with fewer projected wins to win (helps the user catch the leader)
      // unless the user is fighting one of them directly for a seed.
      const homeSeed = seeds.find((s) => s.teamId === home.id)?.seed ?? 99;
      const awaySeed = seeds.find((s) => s.teamId === away.id)?.seed ?? 99;
      const mySeed = seeds.find((s) => s.teamId === mine.id)?.seed ?? 99;

      let rootFor: "home" | "away" | null = null;
      let reason = "";

      if (homeSeed === mySeed + 1 || awaySeed === mySeed + 1) {
        // Direct seed race: root for the team behind us to lose.
        if (homeSeed < awaySeed) {
          rootFor = "home";
          reason = `${home.name} winning keeps ${away.name} behind you in the seed race.`;
        } else {
          rootFor = "away";
          reason = `${away.name} winning keeps ${home.name} behind you in the seed race.`;
        }
      } else {
        // Otherwise root for the lower-seeded (worse) team to win to create chaos above you.
        if (awaySeed < homeSeed) {
          rootFor = "home";
          reason = `An upset by ${home.name} slows ${away.name}.`;
        } else {
          rootFor = "away";
          reason = `An upset by ${away.name} slows ${home.name}.`;
        }
      }

      rooting.push({
        week: g.week,
        homeTeamId: g.homeTeamId,
        homeName: home.name,
        awayTeamId: g.awayTeamId,
        awayName: away.name,
        rootFor,
        reason,
      });
    }
  }

  const scenarioById = new Map(scenarios.map((s) => [s.teamId, s]));
  const sosById = new Map(sos.map((s) => [s.teamId, s]));
  const seedById = new Map(seeds.map((s) => [s.teamId, s]));

  return {
    scenarios,
    seeds,
    strengthOfSchedule: sos,
    rootingInterests: rooting,
    myScenario: mine ? scenarioById.get(mine.id) ?? null : null,
    mySeed: mine ? seedById.get(mine.id) ?? null : null,
    mySOS: mine ? sosById.get(mine.id) ?? null : null,
  };
}

export async function loadPlayoffPicture(
  supabase: DB,
  leagueId: string,
): Promise<PlayoffPayload> {
  const { data: league, error: leagueError } = await supabase
    .from("leagues")
    .select("*")
    .eq("id", leagueId)
    .single();
  if (leagueError || !league) throw new Error(leagueError?.message ?? "League not found.");

  const [{ data: teamRows }, { data: spotRows }, { data: matchupRows }] = await Promise.all([
    supabase.from("teams").select("*").eq("league_id", leagueId),
    supabase.from("roster_spots").select("*").eq("league_id", leagueId),
    supabase.from("matchups").select("*").eq("league_id", leagueId),
  ]);

  const slots = Array.isArray(league.roster_slots) && league.roster_slots.length
    ? league.roster_slots.map(String)
    : ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF"];

  const teams = (teamRows ?? []).map((t) => {
    const roster: EnginePlayer[] = (spotRows ?? [])
      .filter((s) => s.team_id === t.id)
      .map((s) => ({
        id: s.player_id,
        name: s.player_name,
        position: s.position.toUpperCase(),
        nflTeam: s.nfl_team,
        proj: Number(s.proj_points),
        volatility: 0.35,
      }));
    const dist = roster.length
      ? teamDistribution(roster, slots)
      : { mean: 100, sd: 22 };
    return {
      id: t.id,
      name: t.name,
      isMine: t.is_mine,
      wins: t.wins,
      losses: t.losses,
      ties: t.ties,
      pointsFor: Number(t.points_for),
      mean: dist.mean,
      sd: dist.sd,
    };
  });

  const schedule: ScheduleGame[] = (matchupRows ?? [])
    .filter((m) => m.home_team_id && m.away_team_id)
    .map((m) => ({ week: m.week, homeTeamId: m.home_team_id!, awayTeamId: m.away_team_id! }));

  const simConfig = {
    playoffTeams: league.playoff_teams,
    regularSeasonWeeks: league.regular_season_weeks,
    currentWeek: league.current_week,
  };
  const simResults = simulateSeason(teams, simConfig, schedule, 2500, 7);

  return buildPlayoffPicture(teams, simConfig, schedule, simResults);
}
