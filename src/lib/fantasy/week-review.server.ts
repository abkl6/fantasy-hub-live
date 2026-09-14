import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { optimalLineup, slotAccepts, type EnginePlayer, type Slot } from "./engine";

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
  recommendation: { headline: string; detail: string } | null;
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
    recommendation: input.recommendation,
  };
}
