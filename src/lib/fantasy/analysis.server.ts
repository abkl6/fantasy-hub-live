/** Loads a league from the database and produces the full analyzer payload. Server-only. */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

import {
  optimalLineup,
  positionGrades,
  simulateSeason,
  slotAccepts,
  teamDistribution,
  type EnginePlayer,
  type EngineTeam,
  type PositionGrade,
  type ScheduleGame,
  type SimTeamResult,
} from "./engine";
import { buildPlayoffPicture, type PlayoffPayload } from "./playoff.server";

type DB = SupabaseClient<Database>;

export interface LeagueRow {
  id: string;
  name: string;
  platform: string;
  season: number;
  current_week: number;
  team_count: number;
  playoff_teams: number;
  regular_season_weeks: number;
  scoring_type: string;
  scoring_rules: Record<string, number>;
  roster_slots: string[];
  external_id: string | null;
  last_synced_at: string | null;
}

export interface MoveSuggestion {
  id: string;
  kind: "start-sit" | "waiver" | "trade";
  headline: string;
  detail: string;
  pointsDelta: number;
  winDelta: number;
  titleDelta: number;
  playoffDelta: number;
  addName?: string;
  dropName?: string;
}

export interface ScoreboardGame {
  week: number;
  home: { id: string; name: string; score: number; isMine: boolean };
  away: { id: string; name: string; score: number; isMine: boolean };
  isFinal: boolean;
}

export interface AnalysisPayload {
  league: LeagueRow;
  slots: string[];
  myTeam: {
    id: string;
    name: string;
    record: string;
    pointsFor: number;
    projPointsPerWeek: number;
    powerRank: number;
    playoffOdds: number;
    titleOdds: number;
    projWins: number;
    projLosses: number;
    why: string[];
  } | null;
  standings: (SimTeamResult & { record: string; pointsFor: number })[];
  grades: PositionGrade[];
  lineup: { slot: string; name: string; position: string; proj: number; status: string; nflTeam: string | null; byeWeek: number | null }[];
  bench: { name: string; position: string; proj: number; status: string; nflTeam: string | null; byeWeek: number | null }[];
  suggestions: MoveSuggestion[];
  scoreboard: ScoreboardGame[];
  tradeCandidates: { id: string; name: string; position: string; proj: number; teamName: string; teamId: string }[];
  myTradeable: { id: string; name: string; position: string; proj: number }[];
  playoff: PlayoffPayload;
  alerts: Alert[];
}

export interface Alert {
  id: string;
  kind: "injury" | "bye" | "news";
  playerName: string;
  position: string;
  message: string;
  severity: "low" | "medium" | "high";
  action?: { label: string; suggestionId?: string; playerName?: string };
}

function toLeagueRow(l: Record<string, unknown>): LeagueRow {
  return {
    ...(l as unknown as LeagueRow),
    scoring_rules: (l['scoring_rules'] ?? {}) as Record<string, number>,
    roster_slots: asSlots(l['roster_slots']),
  };
}

const DEFAULT_SLOTS = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF"];

function asSlots(value: unknown): string[] {
  if (Array.isArray(value) && value.length) return value.map(String);
  return DEFAULT_SLOTS;
}

function recordOf(t: { wins: number; losses: number; ties: number }) {
  return t.ties > 0 ? `${t.wins}-${t.losses}-${t.ties}` : `${t.wins}-${t.losses}`;
}

