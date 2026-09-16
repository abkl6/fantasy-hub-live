import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { optimalLineup, slotAccepts, type EnginePlayer, type Slot } from "./engine";
import { normalizeName } from "./names";

type DB = SupabaseClient<Database>;

export interface WeekReview {
  week: number;
  result: "win" | "loss" | "tie";
  myScore: number;
  oppScore: number;
  margin: number;
  oppName: string;
  /** Points left on the bench: best possible lineup minus what I actually started. */
  benchPoints: number;
  bestPossible: number;
  worstCall: {
    started: string;
    startedPoints: number;
    benched: string;
    benchedPoints: number;
    slot: string;
    cost: number;
  } | null;
  /** League median score that week, and whether my score would have beaten it. */
  median: number;
  beatMedian: boolean;
  luck: "lucky" | "unlucky" | "deserved";
  /** Where my score ranked in the league that week. */
  rank: number;
  teamCount: number;
  /** Season standing on total points, and how it moved that week. */
  seasonRank: number;
  seasonRankChange: number;
  /** The league's weekly top-scorer bonus, when it runs one. */
  weeklyHigh: { won: boolean; margin: number; topTeam: string; label: string | null } | null;
  recommendation: { headline: string; detail: string } | null;
  /** How last week's advice actually turned out. */
  grades: RecommendationGrade[];
}

export type GradeVerdict = "right" | "wrong" | "missed" | "dodged" | "push";

export interface RecommendationGrade {
  id: string;
  headline: string;
  action: "taken" | "ignored";
  verdict: GradeVerdict;
  note: string;
}

/**
 * The recap only makes sense between the Monday-night final and the next
 * kickoff, so it shows from Tuesday morning until Thursday evening (ET).
 */
