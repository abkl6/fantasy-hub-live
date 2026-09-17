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
import { resolveProjectionSource } from "./projection-source";
import { leagueScoring } from "./scoring";
import {
  calibratedScale,
  fallbackValue,
  leagueValueFormat,
  loadTradeValues,
  type ValueFormat,
} from "./trade-value";
import {
  FORMAT_LABELS,
  asFormat,
  bestBallDistribution,
  blendedValue,
  dynastyValue,
  hasLineupDecisions,
  isMultiYear,
  isSurvival,
  simulateGuillotine,
} from "./format";
import { classifyTeam } from "./team-class";
import { strategyFor, type StrategyMode } from "./strategy";
import {
  applyBidRules,
  dropAllowed,
  duplicateStreamer,
  isHandcuff,
  isStreamPosition,
  playoffScheduleWeight,
  replacementLevels,
  ruleNote,
  valueOverReplacement,
} from "./rules";
import { loadStrategyRules } from "./rules.server";
import {
  bidRecommendation,
  enforceBidOrder,
  isInjuredStatus,
  rankWaivers,
  type BidRecommendation,
  type RankableRow,
  type WaiverSort,
} from "./waiver-rank";
import { willingToPay } from "./faab";
import { buildFaabPlan, paceBid, type FaabPlan } from "./faab-plan";
import {
  buildFills,
  buildStream,
  emptySlots,
  isStreamedPosition,
  type FillCandidate,
  type SlotFill,
  type StreamSuggestion,
} from "./slot-fill";

import { loadSlotPlan } from "./slots.server";
import { slotBreadth } from "./slots";
import { asEligiblePositions, isEligiblePosition } from "./eligibility";
type DB = SupabaseClient<Database>;


/** How many candidates get a full season re-simulation. */
const SCORED_CANDIDATES = 12;
/** The background worker scores a deeper list so the page is a plain read. */
const DEEP_CANDIDATES = 30;
/** Cheap pass to order candidates, full pass only for the ones displayed. */
const COARSE_ITERATIONS = 300;
const FULL_ITERATIONS = 1500;
const DISPLAYED_CANDIDATES = 5;




const key = (name: string) => normalizeName(name);

export interface WaiverBoardRow extends RankableRow {
  name: string;
  nflTeam: string | null;
  byeWeek: number | null;
  /** One recommended dollar bid, with the passive and aggressive brackets. */
  bidRec: BidRecommendation;
  /** Points your best starting lineup gains this week, if scored. */
  lineupGain: number | null;
  playoffDelta: number | null;
  winDelta: number | null;
  suggestedDrop: string | null;
  scored: boolean;
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
  /** My team's posture: rebuilding boards lead with keepers, not weekly bumps. */
  strategy: StrategyMode | null;
  strategyNote: string | null;
  /** True in guillotine leagues, where survival drives the board. */
  isSurvivalLeague: boolean;
  faabBudget: number;
  myFaabRemaining: number | null;
  myTeamId: string | null;
  /** Where the numbers came from, e.g. "App projections (fallback)". */
  projectionLabel: string;
  /** True when the league's own source had nothing and we used the app's. */
  projectionFallback: boolean;
  /** My roster has an unfilled kicker / defense slot. */
  needsKicker: boolean;
  needsDefense: boolean;
  /** One recommendation per empty starting slot, shown above the list. */
  fills: SlotFill[];
  /** A minimum-bid kicker / defense swap when the matchups are lopsided. */
  stream: StreamSuggestion | null;
  /** The strategy rules that shaped this board, for the explainer link. */
  ruleNotes: string[];
  /** How the remaining budget is spread over the weeks still to come. */
  faabPlan: FaabPlan | null;
}

