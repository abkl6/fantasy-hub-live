/**
 * Prices and grades a specific proposed trade between any two teams in a
 * league: market value, both teams' odds movement, dynasty future value and
 * how likely the other manager is to say yes. Server-only.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

import {
  optimalLineup,
  simulateSeason,
  teamDistribution,
  type EnginePlayer,
  type ScheduleGame,
} from "./engine";
import { asFormat, bestBallDistribution, hasLineupDecisions, isMultiYear } from "./format";
import { leagueDynastyValues, type DynastyTeamInput } from "./dynasty-value";
import { normalizeName } from "./names";
import { loadProjections } from "./projections.server";
import { resolveProjectionSource } from "./projection-source";
import { leagueScoring } from "./scoring";
import { classifyTeam, isWinNow, type TeamBadge } from "./team-class";
import { loadSlotPlan } from "./slots.server";
import {
  fairnessOf,
  fairnessLabel,
  leagueValueFormat,
  loadTradeValues,
  pickLabel,
  type Fairness,
  type PickSlot,
  type TradeAsset,
  type ValueFormat,
} from "./trade-value";

type DB = SupabaseClient<Database>;

export type ProposalAsset =
  | { kind: "player"; name: string; position: string }
  | { kind: "pick"; season: number; round: number; slot: PickSlot };

export interface ProposalInput {
  leagueId: string;
  teamAId: string;
  teamBId: string;
  /** What team A sends to team B. */
  aGives: ProposalAsset[];
  /** What team B sends to team A. */
  bGives: ProposalAsset[];
}

export interface ProposalSide {
  teamId: string;
  teamName: string;
  isMine: boolean;
  badge: TeamBadge;
  sends: { label: string; value: number }[];
  receives: { label: string; value: number }[];
  sendValue: number;
  receiveValue: number;
  valueDelta: number;
  pointsBefore: number;
  pointsAfter: number;
  titleBefore: number;
  titleAfter: number;
  playoffBefore: number;
  playoffAfter: number;
  winsBefore: number;
  winsAfter: number;
  dynastyBefore: number | null;
  dynastyAfter: number | null;
  dynastyRankBefore: number | null;
  dynastyRankAfter: number | null;
}

export interface ProposalResult {
  leagueName: string;
  isDynasty: boolean;
  valueFormat: ValueFormat;
  fairness: Fairness;
  fairnessText: string;
  /** 0-1 chance the other manager accepts. */
  acceptance: number;
  acceptanceBand: string;
  acceptanceReasons: string[];
  a: ProposalSide;
  b: ProposalSide;
}

export interface ProposalTeam {
  id: string;
  name: string;
  isMine: boolean;
  badge: TeamBadge;
  dynastyValue: number | null;
  dynastyRank: number | null;
  players: { name: string; position: string; value: number; proj: number }[];
  picks: { label: string; season: number; round: number; slot: PickSlot; value: number }[];
}

export interface ProposalBoard {
  leagueId: string;
  leagueName: string;
  isDynasty: boolean;
  valueFormat: ValueFormat;
  teams: ProposalTeam[];
}

interface LoadedLeague {
  league: Database["public"]["Tables"]["leagues"]["Row"];
  slots: string[];
  isDynasty: boolean;
  bestBall: boolean;
  values: Awaited<ReturnType<typeof loadTradeValues>>;
  rosters: Map<string, EnginePlayer[]>;
  seasonProj: Map<string, number>;
  picksByTeam: Map<string, TradeAsset[]>;
  teams: { id: string; name: string; isMine: boolean; wins: number; losses: number; ties: number; pointsFor: number }[];
  schedule: ScheduleGame[];
  simConfig: {
    playoffTeams: number;
    regularSeasonWeeks: number;
    currentWeek: number;
    byes?: number;
  };
}