export function inReviewWindow(now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    hour12: false,
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  if (weekday === "Tue" || weekday === "Wed") return true;
  return weekday === "Thu" && hour < 20;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

const VERDICT_WORD: Record<GradeVerdict, string> = {
  right: "Good call",
  wrong: "Didn't work out",
  missed: "Missed",
  dodged: "Dodged one",
  push: "Line ball",
};

/**
 * Grades the advice the manager acted on last week against what the players
 * actually scored. Taken moves are right when they gained points; ignored ones
 * are missed when they would have.
 */
export async function gradeRecommendations(
  supabase: DB,
  input: { leagueId: string; season: number; week: number },
): Promise<RecommendationGrade[]> {
  const { data: logRows } = await supabase
    .from("recommendation_log")
    .select("id, headline, action, add_name, drop_name, grade, grade_note")
    .eq("league_id", input.leagueId)
    .eq("week", input.week)
    .in("action", ["taken", "ignored"]);

  const rows = logRows ?? [];
  if (!rows.length) return [];

  const names = new Set<string>();
  for (const r of rows) {
    if (r.add_name) names.add(normalizeName(r.add_name));
    if (r.drop_name) names.add(normalizeName(r.drop_name));
  }

  const { data: statRows } = await supabase
    .from("player_week_stats")
    .select("src_points, players!inner(full_name)")
    .eq("season", input.season)
    .eq("week", input.week);
  const actualByName = new Map<string, number>();
  for (const row of statRows ?? []) {
    const full = (row as { players?: { full_name?: string } }).players?.full_name;
    if (!full) continue;
    const key = normalizeName(full);
    if (names.has(key)) actualByName.set(key, Number(row.src_points ?? 0));
  }

  const grades: RecommendationGrade[] = [];
  const updates: { id: string; grade: GradeVerdict; grade_note: string; graded_week: number }[] = [];

  for (const r of rows) {
    const action = r.action === "taken" ? "taken" : "ignored";
    const gained = r.add_name ? (actualByName.get(normalizeName(r.add_name)) ?? null) : null;
    const lost = r.drop_name ? (actualByName.get(normalizeName(r.drop_name)) ?? null) : null;
    if (gained === null && lost === null) continue;
    const delta = (gained ?? 0) - (lost ?? 0);
    const verdict: GradeVerdict =
      Math.abs(delta) < 1
        ? "push"
        : action === "taken"
          ? delta > 0
            ? "right"
            : "wrong"
          : delta > 0
            ? "missed"
            : "dodged";
    const note =
      `${VERDICT_WORD[verdict]} — ` +
      `${r.add_name ?? "the add"} scored ${round1(gained ?? 0)}` +
      (r.drop_name ? ` against ${r.drop_name}'s ${round1(lost ?? 0)}.` : ".");
    grades.push({ id: r.id, headline: r.headline, action, verdict, note });
    if (r.grade !== verdict || r.grade_note !== note) {
      updates.push({ id: r.id, grade: verdict, grade_note: note, graded_week: input.week });
    }
  }

  for (const u of updates) {
    await supabase
      .from("recommendation_log")
      .update({ grade: u.grade, grade_note: u.grade_note, graded_week: u.graded_week })
      .eq("id", u.id);
  }

  return grades;
}


/**
 * Builds last week's recap for one team, or returns null when there is no
 * finished week to look back on. Cached by the caller in weekly_snapshots.
 */
export async function buildWeekReview(
  supabase: DB,
  input: {
    leagueId: string;
    season: number;
    rosterSlots: Slot[];
    myTeamId: string;
    recommendation: { headline: string; detail: string } | null;
    weeklyHighBonus?: boolean;
    weeklyHighLabel?: string | null;
  },
): Promise<WeekReview | null> {
  const { data: matchupRows } = await supabase
    .from("matchups")
    .select("week, home_team_id, away_team_id, home_score, away_score, is_final")
    .eq("league_id", input.leagueId)
    .eq("is_final", true)
    .order("week", { ascending: false });

  const finals = matchupRows ?? [];
  const mineAll = finals.filter(
    (m) => m.home_team_id === input.myTeamId || m.away_team_id === input.myTeamId,
  );
  const week = mineAll[0]?.week;
  if (!week) return null;
  const mine = mineAll[0]!;

  const isHome = mine.home_team_id === input.myTeamId;
  const myScore = Number(isHome ? mine.home_score : mine.away_score);
  const oppScore = Number(isHome ? mine.away_score : mine.home_score);
  const oppTeamId = isHome ? mine.away_team_id : mine.home_team_id;

  const weekRows = finals.filter((m) => m.week === week);
  const leagueScores = weekRows.flatMap((m) => [Number(m.home_score), Number(m.away_score)]);
  const med = median(leagueScores);

  const [{ data: oppTeam }, { data: spotRows }] = await Promise.all([
    oppTeamId
      ? supabase.from("teams").select("name").eq("id", oppTeamId).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("roster_spots")
      .select("player_id, player_name, position, slot, is_starter")
      .eq("league_id", input.leagueId)
      .eq("team_id", input.myTeamId),
  ]);

  const spots = spotRows ?? [];
  const playerIds = spots.map((s) => s.player_id).filter((id): id is string => !!id);
  const actualById = new Map<string, number>();
  if (playerIds.length) {
    const { data: statRows } = await supabase
      .from("player_week_stats")
      .select("player_id, src_points")
      .eq("season", input.season)
      .eq("week", week)
      .in("player_id", playerIds);
    for (const row of statRows ?? []) actualById.set(row.player_id, Number(row.src_points));
  }

  const actualOf = (playerId: string | null) => (playerId ? (actualById.get(playerId) ?? 0) : 0);

  const roster: EnginePlayer[] = spots.map((s) => ({
    id: s.player_id,
    name: s.player_name,
    position: s.position.toUpperCase(),
    nflTeam: null,
    proj: actualOf(s.player_id),
    volatility: 0,
  }));

  const started = spots.filter((s) => s.is_starter);
  const benched = spots.filter((s) => !s.is_starter);
  const startedTotal = started.reduce((sum, s) => sum + actualOf(s.player_id), 0);
  const best = optimalLineup(roster, input.rosterSlots);
  const benchPoints = Math.max(0, best.total - startedTotal);

  // The single decision that cost the most: a bench player who could have
  // filled the slot of someone I actually started.
  let worstCall: WeekReview["worstCall"] = null;
  for (const starter of started) {
    const slot = String(starter.slot) as Slot;
    for (const alt of benched) {
      if (!slotAccepts(slot, alt.position.toUpperCase())) continue;
      const cost = actualOf(alt.player_id) - actualOf(starter.player_id);
      if (cost > 0 && (!worstCall || cost > worstCall.cost)) {
        worstCall = {
          started: starter.player_name,
          startedPoints: round1(actualOf(starter.player_id)),
          benched: alt.player_name,
          benchedPoints: round1(actualOf(alt.player_id)),
          slot,
          cost: round1(cost),
        };
      }
    }
  }

  // Rank this week, and the season points standing before and after it.
  const weekByTeam = new Map<string, number>();
  for (const m of weekRows) {
    if (m.home_team_id) weekByTeam.set(m.home_team_id, Number(m.home_score));
    if (m.away_team_id) weekByTeam.set(m.away_team_id, Number(m.away_score));
  }
  const weekOrder = [...weekByTeam.entries()].sort((a, b) => b[1] - a[1]);
  const rank = Math.max(1, weekOrder.findIndex(([id]) => id === input.myTeamId) + 1);
  const teamCount = weekOrder.length;

  const cumulative = new Map<string, number>();
  const cumulativeBefore = new Map<string, number>();
  for (const m of finals) {
    if (m.week > week) continue;
    for (const side of [
      { id: m.home_team_id, score: Number(m.home_score) },
      { id: m.away_team_id, score: Number(m.away_score) },
    ]) {
      if (!side.id) continue;
      cumulative.set(side.id, (cumulative.get(side.id) ?? 0) + side.score);
      if (m.week < week) cumulativeBefore.set(side.id, (cumulativeBefore.get(side.id) ?? 0) + side.score);
    }
  }
  const rankIn = (totals: Map<string, number>) => {
    const order = [...totals.entries()].sort((a, b) => b[1] - a[1]);
    const i = order.findIndex(([id]) => id === input.myTeamId);
    return i >= 0 ? i + 1 : order.length + 1;
  };
  const seasonRank = rankIn(cumulative);
  const seasonRankChange = cumulativeBefore.size ? rankIn(cumulativeBefore) - seasonRank : 0;

  let weeklyHigh: WeekReview["weeklyHigh"] = null;
  if (input.weeklyHighBonus && weekOrder.length) {
    const [topId, topScore] = weekOrder[0]!;
    const won = topId === input.myTeamId;
    const runnerUp = weekOrder[1]?.[1] ?? topScore;
    const { data: topTeamRow } = await supabase
      .from("teams")
      .select("name")
      .eq("id", topId)
      .maybeSingle();
    weeklyHigh = {
      won,
      margin: round1(won ? myScore - runnerUp : topScore - myScore),
      topTeam: (topTeamRow as { name?: string } | null)?.name ?? "the top scorer",
      label: input.weeklyHighLabel ?? null,
    };
  }

  const result = myScore > oppScore ? "win" : myScore < oppScore ? "loss" : "tie";
  const beatMedian = myScore > med;
  const luck =
    result === "win" && !beatMedian ? "lucky" : result === "loss" && beatMedian ? "unlucky" : "deserved";

  return {
    week,
    result,
    myScore: round1(myScore),
    oppScore: round1(oppScore),
    margin: round1(Math.abs(myScore - oppScore)),
    oppName: (oppTeam as { name?: string } | null)?.name ?? "Your opponent",
    benchPoints: round1(benchPoints),
    bestPossible: round1(best.total),
    worstCall,
    median: round1(med),
    beatMedian,
    luck,
    rank,
    teamCount,
    seasonRank,
    seasonRankChange,
    weeklyHigh,
    recommendation: input.recommendation,
    grades: await gradeRecommendations(supabase, {
      leagueId: input.leagueId,
      season: input.season,
      week,
    }),
  };
}

/** The most recent finished week for this team, used as the recap's cache key. */
export async function latestFinalWeek(
  supabase: DB,
  leagueId: string,
  teamId: string,
): Promise<number | null> {
  const { data } = await supabase
    .from("matchups")
    .select("week")
    .eq("league_id", leagueId)
    .eq("is_final", true)
    .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
    .order("week", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.week ?? null;
}
