/**
 * Waiver wire board: every unowned player in a league with projected points,
 * points above replacement ("trade value"), a suggested FAAB bid, and the
 * championship-odds impact of adding the best candidates. Server-only.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

import {
  optimalLineup,
  simulateSeason,
  slotAccepts,
  teamDistribution,
  type EnginePlayer,
  type ScheduleGame,
} from "./engine";
import { normalizeName } from "./names";
import { fetchAllRows } from "./paginate";
import { loadProjections } from "./projections.server";
import { leagueScoring } from "./scoring";
import { fallbackValue, leagueValueFormat, loadTradeValues, type ValueFormat } from "./trade-value";
import {
  FORMAT_LABELS,
  asFormat,
  bestBallDistribution,
  blendedValue,
  dynastyValue,
  hasLineupDecisions,
  isMultiYear,
} from "./format";

type DB = SupabaseClient<Database>;

const DEFAULT_SLOTS = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF"];
const BENCH_POSITIONS = ["QB", "RB", "WR", "TE"];
/** How many candidates get a full season re-simulation. */
const SCORED_CANDIDATES = 12;

function asSlots(value: unknown): string[] {
  if (Array.isArray(value) && value.length) return value.map(String).filter((s) => s.toUpperCase() !== "BN");
  return DEFAULT_SLOTS;
}

const key = (name: string) => normalizeName(name);

export interface WaiverBoardRow {
  id: string;
  name: string;
  position: string;
  nflTeam: string | null;
  byeWeek: number | null;
  status: string;
  projWeek: number;
  projSeason: number;
  /** Season points above the replacement-level starter at this position. */
  tradeValue: number;
  /** Keep Trade Cut dynasty market price; null when the market has not loaded. */
  ktcValue: number | null;
  /** What our projections imply this player should be worth on the market. */
  projValue: number;
  /** True when our projections price this player well above the market. */
  undervalued: boolean;
  /** Suggested bid as a percentage of a $100 FAAB budget. */
  bid: number;
  /** Points your best starting lineup gains this week, if scored. */
  lineupGain: number | null;
  titleDelta: number | null;
  playoffDelta: number | null;
  winDelta: number | null;
  suggestedDrop: string | null;
  scored: boolean;
  /** 0-100 keep-forever value; only set in dynasty and keeper leagues. */
  longTermValue: number | null;
}

export interface WaiverBoard {
  rows: WaiverBoardRow[];
  estimatedRosterSpots: number;
  rosterSize: number;
  rosterLimit: number;
  hasMyTeam: boolean;
  format: string;
  formatLabel: string;
  scoringLabel: string;
  showLongTerm: boolean;
  valueFormat: ValueFormat;
  valuesCovered: boolean;
}