export async function loadLeague(supabase: DB, leagueId: string): Promise<LoadedLeague> {
  const { data: league, error } = await supabase.from("leagues").select("*").eq("id", leagueId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!league) throw new Error("League not found.");

  const [{ data: teamRows }, { data: spotRows }, { data: matchupRows }, { data: pickRows }] = await Promise.all([
    supabase.from("teams").select("*").eq("league_id", leagueId).order("name"),
    supabase.from("roster_spots").select("*").eq("league_id", leagueId),
    supabase.from("matchups").select("*").eq("league_id", leagueId),
    supabase.from("team_draft_picks").select("team_id, season, round, slot, count").eq("league_id", leagueId),
  ]);

  const slots = (await loadSlotPlan(supabase, leagueId)).keys;
  const format = asFormat((league as { format?: string }).format);
  const scoring = leagueScoring(league.scoring_type, (league.scoring_rules ?? {}) as Record<string, number>);
  const proj = await loadProjections(supabase, {
    scoring,
    week: league.current_week ?? 1,
    source: resolveProjectionSource(league),
    sos: (league as { sos_adjust?: boolean }).sos_adjust,
  });
  const values = await loadTradeValues(supabase, leagueValueFormat(slots));

  const rosters = new Map<string, EnginePlayer[]>();
  const seasonProj = new Map<string, number>();
  for (const s of spotRows ?? []) {
    const position = s.position.toUpperCase();
    const week = proj.week(s.player_id, s.player_name, position, Number(s.proj_points));
    const list = rosters.get(s.team_id) ?? [];
    list.push({ id: s.player_id, name: s.player_name, position, nflTeam: s.nfl_team, proj: week, volatility: 0.35 });
    rosters.set(s.team_id, list);
    seasonProj.set(normalizeName(s.player_name), proj.season(s.player_id, s.player_name, position, week * 17, null));
  }

  const picksByTeam = new Map<string, TradeAsset[]>();
  for (const row of pickRows ?? []) {
    const slot = String(row.slot) as PickSlot;
    const list = picksByTeam.get(row.team_id) ?? [];
    for (let i = 0; i < Math.min(Number(row.count ?? 1), 6); i += 1) {
      list.push({
        kind: "pick",
        season: row.season,
        round: row.round,
        slot,
        label: pickLabel(row.season, row.round, slot),
        value: values.pick(row.season, row.round, slot),
      });
    }
    picksByTeam.set(row.team_id, list);
  }

  return {
    league,
    slots,
    isDynasty: isMultiYear(format),
    bestBall: !hasLineupDecisions(format),
    values,
    rosters,
    seasonProj,
    picksByTeam,
    teams: (teamRows ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      isMine: t.is_mine,
      wins: t.wins,
      losses: t.losses,
      ties: t.ties,
      pointsFor: Number(t.points_for),
    })),
    schedule: (matchupRows ?? [])
      .filter((m) => m.home_team_id && m.away_team_id)
      .map((m) => ({ week: m.week, homeTeamId: m.home_team_id!, awayTeamId: m.away_team_id! })),
    simConfig: {
      playoffTeams: league.playoff_teams,
      byes: Number((league as { playoff_byes?: number | null }).playoff_byes ?? 0),
      regularSeasonWeeks: league.regular_season_weeks,
      currentWeek: league.current_week,
    },
  };
}

function dynastyInputs(ctx: LoadedLeague, rosters: Map<string, EnginePlayer[]>): DynastyTeamInput[] {
  return ctx.teams.map((t) => ({
    id: t.id,
    name: t.name,
    isMine: t.isMine,
    players: (rosters.get(t.id) ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      position: p.position,
      projSeason: ctx.seasonProj.get(normalizeName(p.name)) ?? p.proj * 17,
    })),
    picks: ctx.picksByTeam.get(t.id) ?? [],
  }));
}

function simulate(ctx: LoadedLeague, rosters: Map<string, EnginePlayer[]>, iterations: number) {
  const distributionOf = (roster: EnginePlayer[]) =>
    ctx.bestBall ? bestBallDistribution(roster, ctx.slots) : teamDistribution(roster, ctx.slots);
  const inputs = ctx.teams.map((t) => {
    const roster = rosters.get(t.id) ?? [];
    const games = t.wins + t.losses + t.ties;
    const dist = roster.length
      ? distributionOf(roster)
      : { mean: games > 0 ? t.pointsFor / games : 100, sd: 22 };
    return { ...t, mean: dist.mean, sd: dist.sd };
  });
  return simulateSeason(inputs, ctx.simConfig, ctx.schedule, iterations, 7);
}