export async function buildAnalysis(supabase: DB, leagueId: string): Promise<AnalysisPayload> {
  const { data: league, error: leagueError } = await supabase
    .from("leagues")
    .select("*")
    .eq("id", leagueId)
    .maybeSingle();
  if (leagueError) throw new Error(leagueError.message);
  if (!league) throw new Error("League not found.");

  const [{ data: teamRows }, { data: spotRows }, { data: matchupRows }, { data: playerRows }] =
    await Promise.all([
      supabase.from("teams").select("*").eq("league_id", leagueId),
      supabase.from("roster_spots").select("*").eq("league_id", leagueId),
      supabase.from("matchups").select("*").eq("league_id", leagueId),
      supabase.from("players").select("*"),
    ]);

  const slots = asSlots(league.roster_slots);
  const teams = teamRows ?? [];
  const spots = spotRows ?? [];
  const matchups = matchupRows ?? [];
  const players = playerRows ?? [];

  // Anyone held by any team in the league is off the waiver wire, whatever
  // position label the platform used for them.
  const rosteredNames = new Set(spots.map((s) => s.player_name.trim().toLowerCase()));
  const usablePosition = (position: string) =>
    slots.some((slot) => slotAccepts(slot, position)) || ["QB", "RB", "WR", "TE"].includes(position);

  const engineTeams: EngineTeam[] = teams.map((t) => ({
    id: t.id,
    name: t.name,
    isMine: t.is_mine,
    wins: t.wins,
    losses: t.losses,
    ties: t.ties,
    pointsFor: Number(t.points_for),
    roster: spots
      .filter((s) => s.team_id === t.id)
      .map<EnginePlayer>((s) => ({
        id: s.player_id,
        name: s.player_name,
        position: s.position.toUpperCase(),
        nflTeam: s.nfl_team,
        proj: Number(s.proj_points),
        volatility: 0.35,
      })),
  }));

  const simInputs = engineTeams.map((t) => {
    const dist = t.roster.length
      ? teamDistribution(t.roster, slots)
      : {
          mean:
            t.wins + t.losses + t.ties > 0
              ? t.pointsFor / (t.wins + t.losses + t.ties)
              : 100,
          sd: 22,
        };
    return {
      id: t.id,
      name: t.name,
      isMine: t.isMine,
      wins: t.wins,
      losses: t.losses,
      ties: t.ties,
      pointsFor: t.pointsFor,
      mean: dist.mean,
      sd: dist.sd,
    };
  });

  const schedule: ScheduleGame[] = matchups
    .filter((m) => m.home_team_id && m.away_team_id)
    .map((m) => ({ week: m.week, homeTeamId: m.home_team_id!, awayTeamId: m.away_team_id! }));

  const simConfig = {
    playoffTeams: league.playoff_teams,
    regularSeasonWeeks: league.regular_season_weeks,
    currentWeek: league.current_week,
  };

  const baseline = simulateSeason(simInputs, simConfig, schedule, 2500, 7);
  const baselineById = new Map(baseline.map((r) => [r.id, r]));

  const mine = engineTeams.find((t) => t.isMine) ?? null;
  const teamById = new Map(teams.map((t) => [t.id, t]));

  const standings = [...baseline]
    .sort((a, b) => b.titleOdds - a.titleOdds || b.projWins - a.projWins)
    .map((r) => {
      const row = teamById.get(r.id);
      return {
        ...r,
        record: row ? recordOf(row) : "0-0",
        pointsFor: row ? Number(row.points_for) : 0,
      };
    });

  const scoreboard: ScoreboardGame[] = matchups
    .filter((m) => m.week === league.current_week && m.home_team_id && m.away_team_id)
    .map((m) => {
      const h = teamById.get(m.home_team_id!);
      const a = teamById.get(m.away_team_id!);
      return {
        week: m.week,
        home: { id: m.home_team_id!, name: h?.name ?? "TBD", score: Number(m.home_score), isMine: h?.is_mine ?? false },
        away: { id: m.away_team_id!, name: a?.name ?? "TBD", score: Number(m.away_score), isMine: a?.is_mine ?? false },
        isFinal: m.is_final,
      };
    })
    .sort((x, y) => Number(y.home.isMine || y.away.isMine) - Number(x.home.isMine || x.away.isMine));

  if (!mine) {
    return {
      league: toLeagueRow(league),
      slots,
      myTeam: null,
      standings,
      grades: [],
      lineup: [],
      bench: [],
      suggestions: [],
      scoreboard,
      tradeCandidates: [],
      myTradeable: [],
      playoff: buildPlayoffPicture(simInputs, simConfig, schedule, standings),
      alerts: [],
    };
  }

  const grades = positionGrades(mine, engineTeams, slots);
  const best = optimalLineup(mine.roster, slots);

  // --- what-if helper: re-run the season with my team's roster swapped -----
  const baseMine = baselineById.get(mine.id)!;
  const whatIf = (roster: EnginePlayer[]) => {
    const dist = teamDistribution(roster, slots);
    const inputs = simInputs.map((t) => (t.id === mine.id ? { ...t, mean: dist.mean, sd: dist.sd } : t));
    const res = simulateSeason(inputs, simConfig, schedule, 1200, 7);
    const m = res.find((r) => r.id === mine.id)!;
    return {
      titleDelta: m.titleOdds - baseMine.titleOdds,
      playoffDelta: m.playoffOdds - baseMine.playoffOdds,
      winDelta: m.projWins - baseMine.projWins,
      pointsDelta: dist.mean - (baseMine.projPointsPerWeek ?? dist.mean),
    };
  };

  const suggestions: MoveSuggestion[] = [];

  // --- start / sit --------------------------------------------------------
  const currentStarters = spots.filter((s) => s.team_id === mine.id && s.is_starter);
  const bestNames = new Set(best.starters.map((s) => s.player?.name).filter(Boolean) as string[]);
  if (currentStarters.length) {
    for (const s of best.starters) {
      if (!s.player) continue;
      const isStarting = currentStarters.some((c) => c.player_name === s.player!.name);
      if (isStarting) continue;
      const benched = currentStarters
        .filter((c) => slotAccepts(s.slot, c.position.toUpperCase()) && !bestNames.has(c.player_name))
        .sort((a, b) => Number(a.proj_points) - Number(b.proj_points))[0];
      if (!benched) continue;
      const gain = s.player.proj - Number(benched.proj_points);
      if (gain < 0.6) continue;
      const impact = whatIf(mine.roster);
      suggestions.push({
        id: `start-${s.player.name}`,
        kind: "start-sit",
        headline: `Start ${s.player.name} over ${benched.player_name}`,
        detail: `${s.slot} slot. Projection goes from ${Number(benched.proj_points).toFixed(1)} to ${s.player.proj.toFixed(1)} points this week.`,
        pointsDelta: Math.round(gain * 10) / 10,
        winDelta: Math.round(impact.winDelta * 100) / 100,
        titleDelta: impact.titleDelta,
        playoffDelta: impact.playoffDelta,
        addName: s.player.name,
        dropName: benched.player_name,
      });
    }
  }

  // --- waiver targets -----------------------------------------------------
  const freeAgents = players
    .filter((p) => !rosteredNames.has(p.full_name.trim().toLowerCase()))
    .filter((p) => usablePosition(p.position.toUpperCase()))
    .map<EnginePlayer>((p) => ({
      id: p.id,
      name: p.full_name,
      position: p.position.toUpperCase(),
      nflTeam: p.nfl_team,
      proj: Number(p.proj_points_week),
      volatility: Number(p.volatility),
    }))
    .sort((a, b) => b.proj - a.proj)
    .slice(0, 14);

  const droppable = [...mine.roster].sort((a, b) => a.proj - b.proj);
  for (const fa of freeAgents.slice(0, 8)) {
    const drop = droppable.find((d) => d.proj < fa.proj);
    if (!drop) continue;
    const nextRoster = mine.roster.map((p) => (p.name === drop.name ? fa : p));
    const before = optimalLineup(mine.roster, slots).total;
    const after = optimalLineup(nextRoster, slots).total;
    if (after - before < 0.4) continue;
    const impact = whatIf(nextRoster);
    suggestions.push({
      id: `waiver-${fa.name}`,
      kind: "waiver",
      headline: `Add ${fa.name} (${fa.position}), drop ${drop.name}`,
      detail: `Your best starting lineup gains ${(after - before).toFixed(1)} points a week.`,
      pointsDelta: Math.round((after - before) * 10) / 10,
      winDelta: Math.round(impact.winDelta * 100) / 100,
      titleDelta: impact.titleDelta,
      playoffDelta: impact.playoffDelta,
      addName: fa.name,
      dropName: drop.name,
    });
  }

  // --- trade ideas: my surplus for another team's surplus at my weak spot --
  const weakest = grades.filter((g) => g.verdict === "weakness").map((g) => g.position);
  const strongest = grades.filter((g) => g.verdict === "strength").map((g) => g.position);
  for (const other of engineTeams.filter((t) => !t.isMine && t.roster.length)) {
    for (const need of weakest.slice(0, 2)) {
      const target = other.roster
        .filter((p) => p.position === need)
        .sort((a, b) => b.proj - a.proj)[0];
      if (!target) continue;
      const give = mine.roster
        .filter((p) => strongest.includes(p.position))
        .sort((a, b) => b.proj - a.proj)[1];
      if (!give) continue;
      const nextRoster = mine.roster.map((p) => (p.name === give.name ? target : p));
      const before = optimalLineup(mine.roster, slots).total;
      const after = optimalLineup(nextRoster, slots).total;
      if (after - before < 0.5) continue;
      const impact = whatIf(nextRoster);
      suggestions.push({
        id: `trade-${other.id}-${target.name}`,
        kind: "trade",
        headline: `Trade ${give.name} to ${other.name} for ${target.name}`,
        detail: `Fills your ${need} hole from a position of surplus. Lineup gains ${(after - before).toFixed(1)} points a week.`,
        pointsDelta: Math.round((after - before) * 10) / 10,
        winDelta: Math.round(impact.winDelta * 100) / 100,
        titleDelta: impact.titleDelta,
        playoffDelta: impact.playoffDelta,
        addName: target.name,
        dropName: give.name,
      });
      break;
    }
  }

  suggestions.sort((a, b) => b.titleDelta - a.titleDelta || b.pointsDelta - a.pointsDelta);

  const why: string[] = [];
  const strength = grades.filter((g) => g.verdict === "strength").map((g) => g.position);
  const weakness = grades.filter((g) => g.verdict === "weakness").map((g) => g.position);
  if (strength.length) why.push(`Top-tier production at ${strength.join(", ")}.`);
  if (weakness.length) why.push(`Losing points every week at ${weakness.join(", ")}.`);
  why.push(`Projected to score ${baseMine.projPointsPerWeek.toFixed(1)} points a week, ranked #${baseMine.powerRank} in the league.`);
  if (suggestions[0]) {
    why.push(
      `Your best available move (${suggestions[0].headline}) is worth ${(suggestions[0].titleDelta * 100).toFixed(1)} points of title odds.`,
    );
  }

  const myTeamRow = teams.find((t) => t.id === mine.id)!;

  // Player metadata for status badges and alerts.
  const playerMeta = new Map(
    players.map((p) => [
      p.full_name.trim().toLowerCase(),
      { status: p.status ?? "Active", nflTeam: p.nfl_team ?? null, byeWeek: p.bye_week ?? null },
    ]),
  );
  const metaFor = (name: string) => playerMeta.get(name.trim().toLowerCase()) ?? { status: "Active", nflTeam: null, byeWeek: null };

  const alerts: Alert[] = [];
  for (const s of best.starters) {
    if (!s.player) continue;
    const meta = metaFor(s.player.name);
    const status = meta.status.toLowerCase();
    if (["out", "ir"].includes(status)) {
      alerts.push({
        id: `injury-${s.player.name}`,
        kind: "injury",
        playerName: s.player.name,
        position: s.player.position,
        message: `${s.player.name} is listed as ${meta.status} in your starting lineup.`,
        severity: "high",
        action: { label: "Find replacement", playerName: s.player.name },
      });
    } else if (["doubtful", "questionable"].includes(status)) {
      alerts.push({
        id: `injury-${s.player.name}`,
        kind: "injury",
        playerName: s.player.name,
        position: s.player.position,
        message: `${s.player.name} is ${meta.status} — check status before kickoff.`,
        severity: status === "doubtful" ? "high" : "medium",
        action: { label: "Find replacement", playerName: s.player.name },
      });
    }
    if (meta.byeWeek === league.current_week) {
      alerts.push({
        id: `bye-${s.player.name}`,
        kind: "bye",
        playerName: s.player.name,
        position: s.player.position,
        message: `${s.player.name} is on bye this week.`,
        severity: "high",
        action: { label: "Bench and replace", playerName: s.player.name },
      });
    }
  }

  const playoff = buildPlayoffPicture(simInputs, simConfig, schedule, baseline);

  // Persist this week's snapshot for trend charts.
  await saveWeeklySnapshot(supabase, leagueId, league.current_week, baseline, standings);

  return {
    league: toLeagueRow(league),
    slots,
    myTeam: {
      id: mine.id,
      name: mine.name,
      record: recordOf(myTeamRow),
      pointsFor: Number(myTeamRow.points_for),
      projPointsPerWeek: baseMine.projPointsPerWeek,
      powerRank: baseMine.powerRank,
      playoffOdds: baseMine.playoffOdds,
      titleOdds: baseMine.titleOdds,
      projWins: baseMine.projWins,
      projLosses: baseMine.projLosses,
      why,
    },
    standings,
    grades,
    lineup: best.starters.map((s) => ({
      slot: s.slot,
      name: s.player?.name ?? "Empty",
      position: s.player?.position ?? "-",
      proj: s.player?.proj ?? 0,
      ...metaFor(s.player?.name ?? ""),
    })),
    bench: best.bench.map((p) => ({ name: p.name, position: p.position, proj: p.proj, ...metaFor(p.name) })),
    suggestions: suggestions.slice(0, 12),
    scoreboard,
    tradeCandidates: engineTeams
      .filter((t) => !t.isMine)
      .flatMap((t) =>
        t.roster
          .sort((a, b) => b.proj - a.proj)
          .slice(0, 6)
          .map((p) => ({
            id: `${t.id}:${p.name}`,
            name: p.name,
            position: p.position,
            proj: p.proj,
            teamName: t.name,
            teamId: t.id,
          })),
      ),
    myTradeable: mine.roster
      .sort((a, b) => b.proj - a.proj)
      .map((p) => ({ id: p.name, name: p.name, position: p.position, proj: p.proj })),
    playoff,
    alerts,
  };
}

