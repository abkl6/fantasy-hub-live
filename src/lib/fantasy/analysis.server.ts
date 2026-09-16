/** Loads a league from the database and produces the full analyzer payload. Server-only. */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

import {
  optimalLineup,
  positionGrades,
  simulatePointsRace,
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
import {
  asAllPlayWeeks,
  asContestFormat,
  CONTEST_LABELS,
  hasPointsRace,
  usesVictoryPoints,
  type ContestFormat,
} from "./contest";
import { loadProjections } from "./projections.server";
import { resolveProjectionSource } from "./projection-source";
import { fetchAllRows } from "./paginate";
import { normalizeName } from "./names";
import { leagueScoring } from "./scoring";
import { classifyTeam, classifySurvivalTeam, type TeamBadge } from "./team-class";
import { bidLadder, type BidLadder, type FaabRival } from "./faab";
import {
  asFormat,
  bestBallDistribution,
  blendedValue,
  dynastyValue,
  dynastyValueDetail,
  FORMAT_LABELS,
  hasLineupDecisions,
  isMultiYear,
  isSurvival,
  simulateGuillotine,
  type LeagueFormat,
  type SurvivalResult,
} from "./format";
import {
  asLeagueType,
  asTypeSource,
  asVariant,
  showsPickValues,
  showsSurvival,
  typeSourceLabel,
  type LeagueType,
  type LeagueVariant,
  type TypeSource,
} from "./league-type";
import {
  assetLabel,
  balanceTrade,
  fairnessLabel,
  leagueValueFormat,
  loadTradeValues,
  pickLabel,
  type Fairness,
  type PickSlot,
  type TradeAsset,
  type ValueFormat,
} from "./trade-value";
import { leagueDynastyValues } from "./dynasty-value";
import { tierFromRank, trajectoryFor, type Trajectory } from "./age-curve";
import { loadAgeCurves } from "./age-curve.server";
import {
  ageLane,
  partnerModes,
  strategyFor,
  strategyMode,
  type StrategyMode,
  type TeamStrategy,
} from "./strategy";
import { acceptanceBandOf, acceptanceScore } from "./proposal.server";


type DB = SupabaseClient<Database>;

/**
 * Keeps every idea that clears the bar, and if fewer than five do, pads the
 * list with the next best ones so the manager always sees five options.
 */
function keepTopFive<T>(sorted: T[], clears: (item: T) => boolean): T[] {
  const good = sorted.filter(clears);
  if (good.length >= 5) return good;
  const rest = sorted.filter((item) => !clears(item));
  return [...good, ...rest.slice(0, 5 - good.length)];
}


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
  format: string;
  projection_source: string;
  /** True when a platform read failed and the stored copy is being kept. */
  sync_paused?: boolean;
  last_sync_error?: string | null;
}

/** Value now / +1yr / +2yr for one player, or null when the age is unknown. */
export type PlayerTrajectory = Trajectory;

/** One line about where a dynasty roster sits on the age curve. */
export interface DynastyOutlook {
  /** Share of team value tied up in players at or past their position peak. */
  pastPeakShare: number;
  contentionWindow: string;
  sellSoon: { name: string; position: string; value: number; classification: string; change1: number }[];
}

export interface DynastyRow {
  name: string;
  position: string;
  age: number | null;
  trajectory: PlayerTrajectory | null;
  /** Where the age came from: the market, years of experience, or nowhere. */
  ageSource: "age" | "experience" | "unknown";
  longTermValue: number;
  blendedValue: number;
}

export interface MoveSuggestion {
  id: string;
  kind: "start-sit" | "waiver" | "trade";
  /** Guillotine only: the three suggested FAAB bids for this pickup. */
  bids?: BidLadder | null;
  headline: string;
  detail: string;
  pointsDelta: number;
  winDelta: number;
  titleDelta: number;
  playoffDelta: number;
  addName?: string;
  dropName?: string;
  /** Dynasty market pricing, present on trade suggestions. */
  giveValue?: number;
  getValue?: number;
  fairness?: Fairness;
  giveAssets?: string[];
  getAssets?: string[];
  valueFormat?: ValueFormat;
  /** Which posture this idea comes from: buying now or selling for later. */
  strategy?: StrategyMode;
  strategyLabel?: string;
  rationale?: string;
  /** Future (market) value gained by the trade; negative means you paid. */
  dynastyDelta?: number;
  /** Weekly lineup points the other team gains (negative = it hurts them). */
  partnerPointsDelta?: number;
  /** 0-1 chance the other manager says yes, with a plain-language band. */
  acceptance?: number;
  acceptanceBand?: string;
  acceptanceReason?: string;
}