function assetValue(ctx: LoadedLeague, teamId: string, asset: ProposalAsset) {
  if (asset.kind === "pick") {
    return {
      label: pickLabel(asset.season, asset.round, asset.slot),
      value: ctx.values.pick(asset.season, asset.round, asset.slot),
    };
  }
  const player = (ctx.rosters.get(teamId) ?? []).find((p) => normalizeName(p.name) === normalizeName(asset.name));
  const position = (player?.position ?? asset.position).toUpperCase();
  const season = ctx.seasonProj.get(normalizeName(asset.name)) ?? (player?.proj ?? 0) * 17;
  return {
    label: `${player?.name ?? asset.name} (${position})`,
    value: ctx.values.player(player?.id ?? null, asset.name, position, season),
  };
}

/** Swaps the traded players between the two rosters. */
function swappedRosters(ctx: LoadedLeague, input: ProposalInput) {
  const next = new Map(ctx.rosters);
  const aRoster = [...(ctx.rosters.get(input.teamAId) ?? [])];
  const bRoster = [...(ctx.rosters.get(input.teamBId) ?? [])];
  const take = (roster: EnginePlayer[], assets: ProposalAsset[]) => {
    const moved: EnginePlayer[] = [];
    for (const asset of assets) {
      if (asset.kind !== "player") continue;
      const i = roster.findIndex((p) => normalizeName(p.name) === normalizeName(asset.name));
      if (i >= 0) moved.push(...roster.splice(i, 1));
    }
    return moved;
  };
  const fromA = take(aRoster, input.aGives);
  const fromB = take(bRoster, input.bGives);
  next.set(input.teamAId, [...aRoster, ...fromB]);
  next.set(input.teamBId, [...bRoster, ...fromA]);
  return next;
}

const BANDS: [number, string][] = [
  [0.78, "Very likely"],
  [0.58, "Likely"],
  [0.42, "Coin flip"],
  [0.22, "Unlikely"],
  [0, "Long shot"],
];

export function acceptanceBandOf(score: number) {
  return BANDS.find(([floor]) => score >= floor)?.[1] ?? "Long shot";
}

/**
 * How likely the receiving manager (team B) says yes. Blends the market value
 * gap, what the deal does to their season, and whether it fits how their team
 * is built — a win-now roster chases this year's odds, a rebuild wants value.
 */
export function acceptanceScore(opts: {
  bSendValue: number;
  bReceiveValue: number;
  bTitleDelta: number;
  bPlayoffDelta: number;
  bDynastyDelta: number | null;
  bWinNow: boolean;
  isDynasty: boolean;
}) {
  const base = Math.max(1, (opts.bSendValue + opts.bReceiveValue) / 2);
  const valueEdge = (opts.bReceiveValue - opts.bSendValue) / base; // + means they gain value
  let score = 0.5 + valueEdge * 1.2;

  const seasonWeight = opts.bWinNow ? 3.2 : 1.2;
  score += (opts.bTitleDelta * 1.5 + opts.bPlayoffDelta) * seasonWeight;

  if (opts.isDynasty && opts.bDynastyDelta != null) {
    const dynWeight = opts.bWinNow ? 0.35 : 1.1;
    score += (opts.bDynastyDelta / base) * dynWeight;
  }

  return Math.max(0.02, Math.min(0.97, score));
}