async function saveWeeklySnapshot(
  supabase: DB,
  leagueId: string,
  week: number,
  baseline: SimTeamResult[],
  standings: (SimTeamResult & { record: string; pointsFor: number })[],
) {
  const { data: league } = await supabase.from("leagues").select("user_id").eq("id", leagueId).single();
  if (!league) return;

  const rows = baseline.map((r) => {
    const standing = standings.find((s) => s.id === r.id);
    return {
      user_id: league.user_id,
      league_id: leagueId,
      team_id: r.id,
      week,
      title_odds: r.titleOdds,
      playoff_odds: r.playoffOdds,
      proj_wins: r.projWins,
      proj_losses: r.projLosses,
      power_score: r.projPointsPerWeek,
    };
  });

  await supabase.from("weekly_snapshots").upsert(rows, { onConflict: "league_id,team_id,week" });
}

/** Evaluates a specific proposed trade for the signed-in manager's team. */
export async function evaluateTrade(
  supabase: DB,
  leagueId: string,
  giveNames: string[],
  getNames: { name: string; position: string; proj: number }[],
) {
  const analysis = await buildAnalysis(supabase, leagueId);
  if (!analysis.myTeam) throw new Error("Mark one team as yours first.");

  const { data: spots } = await supabase
    .from("roster_spots")
    .select("*")
    .eq("team_id", analysis.myTeam.id);

  const roster: EnginePlayer[] = (spots ?? []).map((s) => ({
    id: s.player_id,
    name: s.player_name,
    position: s.position.toUpperCase(),
    nflTeam: s.nfl_team,
    proj: Number(s.proj_points),
    volatility: 0.35,
  }));

  const kept = roster.filter((p) => !giveNames.includes(p.name));
  const next = [
    ...kept,
    ...getNames.map<EnginePlayer>((p) => ({
      id: null,
      name: p.name,
      position: p.position.toUpperCase(),
      proj: p.proj,
      volatility: 0.35,
    })),
  ];

  const before = optimalLineup(roster, analysis.slots).total;
  const after = optimalLineup(next, analysis.slots).total;

  // Re-run the season with the post-trade roster to get real odds movement.
  const [{ data: teamRows }, { data: matchupRows }, { data: allSpots }] = await Promise.all([
    supabase.from("teams").select("*").eq("league_id", leagueId),
    supabase.from("matchups").select("*").eq("league_id", leagueId),
    supabase.from("roster_spots").select("*").eq("league_id", leagueId),
  ]);

  const simInputs = (teamRows ?? []).map((t) => {
    const teamRoster: EnginePlayer[] = (allSpots ?? [])
      .filter((s) => s.team_id === t.id)
      .map((s) => ({
        id: s.player_id,
        name: s.player_name,
        position: s.position.toUpperCase(),
        nflTeam: s.nfl_team,
        proj: Number(s.proj_points),
        volatility: 0.35,
      }));
    const games = t.wins + t.losses + t.ties;
    const dist = teamRoster.length
      ? teamDistribution(teamRoster, analysis.slots)
      : { mean: games > 0 ? Number(t.points_for) / games : 100, sd: 22 };
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
    playoffTeams: analysis.league.playoff_teams,
    regularSeasonWeeks: analysis.league.regular_season_weeks,
    currentWeek: analysis.league.current_week,
  };

  const nextDist = teamDistribution(next, analysis.slots);
  const afterInputs = simInputs.map((t) =>
    t.id === analysis.myTeam!.id ? { ...t, mean: nextDist.mean, sd: nextDist.sd } : t,
  );
  const afterSim = simulateSeason(afterInputs, simConfig, schedule, 1500, 7);
  const afterMine = afterSim.find((r) => r.id === analysis.myTeam!.id)!;

  return {
    pointsDelta: Math.round((after - before) * 10) / 10,
    beforeTitleOdds: analysis.myTeam.titleOdds,
    afterTitleOdds: afterMine.titleOdds,
    beforePlayoffOdds: analysis.myTeam.playoffOdds,
    afterPlayoffOdds: afterMine.playoffOdds,
    beforeWins: analysis.myTeam.projWins,
    afterWins: afterMine.projWins,
    verdict:
      afterMine.titleOdds - analysis.myTeam.titleOdds > 0.01
        ? "accept"
        : afterMine.titleOdds - analysis.myTeam.titleOdds < -0.01
          ? "decline"
          : "even",
    before,
    after,
  };
}