export async function buildWaiverBoard(
  supabase: DB,
  leagueId: string,
  opts: {
    search?: string;
    position?: string;
    limit?: number;
    sort?: WaiverSort;
    showInjured?: boolean;
    /** Skip the per-candidate season simulations; only the fill strip is wanted. */
    fillsOnly?: boolean;
    /** Background pass: score a deeper candidate list at full accuracy. */
    deep?: boolean;
  } = {},

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

  const book = await loadStrategyRules(supabase);
  const slotPlan = await loadSlotPlan(supabase, leagueId);
  const slots = slotPlan.keys;
  const teams = teamRows ?? [];
  const spots = spotRows ?? [];
  const players = playerRows;

  // A cut roster in a guillotine league is back on the wire, tagged as such.
  const cutTeamIds = new Set(
    teams.filter((t) => (t as { eliminated_week?: number | null }).eliminated_week != null).map((t) => t.id),
  );
  const rostered = new Set(
    spots.filter((s) => !cutTeamIds.has(s.team_id)).map((s) => key(s.player_name)),
  );
  const cutNames = new Set(
    spots.filter((s) => cutTeamIds.has(s.team_id)).map((s) => key(s.player_name)),
  );
  const eligiblePos = asEligiblePositions(
    (league as { eligible_positions?: unknown }).eligible_positions,
    slots,
  );
  const usablePosition = (position: string) => isEligiblePosition(position, eligiblePos);

  const scoring = leagueScoring(league.scoring_type, (league.scoring_rules ?? {}) as Record<string, number>);
  const format = asFormat((league as { format?: string }).format);
  const showLongTerm = isMultiYear(format);
  const bestBall = !hasLineupDecisions(format);
  const distributionOf = (roster: EnginePlayer[]) =>
    bestBall ? bestBallDistribution(roster, slots) : teamDistribution(roster, slots);
  // The member's own projection adjustments replace the shared baseline.
  const projOpts = {
    scoring,
    week: league.current_week ?? 1,
    sos: (league as { sos_adjust?: boolean }).sos_adjust,
  };
  let proj = await loadProjections(supabase, {
    ...projOpts,
    source: resolveProjectionSource(league),
  });

  const weeksRemaining = Math.max(
    1,
    (league.regular_season_weeks ?? 17) - (league.current_week ?? 1) + 1,
  );
  const seasonWith = (
    set: typeof proj,
    p: {
      id?: string;
      full_name?: string;
      position: string;
      proj_points_season: number | string;
      proj_points_week?: number | string;
      stat_projections?: unknown;
    },
  ) => {
    const pos = p.position.toUpperCase();
    const total = set.season(
      p.id ?? null,
      p.full_name ?? null,
      pos,
      Number(p.proj_points_season),
      p.stat_projections,
    );
    if (total > 0) return total;
    // Weekly-only sources carry no season total: build one from what is left.
    const week = set.week(p.id ?? null, p.full_name ?? null, pos, Number(p.proj_points_week ?? 0));
    return week > 0 ? week * weeksRemaining : 0;
  };

  // A board full of zeros is useless: if the league's own source has no season
  // numbers, quietly read the app's instead and say so.
  const covered = (set: typeof proj) => players.filter((p) => seasonWith(set, p) > 0).length;
  let projectionFallback = false;
  if (covered(proj) < 20) {
    const appSet = await loadProjections(supabase, {
      ...projOpts,
      source: { setting: "app", sources: ["app"], label: "App projections" },
    });
    if (covered(appSet) > covered(proj)) {
      proj = appSet;
      projectionFallback = true;
    }
  }

  // Dynasty market prices, matched by the same normalized names as everywhere else.
  const values = await loadTradeValues(supabase, leagueValueFormat(slots));
  // Put projection-implied worth on the market's scale before comparing.
  const valueScale = calibratedScale(
    players.map((p) => ({
      market: values.market(p.id, p.full_name, p.position.toUpperCase()) ?? 0,
      proj: fallbackValue(p.position.toUpperCase(), Number(p.proj_points_season)),
    })),
  );
  const seasonOf = (p: {
    id?: string;
    full_name?: string;
    position: string;
    proj_points_season: number | string;
    stat_projections?: unknown;
  }) => seasonWith(proj, p);


  // --- replacement level: the Nth best season projection at each position ---
  const startersNeeded = (pos: string) => {
    // A slot that takes several positions is shared, so it only counts for a
    // fraction of a starter at any one of them — breadth decides, not a name.
    const accepting = slots.filter((s) => slotAccepts(s, pos));
    const direct = accepting.filter((s) => slotBreadth(s) <= 1).length;
    const shared = accepting
      .filter((s) => slotBreadth(s) > 1)
      .reduce((sum, s) => sum + 1 / slotBreadth(s), 0);
    return Math.max(1, direct + Math.ceil(shared));
  };
  const replacement = new Map<string, number>();
  for (const pos of ["QB", "RB", "WR", "TE", "K", "DEF", "DL", "LB", "DB"].filter(usablePosition)) {
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
      // "Worth" is our projection-priced value on the market's scale; the
      // market price shows only when KTC actually covers the player.
      const projValue = Math.round(fallbackValue(pos, projSeason) * valueScale);
      const marketValue = values.covered ? values.market(p.id, p.full_name, pos) : null;
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
        fromCutTeam: cutNames.has(key(p.full_name)),
        rank: showLongTerm
          ? blendedValue(format, projSeason, bestSeason, longTerm ?? 0)
          : projSeason - (replacement.get(pos) ?? 0),
      };
    })
    // A row with no season projection tells nobody anything.
    .filter((p) => p.projSeason > 0)
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

  // Empty starting spots come from the league's slot definition, never from
  // who happens to be on the roster.
  const holes = emptySlots(
    slots,
    myRoster.map((p) => p.position),
  );
  const needsKicker = holes.some((h) => h.position === "K");
  const needsDefense = holes.some((h) => h.position === "DEF");

  // Hurt, out and suspended players are hidden unless they are asked for.
  // Kickers and defences never enter the main list: they are handled by the
  // fill strip and the streaming row instead.
  const healthy = freeAgents.filter((p) => opts.showInjured || !isInjuredStatus(p.status));
  const eligible = healthy.filter((p) => !isStreamedPosition(p.position));
  const stripPool = freeAgents.filter((p) => !isInjuredStatus(p.status));

  // --- strategy layer ------------------------------------------------------
  // Value over replacement is measured against the wire itself: the best free
  // agent at the same position you could add instead of this one.
  const wireLevels = replacementLevels(
    eligible.map((p) => ({ id: p.id, position: p.position, proj: p.projSeason })),
  );
  // The five best names on the wire set the bar a drop has to clear.
  const topWireWeek = [...eligible]
    .sort((a, b) => b.projWeek - a.projWeek)
    .slice(0, 12)
    .map((p) => p.projWeek);

  // --- championship impact for the strongest candidates --------------------
  const impacts = new Map<
    string,
    {
      titleDelta: number;
      playoffDelta: number;
      winDelta: number;
      survivalDelta: number | null;
      lineupGain: number;
      drop: string | null;
    }
  >();
  const survivalLeague = isSurvival(format);
  const faabBudget = Number((league as { faab_budget?: number }).faab_budget ?? 100) || 100;
  const myFaabRemaining =
    mine && (mine as { faab_remaining?: number | null }).faab_remaining != null
      ? Number((mine as { faab_remaining?: number | null }).faab_remaining)
      : null;
  let strategy: StrategyMode | null = null;
  let strategyNote: string | null = null;
  /** Chop leagues: how likely each rival is to survive the coming week. */
  const rivalSurvival = new Map<string, number>();
  /** What adding one player does to this week's lineup and survival odds. */
  let scoreAdd:
    | ((p: EnginePlayer) => { pointsGain: number; survivalDelta: number | null })
    | null = null;

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
      byes: Number((league as { playoff_byes?: number | null }).playoff_byes ?? 0),
      regularSeasonWeeks: league.regular_season_weeks,
      currentWeek: league.current_week,
    };

    const survivalInputs = simInputs.map((t) => ({
      id: t.id,
      name: t.name,
      isMine: t.isMine,
      mean: t.mean,
      sd: t.sd,
    }));
    const weeksLeft = Math.max(1, league.regular_season_weeks - league.current_week + 1);
    const survivalBase = survivalLeague ? simulateGuillotine(survivalInputs, weeksLeft, 1200, 7) : null;
    for (const r of survivalBase ?? []) rivalSurvival.set(r.id, r.surviveWeekOdds);
    const baseline = simulateSeason(simInputs, simConfig, schedule, 1500, 7);
    const baseMine = baseline.find((r) => r.id === mine.id)!;

    // The badge decides what a good pickup even looks like: a contender wants
    // points this week, a rebuilding team wants someone worth keeping.
    const oddsRank =
      [...baseline].sort((a, b) => b.titleOdds - a.titleOdds).findIndex((r) => r.id === mine.id) + 1;
    const badge = classifyTeam({
      titleOdds: baseMine.titleOdds,
      playoffOdds: baseMine.playoffOdds,
      oddsRank: Math.max(1, oddsRank),
      teamCount: teams.length,
      isDynasty: showLongTerm,
      dynastyRank: null,
    });
    const posture = strategyFor(badge.key, showLongTerm);
    strategy = posture.mode;
    strategyNote = `${badge.label} — ${posture.rationale}`;

    const beforeLineup = optimalLineup(myRoster, slots).total;
    const byValue = [...myRoster].sort((a, b) => a.proj - b.proj);
    const rosterCap = slots.length + 6;

    // Filling an empty slot is priced the same way: what the best lineup gains
    // this week, and in a chop league how much less likely the cut becomes.
    scoreAdd = (candidate: EnginePlayer) => {
      const next = [...myRoster, candidate];
      const pointsGain = optimalLineup(next, slots).total - beforeLineup;
      let survivalDelta: number | null = null;
      if (survivalLeague && survivalBase) {
        const dist = distributionOf(next);
        const myBase = survivalBase.find((r) => r.id === mine.id)!;
        const after = simulateGuillotine(
          survivalInputs.map((t) => (t.id === mine.id ? { ...t, mean: dist.mean, sd: dist.sd } : t)),
          weeksLeft,
          1200,
          7,
        ).find((r) => r.id === mine.id)!;
        survivalDelta = after.surviveWeekOdds - myBase.surviveWeekOdds;
      }
      return { pointsGain, survivalDelta };
    };

    // Ranking every candidate at full accuracy is wasted work: a coarse pass
    // orders them, then only the handful actually shown gets the long run.
    const priceCandidate = (fa: (typeof eligible)[number], iterations: number) => {
      // Only ever suggest dropping someone the new player can actually cover:
      // same position, or a flex slot they both fit.
      const droppable = byValue
        .filter(
          (p) =>
            p.position === fa.position ||
            slots.some((s) => slotAccepts(s, p.position) && slotAccepts(s, fa.position)),
        )
        // Never suggest cutting someone who would be a top-five add the moment
        // he hits the wire.
        .filter((p) => dropAllowed(book, p.proj, topWireWeek).allowed);
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
      // A full roster with nobody comparable to cut: fall back to the weakest
      // bench player so the add is still priced rather than skipped.
      if (!options.length) {
        const weakest = [...myRoster].sort((a, b) => a.proj - b.proj)[0];
        if (!weakest) return null;
        options.push({
          roster: myRoster.map((p) => (p.name === weakest.name ? candidate : p)),
          drop: weakest,
        });
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
      const inputs = simInputs.map((t) => (t.id === mine!.id ? { ...t, mean: dist.mean, sd: dist.sd } : t));
      const res = simulateSeason(inputs, simConfig, schedule, iterations, 7);
      const m = res.find((r) => r.id === mine!.id)!;

      let survivalDelta: number | null = null;
      if (survivalLeague && survivalBase) {
        // Survival is the only currency here: re-simulate the week with him in
        // my lineup and read how much less likely I am to be cut.
        const myBase = survivalBase.find((r) => r.id === mine!.id)!;
        const withMe = survivalInputs.map((t) =>
          t.id === mine!.id ? { ...t, mean: dist.mean, sd: dist.sd } : t,
        );
        const after = simulateGuillotine(withMe, weeksLeft, Math.max(300, iterations - 300), 7).find(
          (r) => r.id === mine!.id,
        )!;
        survivalDelta = after.surviveWeekOdds - myBase.surviveWeekOdds;
      }

      // A pickup that does not improve the optimal lineup cannot move the
      // season odds; anything the simulation reports there is noise.
      const meaningful = lineupGain > 0.05;
      return {
        titleDelta: meaningful ? m.titleOdds - baseMine.titleOdds : 0,
        playoffDelta: meaningful ? m.playoffOdds - baseMine.playoffOdds : 0,
        winDelta: meaningful ? Math.round((m.projWins - baseMine.projWins) * 100) / 100 : 0,
        survivalDelta: meaningful ? survivalDelta : survivalDelta === null ? null : 0,
        lineupGain: Math.round(lineupGain * 10) / 10,
        drop: lineupGain > 0 && drop ? drop.name : null,
      };
    };

    const depth = opts.deep ? DEEP_CANDIDATES : SCORED_CANDIDATES;
    const shortlist = opts.fillsOnly ? [] : eligible.slice(0, depth);
    for (const fa of shortlist) {
      const rough = priceCandidate(fa, COARSE_ITERATIONS);
      if (rough) impacts.set(fa.id, rough);
    }

    // Re-price the ones the member will actually read at full accuracy.
    const headline = [...shortlist]
      .filter((fa) => impacts.has(fa.id))
      .sort((a, b) => {
        const x = impacts.get(a.id)!;
        const y = impacts.get(b.id)!;
        return survivalLeague
          ? (y.survivalDelta ?? 0) - (x.survivalDelta ?? 0) || y.titleDelta - x.titleDelta
          : y.titleDelta - x.titleDelta || y.lineupGain - x.lineupGain;
      })
      .slice(0, opts.deep ? DEEP_CANDIDATES : DISPLAYED_CANDIDATES);

    for (const fa of headline) {
      const exact = priceCandidate(fa, FULL_ITERATIONS);
      if (exact) impacts.set(fa.id, exact);
    }
  }


  // What claims have actually cost in this league sets the price ceiling.
  const { data: bidRows } = await supabase
    .from("faab_bids")
    .select("amount, won, week")
    .eq("league_id", leagueId)
    .eq("won", true);
  const winningBids = (bidRows ?? []).map((b) => Number(b.amount)).filter((n) => n > 0);

  // --- budget pacing -------------------------------------------------------
  // Spend now against the weeks your own starters are on bye, priced by what
  // claims have historically cost in this league at that point of the season.
  const byeByName = new Map(players.map((p) => [key(p.full_name), p.bye_week]));
  const myStarterByes = (mine ? spots.filter((s) => s.team_id === mine.id && s.is_starter) : [])
    .map((s) => byeByName.get(key(s.player_name)) ?? null)
    .filter((w): w is number => typeof w === "number" && w >= (league.current_week ?? 1));
  const faabPlan =
    myFaabRemaining !== null && myFaabRemaining > 0
      ? buildFaabPlan({
          currentWeek: league.current_week ?? 1,
          lastWeek: league.regular_season_weeks ?? 17,
          remaining: myFaabRemaining,
          starterByeWeeks: myStarterByes,
          historicalWins: (bidRows ?? []).map((b) => ({
            week: Number(b.week ?? 0),
            amount: Number(b.amount),
          })),
        })
      : null;

  const bestAtPosition = new Map<string, number>();
  for (const p of eligible) {
    bestAtPosition.set(p.position, Math.max(bestAtPosition.get(p.position) ?? 0, p.projWeek));
  }

  // The best simulated gain on this board is the yardstick every price is read
  // against, so the player at the top of the list also carries the top bid.
  const primaryImpact = (v: { titleDelta: number; survivalDelta: number | null }) =>
    survivalLeague ? (v.survivalDelta ?? 0) : v.titleDelta;
  const topImpact = Math.max(0, ...[...impacts.values()].map(primaryImpact));
  const weeksLeftNow = Math.max(
    1,
    (league.regular_season_weeks ?? 17) - (league.current_week ?? 1) + 1,
  );

  /**
   * Chop leagues: the most any rival can rationally pay for the same help,
   * given how close they are to the cut and what is left in their budget.
   */
  const rivalFloorFor = (gain: number | null) => {
    if (!survivalLeague || !gain || gain <= 0 || !mine) return null;
    let best = 0;
    for (const t of teams) {
      if (t.id === mine.id) continue;
      const odds = rivalSurvival.get(t.id);
      if (odds == null) continue;
      const remaining = (t as { faab_remaining?: number | null }).faab_remaining;
      best = Math.max(
        best,
        willingToPay(
          faabBudget,
          remaining == null ? null : Number(remaining),
          odds,
          gain,
          teams.length,
          weeksLeftNow,
        ),
      );
    }
    return best > 0 ? best : null;
  };

  // Contenders inside the last four weeks weight the weeks 15-17 run double.
  const playoffWeight = playoffScheduleWeight(book, {
    currentWeek: league.current_week ?? 1,
    regularSeasonWeeks: league.regular_season_weeks ?? 17,
    contender: strategy === "buy",
  });

  // --- empty starting slots -------------------------------------------------
  // A kicker or a defence is a matchup call, not a bidding war: who they play
  // this week, how many points that opponent is expected to score, and how
  // generous that opponent has been to the position.
  const season = Number(league.season ?? new Date().getUTCFullYear());
  const thisWeek = league.current_week ?? 1;
  const [{ data: scheduleRows }, { data: impliedRows }, { data: defenseRows }] = await Promise.all([
    supabase
      .from("nfl_schedule")
      .select("nfl_team, opponent")
      .eq("season", season)
      .eq("week", thisWeek),
    supabase
      .from("team_implied_totals")
      .select("nfl_team, implied")
      .eq("season", season)
      .eq("week", thisWeek),
    supabase
      .from("defense_ranks")
      .select("nfl_team, points_allowed")
      .eq("season", season)
      .eq("week", thisWeek),
  ]);
  const opponentOf = new Map(
    (scheduleRows ?? []).map((r) => [r.nfl_team.toUpperCase(), r.opponent?.toUpperCase() ?? null]),
  );
  const impliedOf = new Map(
    (impliedRows ?? []).map((r) => [r.nfl_team.toUpperCase(), Number(r.implied)]),
  );
  const allowedOf = new Map(
    (defenseRows ?? []).map((r) => [r.nfl_team.toUpperCase(), Number(r.points_allowed)]),
  );

  const factsFor = (nflTeam: string | null) => {
    const team = nflTeam?.toUpperCase() ?? null;
    const opponent = team ? (opponentOf.get(team) ?? null) : null;
    return {
      nflTeam: team,
      opponent,
      impliedOwn: team ? (impliedOf.get(team) ?? null) : null,
      impliedOpponent: opponent ? (impliedOf.get(opponent) ?? null) : null,
      opponentPointsAllowed: opponent ? (allowedOf.get(opponent) ?? null) : null,
    };
  };

  const bidFor = (position: string, perWeek: number) => {
    const raw = bidRecommendation({
      budget: faabBudget,
      remaining: myFaabRemaining,
      perWeek,
      winningBids,
    });
    const capped = applyBidRules(book, {
      position,
      bid: raw.recommended,
      budget: faabBudget,
      remaining: myFaabRemaining,
      weeksLeft: weeksRemaining,
    });
    const paced = faabPlan ? paceBid(capped.bid, faabPlan) : { bid: capped.bid, note: null };
    return { bid: paced.bid, note: paced.note ?? capped.note };
  };

  const fillCandidates: FillCandidate[] = stripPool.map((p) => {
    const priced = isStreamedPosition(p.position)
      ? { bid: 1, note: null }
      : bidFor(p.position, p.projWeek);
    return {
      id: p.id,
      name: p.name,
      position: p.position,
      status: p.status,
      projWeek: p.projWeek,
      projSeason: p.projSeason,
      vor: book.on("value-over-replacement")
        ? valueOverReplacement(p.projSeason, p.position, wireLevels)
        : p.projSeason,
      bid: priced.bid,
      ruleNote: priced.note,
      ...factsFor(p.nflTeam),
    };
  });

  const scoreFill = (c: FillCandidate) =>
    scoreAdd
      ? scoreAdd({
          id: c.id,
          name: c.name,
          position: c.position,
          nflTeam: c.nflTeam,
          proj: c.projWeek,
          volatility: 0.35,
        })
      : { pointsGain: 0, survivalDelta: null };

  const fills = buildFills({
    slots,
    rosterPositions: myRoster.map((p) => p.position),
    candidates: fillCandidates,
    score: scoreFill,
  });

  // Streaming: only when my man draws one of the worst matchups this week and
  // one of the best is sitting free.
  const stream = buildStream({
    slots,
    current: myRoster
      .filter((p) => isStreamedPosition(p.position))
      .map((p) => ({
        name: p.name,
        position: p.position,
        projWeek: p.proj,
        facts: factsFor(p.nflTeam ?? null),
      })),
    candidates: fillCandidates,
    score: scoreFill,
  });



  const mapped: WaiverBoardRow[] = eligible
    .filter((p) => (wanted && wanted !== "ALL" ? p.position === wanted : true))
    .filter((p) => (search ? p.name.toLowerCase().includes(search) : true))
    .map((p) => {
      const impact = impacts.get(p.id) ?? null;
      const gain = impact ? primaryImpact(impact) : null;
      const raw = bidRecommendation({
        budget: faabBudget,
        remaining: myFaabRemaining,
        perWeek: p.projWeek,
        impact: gain,
        topImpact,
        lineupGain: impact ? impact.lineupGain : null,
        rivalFloor: rivalFloorFor(gain),
        winningBids,
      });
      // Rules can only ever lower a bid: streamers go at the minimum and the
      // reserve is kept back for the injuries still to come.
      const capped = applyBidRules(book, {
        position: p.position,
        bid: raw.recommended,
        budget: faabBudget,
        remaining: myFaabRemaining,
        weeksLeft: weeksRemaining,
      });
      // A bid that would eat into the reserve gets trimmed, and says why.
      const paced = faabPlan ? paceBid(capped.bid, faabPlan) : { bid: capped.bid, note: null };
      const bidRec: BidRecommendation = {
        recommended: paced.bid,
        passive: Math.max(0, Math.round(paced.bid * 0.7)),
        aggressive: Math.min(
          Math.round(paced.bid * 1.3),
          isStreamPosition(p.position) && book.on("stream-k-def") ? paced.bid : raw.aggressive,
        ),
        ceiling: Math.min(raw.ceiling, Math.max(paced.bid, raw.ceiling)),
      };

      const handcuff = book.on("handcuff-top-rb") && isHandcuff(p, myRoster);
      const duplicate = duplicateStreamer(book, p.position, myRoster.map((r) => r.position));
      const ruleScore =
        playoffWeight * (handcuff ? 1.5 : 1) * (duplicate ? 0.25 : 1);

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
        ktcValue: p.ktcValue,
        projValue: p.projValue,
        undervalued: p.undervalued,
        bid: bidRec.recommended,
        bidRec,
        vor: book.on("value-over-replacement")
          ? valueOverReplacement(p.projSeason, p.position, wireLevels)
          : p.projSeason,
        ruleScore,
        ruleNote: ruleNote([
          duplicate,
          capped.note,
          paced.note,
          handcuff ? book.why("handcuff-top-rb") : null,
          playoffWeight > 1 ? book.why("playoff-schedule") : null,
        ]),
        lineupGain: impact ? impact.lineupGain : null,
        titleDelta: impact ? impact.titleDelta : null,
        playoffDelta: impact ? impact.playoffDelta : null,
        winDelta: impact ? impact.winDelta : null,
        survivalDelta: impact ? impact.survivalDelta : null,
        fromCutTeam: p.fromCutTeam,
        suggestedDrop: impact ? impact.drop : null,
        scored: !!impact,
        longTermValue: p.longTermValue,
      };
    });

  const rows = rankWaivers(mapped, {
    sort: opts.sort ?? "impact",
    survival: survivalLeague,
    showInjured: true,
    strategy,
  }).slice(0, opts.limit ?? 60);

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
    valueFormat: values.format,
    valuesCovered: values.covered,
    strategy,
    strategyNote,
    isSurvivalLeague: survivalLeague,
    faabBudget,
    myFaabRemaining,
    myTeamId: mine?.id ?? null,
    projectionLabel: projectionFallback
      ? "App projections (fallback)"
      : resolveProjectionSource(league).label,
    projectionFallback,
    needsKicker,
    needsDefense,
    fills,
    stream,
    ruleNotes: [...new Set(rows.map((r) => r.ruleNote).filter((n): n is string => !!n))],
    faabPlan,
  };
}