export async function evaluateProposal(supabase: DB, input: ProposalInput): Promise<ProposalResult> {
  if (input.teamAId === input.teamBId) throw new Error("Pick two different teams.");
  if (!input.aGives.length && !input.bGives.length) throw new Error("Add at least one player or pick.");

  const ctx = await loadLeague(supabase, input.leagueId);
  const teamA = ctx.teams.find((t) => t.id === input.teamAId);
  const teamB = ctx.teams.find((t) => t.id === input.teamBId);
  if (!teamA || !teamB) throw new Error("Those teams are not in this league.");

  const aSends = input.aGives.map((a) => assetValue(ctx, input.teamAId, a));
  const bSends = input.bGives.map((a) => assetValue(ctx, input.teamBId, a));
  const aSendValue = Math.round(aSends.reduce((s, x) => s + x.value, 0));
  const bSendValue = Math.round(bSends.reduce((s, x) => s + x.value, 0));

  const beforeRosters = ctx.rosters;
  const afterRosters = swappedRosters(ctx, input);

  const before = simulate(ctx, beforeRosters, 1500);
  const after = simulate(ctx, afterRosters, 1500);
  const beforeById = new Map(before.map((r) => [r.id, r]));
  const afterById = new Map(after.map((r) => [r.id, r]));

  // Dynasty future value moves with the picks too, so rebuild the pick stock.
  const pickMoves = (from: string, to: string, assets: ProposalAsset[]) => {
    for (const asset of assets) {
      if (asset.kind !== "pick") continue;
      const fromList = [...(ctx.picksByTeam.get(from) ?? [])];
      const i = fromList.findIndex(
        (p) => p.kind === "pick" && p.season === asset.season && p.round === asset.round && p.slot === asset.slot,
      );
      const moved = i >= 0 ? fromList.splice(i, 1) : [];
      ctx.picksByTeam.set(from, fromList);
      if (moved.length) ctx.picksByTeam.set(to, [...(ctx.picksByTeam.get(to) ?? []), ...moved]);
    }
  };

  const dynBefore = ctx.isDynasty ? leagueDynastyValues(dynastyInputs(ctx, beforeRosters), ctx.values) : null;
  pickMoves(input.teamAId, input.teamBId, input.aGives);
  pickMoves(input.teamBId, input.teamAId, input.bGives);
  const dynAfter = ctx.isDynasty ? leagueDynastyValues(dynastyInputs(ctx, afterRosters), ctx.values) : null;

  const oddsRankBefore = new Map(
    [...before].sort((x, y) => y.titleOdds - x.titleOdds).map((r, i) => [r.id, i + 1] as const),
  );

  const sideFor = (
    team: typeof teamA,
    sends: { label: string; value: number }[],
    receives: { label: string; value: number }[],
  ): ProposalSide => {
    const b = beforeById.get(team.id)!;
    const a = afterById.get(team.id)!;
    const dBefore = dynBefore?.find((d) => d.teamId === team.id) ?? null;
    const dAfter = dynAfter?.find((d) => d.teamId === team.id) ?? null;
    const badge = classifyTeam({
      titleOdds: b.titleOdds,
      playoffOdds: b.playoffOdds,
      oddsRank: oddsRankBefore.get(team.id) ?? ctx.teams.length,
      teamCount: ctx.teams.length,
      isDynasty: ctx.isDynasty,
      dynastyRank: dBefore?.rank ?? null,
    });
    return {
      teamId: team.id,
      teamName: team.name,
      isMine: team.isMine,
      badge,
      sends,
      receives,
      sendValue: Math.round(sends.reduce((s, x) => s + x.value, 0)),
      receiveValue: Math.round(receives.reduce((s, x) => s + x.value, 0)),
      valueDelta: Math.round(receives.reduce((s, x) => s + x.value, 0) - sends.reduce((s, x) => s + x.value, 0)),
      pointsBefore: optimalLineup(beforeRosters.get(team.id) ?? [], ctx.slots).total,
      pointsAfter: optimalLineup(afterRosters.get(team.id) ?? [], ctx.slots).total,
      titleBefore: b.titleOdds,
      titleAfter: a.titleOdds,
      playoffBefore: b.playoffOdds,
      playoffAfter: a.playoffOdds,
      winsBefore: b.projWins,
      winsAfter: a.projWins,
      dynastyBefore: dBefore?.total ?? null,
      dynastyAfter: dAfter?.total ?? null,
      dynastyRankBefore: dBefore?.rank ?? null,
      dynastyRankAfter: dAfter?.rank ?? null,
    };
  };

  const a = sideFor(teamA, aSends, bSends);
  const b = sideFor(teamB, bSends, aSends);

  const bWinNow = isWinNow({
    titleOdds: b.titleBefore,
    playoffOdds: b.playoffBefore,
    oddsRank: oddsRankBefore.get(teamB.id) ?? ctx.teams.length,
    teamCount: ctx.teams.length,
    isDynasty: ctx.isDynasty,
    dynastyRank: b.dynastyRankBefore,
  });
  const bDynastyDelta =
    b.dynastyAfter != null && b.dynastyBefore != null ? b.dynastyAfter - b.dynastyBefore : null;

  const acceptance = acceptanceScore({
    bSendValue,
    bReceiveValue: aSendValue,
    bTitleDelta: b.titleAfter - b.titleBefore,
    bPlayoffDelta: b.playoffAfter - b.playoffBefore,
    bDynastyDelta,
    bWinNow,
    isDynasty: ctx.isDynasty,
  });

  const reasons: string[] = [];
  const valueGap = aSendValue - bSendValue;
  if (Math.abs(valueGap) / Math.max(1, (aSendValue + bSendValue) / 2) <= 0.1) {
    reasons.push("Market value is close to even, so neither side is being asked to eat a loss.");
  } else if (valueGap > 0) {
    reasons.push(`${teamB.name} gains about ${Math.abs(valueGap).toLocaleString()} in market value.`);
  } else {
    reasons.push(`${teamB.name} gives up about ${Math.abs(valueGap).toLocaleString()} in market value.`);
  }
  const bPlayoffSwing = (b.playoffAfter - b.playoffBefore) * 100;
  reasons.push(
    `${bWinNow ? "They are chasing this season" : "They are building for later"}, and this moves their playoff chance ${bPlayoffSwing >= 0 ? "+" : ""}${bPlayoffSwing.toFixed(1)} points.`,
  );
  if (ctx.isDynasty && bDynastyDelta != null) {
    reasons.push(
      `Their dynasty future value ${bDynastyDelta >= 0 ? "rises" : "falls"} by ${Math.abs(Math.round(bDynastyDelta)).toLocaleString()}.`,
    );
  }

  return {
    leagueName: ctx.league.name,
    isDynasty: ctx.isDynasty,
    valueFormat: ctx.values.format,
    fairness: fairnessOf(aSendValue, bSendValue),
    fairnessText: fairnessLabel(aSendValue, bSendValue),
    acceptance,
    acceptanceBand: acceptanceBandOf(acceptance),
    acceptanceReasons: reasons,
    a,
    b,
  };
}