/** One row of the season-long total points table. */
export interface PointsStandingRow {
  teamId: string;
  name: string;
  isMine: boolean;
  totalPoints: number;
  weeklyAverage: number;
  /** Best single week, null when no finished weeks are stored. */
  highWeek: number | null;
  gapToLeader: number;
  /** Times this team was the league's top scorer in a week. */
  weeklyHighs: number;
  firstOdds: number;
  topThreeOdds: number;
  topNOdds: number | null;
  rank: number;
  /** Gap to the leader after each finished week, for the trend line. */
  gapHistory: { week: number; gap: number }[];
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
  standings: (SimTeamResult & {
    record: string;
    pointsFor: number;
    badge: TeamBadge;
    /** KTC market value of roster + picks; dynasty leagues only. */
    dynastyValue: number | null;
    dynastyRank: number | null;
    /** Roster spots with no age anywhere — usually an unmatched name. */
    unknownAgeCount: number;
    /** Weeks this team was the league's top scorer. */
    weeklyHighs: number;
    /** Victory points banked; victory-point leagues only. */
    vp: number;
  })[];
  grades: PositionGrade[];
  lineup: { slot: string; name: string; position: string; proj: number; status: string; nflTeam: string | null; byeWeek: number | null; trajectory: PlayerTrajectory | null }[];
  bench: { name: string; position: string; proj: number; status: string; nflTeam: string | null; byeWeek: number | null; trajectory: PlayerTrajectory | null }[];
  suggestions: MoveSuggestion[];
  scoreboard: ScoreboardGame[];
  tradeCandidates: { id: string; name: string; position: string; proj: number; teamName: string; teamId: string }[];
  myTradeable: { id: string; name: string; position: string; proj: number }[];
  playoff: PlayoffPayload;
  alerts: Alert[];
  format: LeagueFormat;
  formatLabel: string;
  /** Redraft / keeper / dynasty, its variant, and where those came from. */
  leagueType: LeagueType;
  variant: LeagueVariant;
  typeSource: TypeSource;
  typeSourceLabel: string;
  /** Feature switches driven by the league type. */
  showPickValues: boolean;
  showSurvival: boolean;
  /** How the league is won: head to head, total points, or both. */
  contestFormat: ContestFormat;
  contestLabel: string;
  /** Total points table; null on pure head-to-head leagues. */
  pointsStandings: PointsStandingRow[] | null;
  pointsPlayoff: { teams: number | null; afterWeek: number | null };
  weeklyHighBonus: boolean;
  weeklyHighLabel: string | null;
  scoringLabel: string;
  /** Where the projections on this page come from. */
  projectionLabel: string;
  /** Guillotine only: weekly survival odds instead of playoff/title odds. */
  survival: SurvivalResult[] | null;
  mySurvival: SurvivalResult | null;
  /** Dynasty / keeper only: long-term value of my roster. */
  dynasty: DynastyRow[] | null;
  /** Dynasty / keeper only: the age-curve read on my roster. */
  dynastyOutlook: DynastyOutlook | null;
  /** True when the league shows value trajectories (dynasty, keeper, empire). */
  showTrajectories: boolean;
  /** True while the dynasty market is still being fetched after an import. */
  valuesPending: boolean;
  /** My team's badge and the trading posture that follows from it. */
  myBadge: TeamBadge | null;
  myStrategy: TeamStrategy | null;
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

  const [{ data: teamRows }, { data: spotRows }, { data: matchupRows }, playerRows] =
    await Promise.all([
      supabase.from("teams").select("*").eq("league_id", leagueId),
      supabase.from("roster_spots").select("*").eq("league_id", leagueId),
      supabase.from("matchups").select("*").eq("league_id", leagueId),
      fetchAllRows((from, to) => supabase.from("players").select("*").order("id").range(from, to)),
    ]);

  const slots = asSlots(league.roster_slots);
  const teams = teamRows ?? [];
  const spots = spotRows ?? [];
  const matchups = matchupRows ?? [];
  const players = playerRows;

  // Every projection below is re-scored against this league's own rules, so
  // half-PPR, TE-premium or 6-point passing TDs change the numbers.
  const scoring = leagueScoring(league.scoring_type, (league.scoring_rules ?? {}) as Record<string, number>);

  // The member's own projection adjustments replace the shared baseline.
  const proj = await loadProjections(supabase, {
    scoring,
    week: league.current_week ?? 1,
    source: resolveProjectionSource(league),
  });
  const format = asFormat((league as { format?: string }).format);
  const leagueType = asLeagueType((league as { league_type?: string }).league_type);
  const variant = asVariant((league as { variant?: string }).variant);
  const typeSource = asTypeSource((league as { type_source?: string }).type_source);
  const bestBall = !hasLineupDecisions(format);

  // Dynasty trade currency: market values plus each team's future pick stock.
  const values = await loadTradeValues(supabase, leagueValueFormat(slots));
  const ageCurves = await loadAgeCurves(supabase, leagueValueFormat(slots));
  const { data: pickRows } = await supabase
    .from("team_draft_picks")
    .select("team_id, season, round, slot, count")
    .eq("league_id", league.id);
  const pickAssets = new Map<string, TradeAsset[]>();
  for (const row of pickRows ?? []) {
    const slot = String(row.slot) as PickSlot;
    const list = pickAssets.get(row.team_id) ?? [];
    for (let i = 0; i < Math.min(Number(row.count ?? 1), 4); i += 1) {
      list.push({
        kind: "pick",
        season: row.season,
        round: row.round,
        slot,
        label: pickLabel(row.season, row.round, slot),
        value: values.pick(row.season, row.round, slot),
      });
    }
    pickAssets.set(row.team_id, list);
  }

