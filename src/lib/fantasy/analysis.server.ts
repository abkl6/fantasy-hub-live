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
import { loadProjections } from "./projections.server";
import { fetchAllRows } from "./paginate";
import { normalizeName } from "./names";
import { leagueScoring } from "./scoring";
import { classifyTeam, type TeamBadge } from "./team-class";
import {
  asFormat,
  bestBallDistribution,
  blendedValue,
  dynastyValue,
  FORMAT_LABELS,
  hasLineupDecisions,
  isMultiYear,
  isSurvival,
  simulateGuillotine,
  type LeagueFormat,
  type SurvivalResult,
} from "./format";
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
}

export interface DynastyRow {
  name: string;
  position: string;
  age: number | null;
  longTermValue: number;
  blendedValue: number;
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
  })[];
  grades: PositionGrade[];
  lineup: { slot: string; name: string; position: string; proj: number; status: string; nflTeam: string | null; byeWeek: number | null }[];
  bench: { name: string; position: string; proj: number; status: string; nflTeam: string | null; byeWeek: number | null }[];
  suggestions: MoveSuggestion[];
  scoreboard: ScoreboardGame[];
  tradeCandidates: { id: string; name: string; position: string; proj: number; teamName: string; teamId: string }[];
  myTradeable: { id: string; name: string; position: string; proj: number }[];
  playoff: PlayoffPayload;
  alerts: Alert[];
  format: LeagueFormat;
  formatLabel: string;
  scoringLabel: string;
  /** Guillotine only: weekly survival odds instead of playoff/title odds. */
  survival: SurvivalResult[] | null;
  mySurvival: SurvivalResult | null;
  /** Dynasty / keeper only: long-term value of my roster. */
  dynasty: DynastyRow[] | null;
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
  const proj = await loadProjections(supabase, { scoring, week: league.current_week ?? 1 });
  const format = asFormat((league as { format?: string }).format);
  const bestBall = !hasLineupDecisions(format);

  // Dynasty trade currency: market values plus each team's future pick stock.
  const values = await loadTradeValues(supabase, leagueValueFormat(slots));
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
        })),
        picks: pickAssets.get(t.id) ?? [],
      })),
      values,
    );
    for (const row of rows) {
      dynastyRankById.set(row.teamId, row.rank);
      dynastyValueById.set(row.teamId, row.total);
    }
  }
  const ageByPlayer = new Map(
    players.map((p) => [
      normalizeName(p.full_name),
      {
        age: (p as { age?: number | null }).age ?? null,
        yearsExp: (p as { years_exp?: number | null }).years_exp ?? null,
      },
    ]),
  );
  const laneOf = (p: EnginePlayer) => {
    const meta = ageByPlayer.get(normalizeName(p.name));
    return ageLane(p.position, meta?.age ?? null, meta?.yearsExp ?? null);
  };

  const distributionOf = (roster: EnginePlayer[]) =>
    bestBall ? bestBallDistribution(roster, slots) : teamDistribution(roster, slots);

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
    .map((r, index) => {
      const row = teamById.get(r.id);
      return {
        ...r,
        record: row ? recordOf(row) : "0-0",
        pointsFor: row ? Number(row.points_for) : 0,
        badge: classifyTeam({
          titleOdds: r.titleOdds,
          playoffOdds: r.playoffOdds,
          oddsRank: index + 1,
          teamCount: teams.length,
          isDynasty: isDynastyLeague,
          dynastyRank: dynastyRankById.get(r.id) ?? null,
        }),
        dynastyValue: dynastyValueById.get(r.id) ?? null,
        dynastyRank: dynastyRankById.get(r.id) ?? null,
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

  // Guillotine leagues have no playoffs: the lowest scorer is cut each week.
  const weeksLeft = Math.max(1, league.regular_season_weeks - league.current_week + 1);
  const survival = isSurvival(format)
    ? simulateGuillotine(
        simInputs.map((t) => ({ id: t.id, name: t.name, isMine: t.isMine, mean: t.mean, sd: t.sd })),
        weeksLeft,
      )
    : null;

  const formatMeta = {
    format,
    formatLabel: FORMAT_LABELS[format],
    scoringLabel: scoring.label,
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
        if (after - beforeLineup < 0.5) continue;
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

        suggestions.push({
          id: `trade-${other.id}-${target.name}`,
          kind: "trade",
          headline: `Send ${giveText} to ${other.name} for ${getText}`,
          detail: `Fills your ${need} hole from a position of surplus. Lineup gains ${(after - beforeLineup).toFixed(1)} points a week. ${fairnessLabel(balanced.giveValue, balanced.getValue)} on the ${marketLabel} dynasty market.`,
          pointsDelta: Math.round((after - beforeLineup) * 10) / 10,
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
        });
        break;
      }
    }

    // ---- selling: my veterans to a contender for picks and youth ----------
    if (modes.includes("sell") && (otherPicks.length || other.roster.length)) {
      const send = mine.roster
        .filter((p) => laneOf(p) !== "young")
        .sort((a, b) => valueOf(b) - valueOf(a))[0];
      const theirYoung = other.roster
        .filter((p) => laneOf(p) === "young")
        .sort((a, b) => valueOf(b) - valueOf(a))[0];
      const back: TradeAsset[] = [];
      if (otherPicks[0]) back.push(otherPicks[0]);
      if (theirYoung) back.push(assetFor(theirYoung));

      if (send && back.length) {
        const nextRoster = theirYoung
          ? mine.roster.map((p) => (p.name === send.name ? theirYoung : p))
          : mine.roster.filter((p) => p.name !== send.name);
        const after = optimalLineup(nextRoster, slots).total;
        const impact = whatIf(nextRoster);

        const myPool: TradeAsset[] = mine.roster
          .filter((p) => p.name !== send.name && laneOf(p) === "veteran")
          .map(assetFor)
          .sort((a, b) => a.value - b.value);
        const theirPool: TradeAsset[] = [
          ...otherPicks.slice(1),
          ...other.roster
            .filter((p) => laneOf(p) === "young" && p.name !== theirYoung?.name)
            .map(assetFor),
        ].sort((a, b) => a.value - b.value);

        const balanced = balanceTrade([assetFor(send)], back, myPool, theirPool);
        const gained = balanced.getValue - balanced.giveValue;
        const cost = Math.max(0, beforeLineup - after);
        const giveText = balanced.give.map(assetLabel).join(" + ");
        const getText = balanced.get.map(assetLabel).join(" + ");

        suggestions.push({
          id: `sell-${other.id}-${send.name}`,
          kind: "trade",
          headline: `Sell ${giveText} to ${other.name} for ${getText}`,
          detail: `${other.name} are a ${otherLabel} and should pay for win-now help. You bank ${Math.abs(gained).toLocaleString()} ${gained >= 0 ? "of extra" : "less"} future value on the ${marketLabel} market and give up ${cost.toFixed(1)} points a week you don't need.`,
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
        });
      }
    }
  }

  // Sell ideas are supposed to cost title odds, so they are ranked by the
  // future value they bring back instead (5,000 market points ~ one title point).
  const rankScore = (s: MoveSuggestion) =>
    s.strategy === "sell" ? (s.dynastyDelta ?? 0) / 5000 : s.titleDelta;
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
      .map((p) => {
        const meta = ageByName.get(normalizeName(p.name));
        const season = meta?.season ?? p.proj * 17;
        const longTerm = dynastyValue(p.position, season, bestSeason, meta?.age ?? null, meta?.yearsExp ?? null);
        return {
          name: p.name,
          position: p.position,
          age: meta?.age ?? null,
          longTermValue: longTerm,
          blendedValue: blendedValue(format, season, bestSeason, longTerm),
        };
      })
      .sort((a, b) => b.blendedValue - a.blendedValue);
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
    ...formatMeta,
    mySurvival,
    dynasty,
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