/** Everything the trade builder needs to render its pickers for one league. */
export async function buildProposalBoard(supabase: DB, leagueId: string): Promise<ProposalBoard> {
  const ctx = await loadLeague(supabase, leagueId);
  const sim = simulate(ctx, ctx.rosters, 1200);
  const simById = new Map(sim.map((r) => [r.id, r]));
  const oddsRank = new Map(
    [...sim].sort((x, y) => y.titleOdds - x.titleOdds).map((r, i) => [r.id, i + 1] as const),
  );
  const dyn = ctx.isDynasty ? leagueDynastyValues(dynastyInputs(ctx, ctx.rosters), ctx.values) : null;

  return {
    leagueId,
    leagueName: ctx.league.name,
    isDynasty: ctx.isDynasty,
    valueFormat: ctx.values.format,
    teams: ctx.teams.map((t) => {
      const row = simById.get(t.id);
      const d = dyn?.find((x) => x.teamId === t.id) ?? null;
      return {
        id: t.id,
        name: t.name,
        isMine: t.isMine,
        badge: classifyTeam({
          titleOdds: row?.titleOdds ?? 0,
          playoffOdds: row?.playoffOdds ?? 0,
          oddsRank: oddsRank.get(t.id) ?? ctx.teams.length,
          teamCount: ctx.teams.length,
          isDynasty: ctx.isDynasty,
          dynastyRank: d?.rank ?? null,
        }),
        dynastyValue: d?.total ?? null,
        dynastyRank: d?.rank ?? null,
        players: (ctx.rosters.get(t.id) ?? [])
          .map((p) => ({
            name: p.name,
            position: p.position,
            proj: p.proj,
            value: ctx.values.player(
              p.id,
              p.name,
              p.position,
              ctx.seasonProj.get(normalizeName(p.name)) ?? p.proj * 17,
            ),
          }))
          .sort((x, y) => y.value - x.value),
        picks: (ctx.picksByTeam.get(t.id) ?? [])
          .filter((a): a is Extract<TradeAsset, { kind: "pick" }> => a.kind === "pick")
          .map((a) => ({ label: a.label, season: a.season, round: a.round, slot: a.slot, value: a.value }))
          .sort((x, y) => x.season - y.season || x.round - y.round),
      };
    }),
  };
}