  // Anyone held by any team in the league is off the waiver wire, whatever
  // position label the platform used for them.
  const rosteredNames = new Set(spots.map((s) => normalizeName(s.player_name)));
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
        proj: proj.week(s.player_id, s.player_name, s.position.toUpperCase(), Number(s.proj_points)),
        volatility: 0.35,
      })),
  }));

  // --- future value and age lanes, which drive who should buy and who sells -
  const isDynastyLeague = isMultiYear(format);
  const dynastyRankById = new Map<string, number>();
  const dynastyValueById = new Map<string, number>();
  const unknownAgeById = new Map<string, number>();
  const ownAgeByName = new Map(
    players.map((p) => [
      normalizeName(p.full_name),
      {
        age: (p as { age?: number | null }).age ?? null,
        yearsExp: (p as { years_exp?: number | null }).years_exp ?? null,
      },
    ]),
  );
  /** The market first, then our own record; false means nobody knows. */
  const ageKnownFor = (p: EnginePlayer) => {
    if (values.age(p.id, p.name, p.position) != null) return true;
    const own = ownAgeByName.get(normalizeName(p.name));
    return own?.age != null || own?.yearsExp != null;
  };
  if (isDynastyLeague) {
    const rows = leagueDynastyValues(
      engineTeams.map((t) => ({
        id: t.id,
        name: t.name,
        isMine: t.isMine,
        players: t.roster.map((p) => ({
          id: p.id,
          name: p.name,
          position: p.position,
          projSeason: p.proj * 17,
          ageKnown: ageKnownFor(p),
        })),
        picks: pickAssets.get(t.id) ?? [],
      })),
      values,
    );
    for (const row of rows) {
      dynastyRankById.set(row.teamId, row.rank);
      dynastyValueById.set(row.teamId, row.total);
      unknownAgeById.set(row.teamId, row.unknownAgeCount);
    }
  }
  /**
   * Dynasty, keeper and empire leagues get a value trajectory per player.
   * A player whose age nobody knows gets none — they show in the unknown-age
   * notice instead of a made-up arrow.
   */
  const showTrajectories = isDynastyLeague || variant === "empire";
  const trajectoryOf = (
    name: string,
    position: string,
    id: string | null,
    projSeason: number,
  ): PlayerTrajectory | null => {
    if (!showTrajectories) return null;
    const own = ownAgeByName.get(normalizeName(name));
    const age = values.age(id, name, position) ?? own?.age ?? null;
    if (age == null) return null;
    const value = values.player(id, name, position, projSeason);
    if (!value) return null;
    return trajectoryFor({
      position,
      age,
      value,
      tier: tierFromRank(values.positionRank(id, name, position), league.team_count ?? 12, position),
      curve: ageCurves.curve(position),
    });
  };

  const laneOf = (p: EnginePlayer) => {
    const meta = ownAgeByName.get(normalizeName(p.name));
    const age = values.age(p.id, p.name, p.position) ?? meta?.age ?? null;
    return ageLane(p.position, age, meta?.yearsExp ?? null);
  };

  const distributionOf = (roster: EnginePlayer[]) =>
    bestBall ? bestBallDistribution(roster, slots) : teamDistribution(roster, slots);

  const vpByTeam = new Map(teams.map((t) => [t.id, Number((t as { vp?: number }).vp ?? 0)]));
  const simInputs = engineTeams.map((t) => {
    const dist = t.roster.length
      ? distributionOf(t.roster)
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
      vp: vpByTeam.get(t.id) ?? 0,
    };
  });

  const schedule: ScheduleGame[] = matchups
    .filter((m) => m.home_team_id && m.away_team_id)
    .map((m) => ({ week: m.week, homeTeamId: m.home_team_id!, awayTeamId: m.away_team_id! }));

  // FFPC-style leagues are seeded on victory points, and some weeks are
  // all-play (top half wins), so the simulation needs both up front.
  const contestFormat = asContestFormat((league as { contest_format?: string }).contest_format);
  const allPlayWeeks = asAllPlayWeeks((league as { all_play_weeks?: unknown }).all_play_weeks);
  const usesVp = usesVictoryPoints(contestFormat);

  const simConfig = {
    playoffTeams: league.playoff_teams,
    regularSeasonWeeks: league.regular_season_weeks,
    currentWeek: league.current_week,
    victoryPoints: usesVp,
    allPlayWeeks,
    byes: Number((league as { playoff_byes?: number | null }).playoff_byes ?? 0),
  };

  const baseline = simulateSeason(simInputs, simConfig, schedule, 2500, 7);
  const baselineById = new Map(baseline.map((r) => [r.id, r]));

  // Guillotine leagues have no playoffs: the lowest scorer is cut each week,
  // so survival odds drive both the badges and the bidding advice.
  const weeksLeft = Math.max(1, league.regular_season_weeks - league.current_week + 1);
  const survival = isSurvival(format)
    ? simulateGuillotine(
        simInputs.map((t) => ({ id: t.id, name: t.name, isMine: t.isMine, mean: t.mean, sd: t.sd })),
        weeksLeft,
      )
    : null;
  const survivalById = new Map((survival ?? []).map((r) => [r.id, r]));
  const leagueFaabBudget = Number((league as { faab_budget?: number }).faab_budget ?? 100) || 100;

  const mine = engineTeams.find((t) => t.isMine) ?? null;
  const teamById = new Map(teams.map((t) => [t.id, t]));

  const standings = [...baseline]
    .sort((a, b) =>
      usesVp
        ? (vpByTeam.get(b.id) ?? 0) - (vpByTeam.get(a.id) ?? 0) ||
          Number(teamById.get(b.id)?.points_for ?? 0) - Number(teamById.get(a.id)?.points_for ?? 0)
        : b.titleOdds - a.titleOdds || b.projWins - a.projWins,
    )
    .map((r, index) => {
      const row = teamById.get(r.id);
      return {
        ...r,
        record: row ? recordOf(row) : "0-0",
        pointsFor: row ? Number(row.points_for) : 0,
        badge: survivalById.get(r.id)
          ? classifySurvivalTeam({
              surviveWeekOdds: survivalById.get(r.id)!.surviveWeekOdds,
              winOdds: survivalById.get(r.id)!.winOdds,
              powerRank: survivalById.get(r.id)!.powerRank,
              teamCount: teams.length,
              faabRemaining: row?.faab_remaining ?? null,
              faabBudget: leagueFaabBudget,
            })
          : classifyTeam({
          titleOdds: r.titleOdds,
          playoffOdds: r.playoffOdds,
          oddsRank: index + 1,
          teamCount: teams.length,
          isDynasty: isDynastyLeague,
          dynastyRank: dynastyRankById.get(r.id) ?? null,
        }),
        dynastyValue: dynastyValueById.get(r.id) ?? null,
        dynastyRank: dynastyRankById.get(r.id) ?? null,
        unknownAgeCount: unknownAgeById.get(r.id) ?? 0,
        weeklyHighs: 0,
        vp: vpByTeam.get(r.id) ?? 0,
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




  // --- season-long total points race ---------------------------------------
  const pointsPlayoff = {
    teams: (league as { points_playoff_teams?: number | null }).points_playoff_teams ?? null,
    afterWeek: (league as { points_playoff_week?: number | null }).points_playoff_week ?? null,
  };
  const weeklyHighBonus = Boolean((league as { weekly_high_bonus?: boolean }).weekly_high_bonus);
  const weeklyHighLabel = (league as { weekly_high_label?: string | null }).weekly_high_label ?? null;

  /** Finished weekly scores per team, drawn from the stored matchups. */
  const weekScores = new Map<string, Map<number, number>>();
  for (const m of matchups) {
    if (!m.is_final) continue;
    for (const side of [
      { id: m.home_team_id, score: Number(m.home_score) },
      { id: m.away_team_id, score: Number(m.away_score) },
    ]) {
      if (!side.id) continue;
      const byWeek = weekScores.get(side.id) ?? new Map<number, number>();
      byWeek.set(m.week, side.score);
      weekScores.set(side.id, byWeek);
    }
  }
  const finishedWeeks = [...new Set([...weekScores.values()].flatMap((m) => [...m.keys()]))].sort(
    (a, b) => a - b,
  );
  const weeklyHighCount = new Map<string, number>();
  for (const w of finishedWeeks) {
    let best: { id: string; score: number } | null = null;
    for (const [teamId, byWeek] of weekScores) {
      const score = byWeek.get(w);
      if (score === undefined) continue;
      if (!best || score > best.score) best = { id: teamId, score };
    }
    if (best) weeklyHighCount.set(best.id, (weeklyHighCount.get(best.id) ?? 0) + 1);
  }

  for (const row of standings) row.weeklyHighs = weeklyHighCount.get(row.id) ?? 0;

  let pointsStandings: PointsStandingRow[] | null = null;
  if (hasPointsRace(contestFormat) && teams.length) {
    const raceWeeksLeft = Math.max(0, league.regular_season_weeks - (league.current_week - 1));
    const race = simulatePointsRace(
      simInputs.map((t) => ({
        id: t.id,
        name: t.name,
        isMine: t.isMine,
        pointsFor: t.pointsFor,
        mean: t.mean,
        sd: t.sd,
      })),
      { weeksLeft: raceWeeksLeft, topN: pointsPlayoff.teams },
      2000,
      31,
    );
    const raceById = new Map(race.map((r) => [r.id, r]));
    const leaderTotal = Math.max(...teams.map((t) => Number(t.points_for)), 0);

    // Running gap to the leader after each finished week.
    const cumulative = new Map<string, number>();
    const gapHistory = new Map<string, { week: number; gap: number }[]>();
    for (const w of finishedWeeks) {
      for (const t of teams) {
        const add = weekScores.get(t.id)?.get(w) ?? 0;
        cumulative.set(t.id, (cumulative.get(t.id) ?? 0) + add);
      }
      const lead = Math.max(...teams.map((t) => cumulative.get(t.id) ?? 0));
      for (const t of teams) {
        const list = gapHistory.get(t.id) ?? [];
        list.push({ week: w, gap: Math.round((lead - (cumulative.get(t.id) ?? 0)) * 10) / 10 });
        gapHistory.set(t.id, list);
      }
    }

    pointsStandings = teams
      .map((t) => {
        const total = Number(t.points_for);
        const weeks = [...(weekScores.get(t.id)?.values() ?? [])];
        const played = weeks.length || t.wins + t.losses + t.ties;
        return {
          teamId: t.id,
          name: t.name,
          isMine: t.is_mine,
          totalPoints: Math.round(total * 10) / 10,
          weeklyAverage: played > 0 ? Math.round((total / played) * 10) / 10 : 0,
          highWeek: weeks.length ? Math.round(Math.max(...weeks) * 10) / 10 : null,
          gapToLeader: Math.round((leaderTotal - total) * 10) / 10,
          weeklyHighs: weeklyHighCount.get(t.id) ?? 0,
          firstOdds: raceById.get(t.id)?.firstOdds ?? 0,
          topThreeOdds: raceById.get(t.id)?.topThreeOdds ?? 0,
          topNOdds: raceById.get(t.id)?.topNOdds ?? null,
          rank: 0,
          gapHistory: gapHistory.get(t.id) ?? [],
        };
      })
      .sort((a, b) => b.totalPoints - a.totalPoints)
      .map((row, i) => ({ ...row, rank: i + 1 }));
  }

  const formatMeta = {
    // No market book yet: the post-import fetch is still running.
    valuesPending: !values.covered,
    format,
    formatLabel: FORMAT_LABELS[format],
    leagueType,
    variant,
    typeSource,
    typeSourceLabel: typeSourceLabel(typeSource, league.platform),
    showPickValues: showsPickValues(leagueType, variant),
    showSurvival: showsSurvival(variant),
    contestFormat,
    contestLabel: CONTEST_LABELS[contestFormat],
    pointsStandings,
    pointsPlayoff,
    weeklyHighBonus,
    weeklyHighLabel,
    scoringLabel: scoring.label,
    projectionLabel: proj.sourceLabel,
    survival,
  };

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
      ...formatMeta,
      mySurvival: null,
      dynasty: null,
      dynastyOutlook: null,
      showTrajectories: isMultiYear(format) || variant === "empire",
      myBadge: null,
      myStrategy: null,
    };
  }

  const grades = positionGrades(mine, engineTeams, slots);
  const best = optimalLineup(mine.roster, slots);

  // --- what-if helper: re-run the season with my team's roster swapped -----
  const baseMine = baselineById.get(mine.id)!;
  const whatIf = (roster: EnginePlayer[]) => {
    const dist = distributionOf(roster);
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
  // Best ball auto-starts the top scorers, so start/sit advice is meaningless.
  if (currentStarters.length && !bestBall) {
    for (const s of best.starters) {
      if (!s.player) continue;
      const isStarting = currentStarters.some((c) => c.player_name === s.player!.name);
      if (isStarting) continue;
      const benched = currentStarters
        .filter((c) => slotAccepts(s.slot, c.position.toUpperCase()) && !bestNames.has(c.player_name))
        .sort((a, b) => Number(a.proj_points) - Number(b.proj_points))[0];
      if (!benched) continue;
      const benchedProj = proj.week(
        benched.player_id,
        benched.player_name,
        benched.position.toUpperCase(),
        Number(benched.proj_points),
      );
      const gain = s.player.proj - benchedProj;
      if (gain < 0.6) continue;
      const impact = whatIf(mine.roster);
      suggestions.push({
        id: `start-${s.player.name}`,
        kind: "start-sit",
        headline: `Start ${s.player.name} over ${benched.player_name}`,
        detail: `${s.slot} slot. Projection goes from ${benchedProj.toFixed(1)} to ${s.player.proj.toFixed(1)} points this week.`,
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
    .filter((p) => !rosteredNames.has(normalizeName(p.full_name)))
    .filter((p) => usablePosition(p.position.toUpperCase()))
    .map<EnginePlayer>((p) => ({
      id: p.id,
      name: p.full_name,
      position: p.position.toUpperCase(),
      nflTeam: p.nfl_team,
      proj: proj.week(p.id, p.full_name, p.position.toUpperCase(), Number(p.proj_points_week)),
      volatility: Number(p.volatility),
    }))
    .sort((a, b) => b.proj - a.proj)
    .slice(0, 14);

  // Always surface the five best waiver options, even when the maths says the
  // gain is small or slightly negative — the manager still wants to see them.
  const droppable = [...mine.roster].sort((a, b) => a.proj - b.proj);
  // Guillotine bidding: price the pickup against every rival's desperation
  // and the money they actually have left.
  const survivalBidsFor = (fa: EnginePlayer): BidLadder | null => {
    if (!survival) return null;
    const myBase = survivalById.get(mine.id);
    if (!myBase) return null;
    const nextRoster = mine.roster.map((p) => (p.name === droppable[0]?.name ? fa : p));
    const dist = teamDistribution(nextRoster, slots);
    const withMe = simInputs.map((t) =>
      t.id === mine.id
        ? { id: t.id, name: t.name, isMine: t.isMine, mean: dist.mean, sd: dist.sd }
        : { id: t.id, name: t.name, isMine: t.isMine, mean: t.mean, sd: t.sd },
    );
    const after = simulateGuillotine(withMe, weeksLeft, 1000, 7).find((r) => r.id === mine.id);
    const myGain = Math.max(0, (after?.surviveWeekOdds ?? 0) - myBase.surviveWeekOdds);

    const rivals: FaabRival[] = engineTeams
      .filter((t) => t.id !== mine.id && t.roster.length)
      .map((t) => {
        const base = survivalById.get(t.id);
        const before = optimalLineup(t.roster, slots).total;
        const worst = [...t.roster].sort((a, b) => a.proj - b.proj)[0];
        const swapped = worst ? t.roster.map((p) => (p.name === worst.name ? fa : p)) : [...t.roster, fa];
        const gainPts = Math.max(0, optimalLineup(swapped, slots).total - before);
        const risk = Math.max(0, 1 - (base?.surviveWeekOdds ?? 1));
        const row = teamById.get(t.id);
        return {
          id: t.id,
          name: t.name,
          surviveWeekOdds: base?.surviveWeekOdds ?? 1,
          survivalGain: risk * Math.min(0.9, gainPts / 15),
          faabRemaining: row?.faab_remaining ?? null,
        };
      });

    return bidLadder({
      budget: leagueFaabBudget,
      myRemaining: teamById.get(mine.id)?.faab_remaining ?? leagueFaabBudget,
      mySurviveWeekOdds: myBase.surviveWeekOdds,
      mySurvivalGain: myGain,
      rivals,
      teamCount: engineTeams.length,
      weeksLeft,
    });
  };

  const waiverIdeas: MoveSuggestion[] = [];
  for (const fa of freeAgents.slice(0, 10)) {
    const drop = droppable[0];
    if (!drop) continue;
    const nextRoster = mine.roster.map((p) => (p.name === drop.name ? fa : p));
    const before = optimalLineup(mine.roster, slots).total;
    const after = optimalLineup(nextRoster, slots).total;
    const gain = after - before;
    const impact = whatIf(nextRoster);
    waiverIdeas.push({
      id: `waiver-${fa.name}`,
      kind: "waiver",
      headline: `Add ${fa.name} (${fa.position}), drop ${drop.name}`,
      detail:
        gain >= 0.1
          ? `Your best starting lineup gains ${gain.toFixed(1)} points a week.`
          : `A depth or upside add — your starting lineup changes by ${gain.toFixed(1)} points a week right now.`,
      pointsDelta: Math.round(gain * 10) / 10,
      winDelta: Math.round(impact.winDelta * 100) / 100,
      titleDelta: impact.titleDelta,
      playoffDelta: impact.playoffDelta,
      addName: fa.name,
      dropName: drop.name,
      bids: survival ? survivalBidsFor(fa) : null,
    });
  }
  waiverIdeas.sort((a, b) => b.pointsDelta - a.pointsDelta || b.titleDelta - a.titleDelta);
  suggestions.push(...keepTopFive(waiverIdeas, (s) => s.pointsDelta >= 0.4));


  // --- trade ideas, shaped by my team's badge ------------------------------
  // A contender buys proven production with picks and youth; a rebuilding team
  // sells veterans to contenders for picks and young risers. Every offer is
  // priced on the Keep Trade Cut market and balanced until both sides are close.
  const weakest = grades.filter((g) => g.verdict === "weakness").map((g) => g.position);
  const strongest = grades.filter((g) => g.verdict === "strength").map((g) => g.position);
  const assetFor = (p: EnginePlayer): TradeAsset => ({
    kind: "player",
    id: p.id,
    name: p.name,
    position: p.position,
    value: values.player(p.id, p.name, p.position, p.proj * 17),
  });
  const valueOf = (p: EnginePlayer) => values.player(p.id, p.name, p.position, p.proj * 17);
  const myPicks = pickAssets.get(mine.id) ?? [];
  const marketLabel = values.format === "sf" ? "superflex" : "one-QB";

  const badgeById = new Map(standings.map((s) => [s.id, s.badge]));
  const myBadge = badgeById.get(mine.id) ?? standings[0]!.badge;
  const myStrategy = strategyFor(myBadge.key, isDynastyLeague);
  // Selling only means something where the future is tradeable.
  const modes: StrategyMode[] = !isDynastyLeague
    ? ["buy"]
    : myStrategy.mode === "pivot"
      ? ["buy", "sell"]
      : [myStrategy.mode];
  const allowedPartners = partnerModes(myStrategy.mode);
  const partners = engineTeams.filter((t) => {
    if (t.isMine || !t.roster.length) return false;
    const badge = badgeById.get(t.id);
    return !badge || allowedPartners.includes(strategyMode(badge.key));
  });
  const beforeLineup = optimalLineup(mine.roster, slots).total;

  // Read the deal from the other side of the table: does their lineup get
  // better, do they bank future value, and does that fit how they are built?
  const partnerRead = (
    other: (typeof engineTeams)[number],
    theySend: EnginePlayer[],
    theyGet: EnginePlayer[],
    theirSendValue: number,
    theirGetValue: number,
  ) => {
    const out = new Set(theySend.map((p) => p.name));
    const nextTheirs = [...other.roster.filter((p) => !out.has(p.name)), ...theyGet];
    const theirBefore = optimalLineup(other.roster, slots).total;
    const theirAfter = optimalLineup(nextTheirs, slots).total;
    const pointsDelta = theirAfter - theirBefore;
    const badge = badgeById.get(other.id);
    const winNow = badge ? strategyMode(badge.key) === "buy" : false;
    const clamp = (n: number) => Math.max(-0.25, Math.min(0.25, n));
    const acceptance = acceptanceScore({
      bSendValue: theirSendValue,
      bReceiveValue: theirGetValue,
      bTitleDelta: clamp(pointsDelta * 0.01),
      bPlayoffDelta: clamp(pointsDelta * 0.015),
      bDynastyDelta: isDynastyLeague ? theirGetValue - theirSendValue : null,
      bWinNow: winNow,
      isDynasty: isDynastyLeague,
    });
    const label = badge?.label ?? "their team";
    const lineupLine =
      pointsDelta >= 0.5
        ? `their lineup gains ${pointsDelta.toFixed(1)} points a week`
        : pointsDelta <= -0.5
          ? `their lineup loses ${Math.abs(pointsDelta).toFixed(1)} points a week`
          : "their lineup barely moves";
      const valueLine =
        theirGetValue - theirSendValue >= 0
          ? `they bank ${Math.round(theirGetValue - theirSendValue).toLocaleString()} of market value`
          : `they pay ${Math.round(theirSendValue - theirGetValue).toLocaleString()} of market value`;
    return {
      pointsDelta,
      acceptance,
      band: acceptanceBandOf(acceptance),
      reason: `As a ${label} ${winNow ? "chasing this season" : "playing the long game"}, ${lineupLine} and ${valueLine}.`,
    };
  };

  const tradeIdeas: MoveSuggestion[] = [];

  for (const other of partners) {

    const otherBadge = badgeById.get(other.id);
    const otherLabel = otherBadge?.label ?? "their team";
    const otherPicks = [...(pickAssets.get(other.id) ?? [])].sort((a, b) => b.value - a.value);

    // ---- buying: their best producer at my weakest spot -------------------
    if (modes.includes("buy")) {
      for (const need of weakest.slice(0, 2)) {
        const target = other.roster
          .filter((p) => p.position === need)
          .sort((a, b) => b.proj - a.proj)[0];
        if (!target) continue;
        const surplus = mine.roster
          .filter((p) => strongest.includes(p.position))
          .sort((a, b) => b.proj - a.proj);
        // Pay with youth first when the roster is built to win right now.
        const give = surplus.filter((p) => laneOf(p) === "young")[0] ?? surplus[1];
        if (!give) continue;
        const nextRoster = mine.roster.map((p) => (p.name === give.name ? target : p));
        const after = optimalLineup(nextRoster, slots).total;
        const impact = whatIf(nextRoster);

        const myPool: TradeAsset[] = [
          ...mine.roster
            .filter((p) => p.name !== give.name && laneOf(p) !== "veteran")
            .map(assetFor),
          ...myPicks,
        ].sort((a, b) => a.value - b.value);
        const theirPool: TradeAsset[] = other.roster
          .filter((p) => p.name !== target.name && laneOf(p) !== "young")
          .map(assetFor)
          .sort((a, b) => a.value - b.value);

        const balanced = balanceTrade([assetFor(give)], [assetFor(target)], myPool, theirPool);
        const giveText = balanced.give.map(assetLabel).join(" + ");
        const getText = balanced.get.map(assetLabel).join(" + ");
        const read = partnerRead(other, [target], [give], balanced.getValue, balanced.giveValue);
        const gain = after - beforeLineup;

        tradeIdeas.push({
          id: `trade-${other.id}-${target.name}`,
          kind: "trade",
          headline: `Send ${giveText} to ${other.name} for ${getText}`,
          detail: `Fills your ${need} hole from a position of surplus. Lineup ${gain >= 0 ? "gains" : "loses"} ${Math.abs(gain).toFixed(1)} points a week. ${fairnessLabel(balanced.giveValue, balanced.getValue)} on the ${marketLabel} dynasty market. ${read.band} they accept — ${read.reason}`,
          pointsDelta: Math.round(gain * 10) / 10,
          winDelta: Math.round(impact.winDelta * 100) / 100,
          titleDelta: impact.titleDelta,
          playoffDelta: impact.playoffDelta,
          addName: target.name,
          dropName: give.name,
          giveValue: balanced.giveValue,
          getValue: balanced.getValue,
          fairness: balanced.fairness,
          giveAssets: balanced.give.map(assetLabel),
          getAssets: balanced.get.map(assetLabel),
          valueFormat: values.format,
          strategy: "buy",
          strategyLabel: "Buying",
          rationale: `You're a ${myBadge.label}: ${myStrategy.rationale} ${other.name} (${otherLabel}) should take the youth back.`,
          dynastyDelta: balanced.getValue - balanced.giveValue,
          partnerPointsDelta: Math.round(read.pointsDelta * 10) / 10,
          acceptance: read.acceptance,
          acceptanceBand: read.band,
          acceptanceReason: read.reason,
        });
        break;
      }
    }


    // ---- selling: my veterans to a contender for picks and youth ----------
    if (modes.includes("sell") && (otherPicks.length || other.roster.length)) {
      // A selling team (especially a Donator) should be shopping every veteran
      // it has, so offer up its two most valuable non-young pieces.
      const sellables = mine.roster
        .filter((p) => laneOf(p) !== "young")
        .sort((a, b) => valueOf(b) - valueOf(a))
        .slice(0, 2);
      // Ask for their youth first. Some platforms give us no ages at all, so
      // when nobody reads as "young" we fall back to their most valuable
      // pieces rather than showing no ideas.
      const young = other.roster
        .filter((p) => laneOf(p) === "young")
        .sort((a, b) => valueOf(b) - valueOf(a));
      const theirYoungPool = young.length
        ? young
        : [...other.roster].sort((a, b) => valueOf(b) - valueOf(a)).slice(0, 3);


      const taken = new Set<string>();
      for (const [i, send] of sellables.entries()) {
        // Ask for a piece priced near what we send, not simply their best
        // player — a wildly lopsided ask is one no manager ever accepts.
        const wanted = valueOf(send) * 1.05;
        const theirYoung = theirYoungPool
          .filter((p) => !taken.has(p.name))
          .sort((a, b) => Math.abs(valueOf(a) - wanted) - Math.abs(valueOf(b) - wanted))[0];
        if (theirYoung) taken.add(theirYoung.name);
        const back: TradeAsset[] = [];
        if (otherPicks[i] ?? otherPicks[0]) back.push((otherPicks[i] ?? otherPicks[0])!);
        if (theirYoung) back.push(assetFor(theirYoung));
        if (!back.length) continue;

        const nextRoster = theirYoung
          ? mine.roster.map((p) => (p.name === send.name ? theirYoung : p))
          : mine.roster.filter((p) => p.name !== send.name);
        const after = optimalLineup(nextRoster, slots).total;
        const impact = whatIf(nextRoster);

        const myRest = mine.roster.filter((p) => p.name !== send.name);
        const myVets = myRest.filter((p) => laneOf(p) === "veteran");
        const myPool: TradeAsset[] = (myVets.length ? myVets : myRest)
          .map(assetFor)
          .sort((a, b) => a.value - b.value);
        const theirRest = other.roster.filter((p) => p.name !== theirYoung?.name);
        const theirYouth = theirRest.filter((p) => laneOf(p) === "young");
        const theirPool: TradeAsset[] = [
          ...otherPicks.filter((pk) => !back.includes(pk)),
          ...(theirYouth.length ? theirYouth : theirRest).map(assetFor),
        ].sort((a, b) => a.value - b.value);


        const balanced = balanceTrade([assetFor(send)], back, myPool, theirPool);
        const gained = balanced.getValue - balanced.giveValue;
        const cost = Math.max(0, beforeLineup - after);
        const giveText = balanced.give.map(assetLabel).join(" + ");
        const getText = balanced.get.map(assetLabel).join(" + ");
        const read = partnerRead(
          other,
          theirYoung ? [theirYoung] : [],
          [send],
          balanced.getValue,
          balanced.giveValue,
        );

        tradeIdeas.push({
          id: `sell-${other.id}-${send.name}`,
          kind: "trade",
          headline: `Sell ${giveText} to ${other.name} for ${getText}`,
          detail: `${other.name} are a ${otherLabel} and should pay for win-now help. You bank ${Math.abs(gained).toLocaleString()} ${gained >= 0 ? "of extra" : "less"} future value on the ${marketLabel} market and give up ${cost.toFixed(1)} points a week you don't need. ${read.band} they accept — ${read.reason}`,
          pointsDelta: Math.round((after - beforeLineup) * 10) / 10,
          winDelta: Math.round(impact.winDelta * 100) / 100,
          titleDelta: impact.titleDelta,
          playoffDelta: impact.playoffDelta,
          ...(theirYoung ? { addName: theirYoung.name } : {}),
          dropName: send.name,
          giveValue: balanced.giveValue,
          getValue: balanced.getValue,
          fairness: balanced.fairness,
          giveAssets: balanced.give.map(assetLabel),
          getAssets: balanced.get.map(assetLabel),
          valueFormat: values.format,
          strategy: "sell",
          strategyLabel: "Selling",
          rationale: `You're a ${myBadge.label}: ${myStrategy.rationale}`,
          dynastyDelta: gained,
          partnerPointsDelta: Math.round(read.pointsDelta * 10) / 10,
          acceptance: read.acceptance,
          acceptanceBand: read.band,
          acceptanceReason: read.reason,
        });
      }
    }

  }

  // Sell ideas are supposed to cost title odds, so they are ranked by the
  // future value they bring back instead (5,000 market points ~ one title point).
  // Deals the other manager would actually take are worth more than perfect
  // ones they would laugh at, so acceptance is part of the ranking.
  const rankScore = (s: MoveSuggestion) => {
    const core = s.strategy === "sell" ? (s.dynastyDelta ?? 0) / 5000 : s.titleDelta;
    return core * (0.4 + 1.2 * (s.acceptance ?? 0.5));
  };
  tradeIdeas.sort((a, b) => rankScore(b) - rankScore(a) || b.pointsDelta - a.pointsDelta);
  // Always show five trade ideas, even when the best of them still costs points.
  suggestions.push(...keepTopFive(tradeIdeas, (s) => rankScore(s) > 0));
  suggestions.sort((a, b) => rankScore(b) - rankScore(a) || b.pointsDelta - a.pointsDelta);


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
  why.push(`${FORMAT_LABELS[format]} league scored as ${scoring.label}.`);

  const mySurvival = survival?.find((s) => s.isMine) ?? null;
  if (mySurvival) {
    why.push(
      `${(mySurvival.surviveWeekOdds * 100).toFixed(0)}% chance of surviving this week; projected to last about ${mySurvival.expectedWeeksLeft} more weeks.`,
    );
  }

  // --- dynasty / keeper long-term value ------------------------------------
  let dynasty: DynastyRow[] | null = null;
  if (isMultiYear(format)) {
    const ageByName = new Map(
      players.map((p) => [
        normalizeName(p.full_name),
        {
          age: (p as { age?: number | null }).age ?? null,
          yearsExp: (p as { years_exp?: number | null }).years_exp ?? null,
          season: proj.season(p.id, p.full_name, p.position.toUpperCase(), Number(p.proj_points_season), (p as { stat_projections?: unknown }).stat_projections),
        },
      ]),
    );
    const bestSeason = Math.max(1, ...[...ageByName.values()].map((v) => v.season));
    dynasty = mine.roster
      .map<DynastyRow>((p) => {
        const meta = ageByName.get(normalizeName(p.name));
        const season = meta?.season ?? p.proj * 17;
        // The market's age wins; our own record only fills a gap.
        const age = values.age(p.id, p.name, p.position) ?? meta?.age ?? null;
        const longTerm = dynastyValueDetail(
          p.position,
          season,
          bestSeason,
          age,
          meta?.yearsExp ?? null,
          values.medianAge(p.position),
        );
        return {
          name: p.name,
          position: p.position,
          age,
          trajectory: trajectoryOf(p.name, p.position, p.id, season),
          ageSource: longTerm.ageSource,
          longTermValue: longTerm.value,
          blendedValue: blendedValue(format, season, bestSeason, longTerm.value),
        };
      })
      .sort((a, b) => b.blendedValue - a.blendedValue);
  }

  // How much of my roster's value sits at or past its position peak, and who
  // to move before the market notices.
  let dynastyOutlook: DynastyOutlook | null = null;
  if (showTrajectories && dynasty?.length) {
    const withTrajectory = dynasty.filter((row) => row.trajectory);
    const totalValue = withTrajectory.reduce((sum, row) => sum + (row.trajectory?.now ?? 0), 0);
    const pastPeakValue = withTrajectory
      .filter((row) => (row.trajectory?.age ?? 0) >= (row.trajectory?.peakAge ?? 99))
      .reduce((sum, row) => sum + (row.trajectory?.now ?? 0), 0);
    const pastPeakShare = totalValue > 0 ? pastPeakValue / totalValue : 0;
    const contentionWindow =
      pastPeakShare > 0.55
        ? "Win now — this roster is built for the next season or two."
        : pastPeakShare > 0.35
          ? "Two to three seasons before this core needs replacing."
          : "Young core — the window is three or more seasons out.";
    const sellSoon = withTrajectory
      .filter((row) => ["cliff", "declining"].includes(row.trajectory!.classification))
      .filter((row) => row.trajectory!.now >= 1000)
      .sort((a, b) => a.trajectory!.change1 - b.trajectory!.change1)
      .slice(0, 3)
      .map((row) => ({
        name: row.name,
        position: row.position,
        value: row.trajectory!.now,
        classification: row.trajectory!.classification,
        change1: row.trajectory!.change1,
      }));
    dynastyOutlook = { pastPeakShare, contentionWindow, sellSoon };
  }

  const myTeamRow = teams.find((t) => t.id === mine.id)!;

  // Player metadata for status badges and alerts.
  const playerMeta = new Map(
    players.map((p) => [
      normalizeName(p.full_name),
      { status: p.status ?? "Active", nflTeam: p.nfl_team ?? null, byeWeek: p.bye_week ?? null },
    ]),
  );
  const metaFor = (name: string) => playerMeta.get(normalizeName(name)) ?? { status: "Active", nflTeam: null, byeWeek: null };

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
    lineup: best.starters
      .filter((s) => s.slot.toUpperCase() !== "BN")
      .map((s) => ({
        slot: s.slot,
        name: s.player?.name ?? "Empty",
        position: s.player?.position ?? "-",
        proj: s.player?.proj ?? 0,
        ...metaFor(s.player?.name ?? ""),
        trajectory: s.player
          ? trajectoryOf(s.player.name, s.player.position, s.player.id, s.player.proj * 17)
          : null,
      })),
    bench: best.bench.map((p) => ({
      name: p.name,
      position: p.position,
      proj: p.proj,
      ...metaFor(p.name),
      trajectory: trajectoryOf(p.name, p.position, p.id, p.proj * 17),
    })),
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
    ...formatMeta,
    mySurvival,
    dynasty,
    dynastyOutlook,
    showTrajectories,
    myBadge,
    myStrategy,
  };
}

async function saveWeeklySnapshot(
  supabase: DB,
  leagueId: string,
  week: number,
  baseline: SimTeamResult[],
  standings: (SimTeamResult & { record: string; pointsFor: number; badge?: TeamBadge })[],
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

  const tradeScoring = leagueScoring(
    analysis.league.scoring_type,
    (analysis.league.scoring_rules ?? {}) as Record<string, number>,
  );
  const tradeProj = await loadProjections(supabase, {
    scoring: tradeScoring,
    week: analysis.league.current_week ?? 1,
    source: resolveProjectionSource(analysis.league as never),
  });

  const roster: EnginePlayer[] = (spots ?? []).map((s) => ({
    id: s.player_id,
    name: s.player_name,
    position: s.position.toUpperCase(),
    nflTeam: s.nfl_team,
    proj: tradeProj.week(s.player_id, s.player_name, s.position.toUpperCase(), Number(s.proj_points)),
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
        proj: tradeProj.week(s.player_id, s.player_name, s.position.toUpperCase(), Number(s.proj_points)),
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