export async function buildWaiverBoard(
  supabase: DB,
  leagueId: string,
  opts: { search?: string; position?: string; limit?: number } = {},
): Promise<WaiverBoard> {
  const { data: league, error } = await supabase
    .from("leagues")
    .select("*")
    .eq("id", leagueId)
    .maybeSingle();
  if (error) throw new Error(error.message);
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
  const players = playerRows;

  const rostered = new Set(spots.map((s) => key(s.player_name)));
  const usablePosition = (position: string) =>
    slots.some((slot) => slotAccepts(slot, position)) || BENCH_POSITIONS.includes(position);

  const scoring = leagueScoring(league.scoring_type, (league.scoring_rules ?? {}) as Record<string, number>);
  const format = asFormat((league as { format?: string }).format);
  const showLongTerm = isMultiYear(format);
  const bestBall = !hasLineupDecisions(format);
  const distributionOf = (roster: EnginePlayer[]) =>
    bestBall ? bestBallDistribution(roster, slots) : teamDistribution(roster, slots);
  // The member's own projection adjustments replace the shared baseline.
  const proj = await loadProjections(supabase, { scoring, week: league.current_week ?? 1 });
  // Dynasty market prices, matched by the same normalized names as everywhere else.
  const values = await loadTradeValues(supabase, leagueValueFormat(slots));
  const seasonOf = (p: {
    id?: string;
    full_name?: string;
    position: string;
    proj_points_season: number | string;
    stat_projections?: unknown;
  }) =>
    proj.season(
      p.id ?? null,
      p.full_name ?? null,
      p.position.toUpperCase(),
      Number(p.proj_points_season),
      p.stat_projections,
    );


  // --- replacement level: the Nth best season projection at each position ---
  const startersNeeded = (pos: string) => {
    const direct = slots.filter((s) => slotAccepts(s, pos) && s.toUpperCase() !== "FLEX").length;
    const flex = slots.filter((s) => s.toUpperCase() === "FLEX" && slotAccepts(s, pos)).length;
    return Math.max(1, direct + Math.ceil(flex / 3));
  };
  const replacement = new Map<string, number>();
  for (const pos of ["QB", "RB", "WR", "TE", "K", "DEF", "DL", "LB", "DB"]) {
    const pool = players
      .filter((p) => p.position.toUpperCase() === pos)
      .map((p) => seasonOf(p))
      .sort((a, b) => b - a);
    const idx = Math.min(pool.length - 1, Math.max(0, teams.length * startersNeeded(pos) - 1));
    replacement.set(pos, pool.length ? (pool[idx] ?? 0) : 0);
  }

  const bestSeason = Math.max(1, ...players.map((p) => seasonOf(p)));

  const search = opts.search?.trim().toLowerCase();
  const wanted = opts.position?.toUpperCase();

  const freeAgents = players
    .filter((p) => !rostered.has(key(p.full_name)))
    .filter((p) => usablePosition(p.position.toUpperCase()))
    .map((p) => {
      const pos = p.position.toUpperCase();
      const projSeason = seasonOf(p);
      const longTerm = showLongTerm
        ? dynastyValue(
            pos,
            projSeason,
            bestSeason,
            (p as { age?: number | null }).age ?? null,
            (p as { years_exp?: number | null }).years_exp ?? null,
          )
        : null;
      const projValue = fallbackValue(pos, projSeason);
      // Market price comes back only when KTC covers the player; the
      // projection-based fallback doubles as the "what they should cost" line.
      const marketValue = values.covered ? values.player(p.id, p.full_name, pos, projSeason) : null;
      return {
        id: p.id,
        name: p.full_name,
        position: pos,
        nflTeam: p.nfl_team,
        byeWeek: p.bye_week,
        status: p.status,
        projWeek: proj.week(p.id, p.full_name, pos, Number(p.proj_points_week)),
        projSeason,
        volatility: Number(p.volatility),
        tradeValue: Math.round((projSeason - (replacement.get(pos) ?? 0)) * 10) / 10,
        ktcValue: marketValue,
        projValue,
        undervalued: marketValue !== null && projValue >= marketValue * 1.25 && projValue - marketValue >= 400,
        longTermValue: longTerm,
        rank: showLongTerm
          ? blendedValue(format, projSeason, bestSeason, longTerm ?? 0)
          : projSeason - (replacement.get(pos) ?? 0),
      };
    })
    .sort((a, b) => b.rank - a.rank);

  const mine = teams.find((t) => t.is_mine) ?? null;
  const myRoster: EnginePlayer[] = mine
    ? spots
        .filter((s) => s.team_id === mine.id)
        .map((s) => ({
          id: s.player_id,
          name: s.player_name,
          position: s.position.toUpperCase(),
          nflTeam: s.nfl_team,
          proj: proj.week(s.player_id, s.player_name, s.position.toUpperCase(), Number(s.proj_points)),
          volatility: 0.35,
        }))
    : [];

  // --- championship impact for the strongest candidates --------------------
  const impacts = new Map<
    string,
    { titleDelta: number; playoffDelta: number; winDelta: number; lineupGain: number; drop: string | null }
  >();

  if (mine && myRoster.length) {
    const engineTeams = teams.map((t) => ({
      id: t.id,
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
      wins: t.wins,
      losses: t.losses,
      ties: t.ties,
      pointsFor: Number(t.points_for),
      name: t.name,
      isMine: t.is_mine,
    }));

    const simInputs = engineTeams.map((t) => {
      const dist = t.roster.length
        ? distributionOf(t.roster)
        : {
            mean: t.wins + t.losses + t.ties > 0 ? t.pointsFor / (t.wins + t.losses + t.ties) : 100,
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

    const schedule: ScheduleGame[] = (matchupRows ?? [])
      .filter((m) => m.home_team_id && m.away_team_id)
      .map((m) => ({ week: m.week, homeTeamId: m.home_team_id!, awayTeamId: m.away_team_id! }));

    const simConfig = {
      playoffTeams: league.playoff_teams,
      regularSeasonWeeks: league.regular_season_weeks,
      currentWeek: league.current_week,
    };

    const baseline = simulateSeason(simInputs, simConfig, schedule, 1500, 7);
    const baseMine = baseline.find((r) => r.id === mine.id)!;
    const beforeLineup = optimalLineup(myRoster, slots).total;
    const droppable = [...myRoster].sort((a, b) => a.proj - b.proj);
    const rosterCap = slots.length + 6;

    for (const fa of freeAgents.slice(0, SCORED_CANDIDATES)) {
      const candidate: EnginePlayer = {
        id: fa.id,
        name: fa.name,
        position: fa.position,
        nflTeam: fa.nflTeam,
        proj: fa.projWeek,
        volatility: fa.volatility,
      };

      // Try every plausible drop (plus keeping everyone when there is room)
      // and keep whichever leaves the strongest starting lineup.
      const options: { roster: EnginePlayer[]; drop: EnginePlayer | null }[] = [];
      if (myRoster.length < rosterCap) options.push({ roster: [...myRoster, candidate], drop: null });
      for (const d of droppable.slice(0, 8)) {
        options.push({ roster: myRoster.map((p) => (p.name === d.name ? candidate : p)), drop: d });
      }

      let best = options[0]!;
      let bestTotal = -Infinity;
      for (const opt of options) {
        const total = optimalLineup(opt.roster, slots).total;
        if (total > bestTotal) {
          bestTotal = total;
          best = opt;
        }
      }
      const nextRoster = best.roster;
      const drop = best.drop;
      const lineupGain = bestTotal - beforeLineup;

      const dist = distributionOf(nextRoster);
      const inputs = simInputs.map((t) => (t.id === mine.id ? { ...t, mean: dist.mean, sd: dist.sd } : t));
      const res = simulateSeason(inputs, simConfig, schedule, 1500, 7);
      const m = res.find((r) => r.id === mine.id)!;

      // A pickup that does not improve the optimal lineup cannot move the
      // season odds; anything the simulation reports there is noise.
      const meaningful = lineupGain > 0.05;
      impacts.set(fa.id, {
        titleDelta: meaningful ? m.titleOdds - baseMine.titleOdds : 0,
        playoffDelta: meaningful ? m.playoffOdds - baseMine.playoffOdds : 0,
        winDelta: meaningful ? Math.round((m.projWins - baseMine.projWins) * 100) / 100 : 0,
        lineupGain: Math.round(lineupGain * 10) / 10,
        drop: lineupGain > 0 && drop ? drop.name : null,
      });
    }
  }

  const bestTradeValue = Math.max(1, freeAgents[0]?.tradeValue ?? 1);

  const rows: WaiverBoardRow[] = freeAgents
    .filter((p) => (wanted && wanted !== "ALL" ? p.position === wanted : true))
    .filter((p) => (search ? p.name.toLowerCase().includes(search) : true))
    .slice(0, opts.limit ?? 60)
    .map((p) => {
      const impact = impacts.get(p.id) ?? null;
      let bid = 0;
      if (impact && impact.lineupGain > 0.1) {
        bid = Math.round(
          Math.min(60, impact.lineupGain * 4 + Math.max(0, impact.titleDelta) * 100 * 2.5 + 1),
        );
      } else if (!impact && p.tradeValue > 0) {
        // Stash value only: a small speculative bid scaled to season upside.
        bid = Math.round(Math.min(8, (p.tradeValue / bestTradeValue) * 8));
      }
      return {
        id: p.id,
        name: p.name,
        position: p.position,
        nflTeam: p.nflTeam,
        byeWeek: p.byeWeek,
        status: p.status,
        projWeek: p.projWeek,
        projSeason: Math.round(p.projSeason * 10) / 10,
        tradeValue: p.tradeValue,
        bid,
        lineupGain: impact ? impact.lineupGain : null,
        titleDelta: impact ? impact.titleDelta : null,
        playoffDelta: impact ? impact.playoffDelta : null,
        winDelta: impact ? impact.winDelta : null,
        suggestedDrop: impact ? impact.drop : null,
        scored: !!impact,
        longTermValue: p.longTermValue,
      };
    });

  const estimated = spots.filter((s) => s.is_auto).length;
  const rosterSize = mine ? spots.filter((s) => s.team_id === mine.id).length : 0;

  return {
    rows,
    estimatedRosterSpots: estimated,
    rosterSize,
    rosterLimit: slots.length + 6,
    hasMyTeam: !!mine,
    format,
    formatLabel: FORMAT_LABELS[format],
    scoringLabel: scoring.label,
    showLongTerm,
  };
}
