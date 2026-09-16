/**
 * Recording what the app predicted, then marking its own homework.
 * Server-only.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import {
  calibrationVerdict,
  maeByPosition,
  weeklyBrier,
  type CalibrationRow,
  type PositionError,
  type WeeklyBrier,
} from "./calibration";
import { DEFAULT_VOLATILITY, setVolatilityDefaults } from "./engine";

type DB = SupabaseClient<Database>;

export interface PredictionRecord {
  userId: string;
  leagueId: string | null;
  teamId?: string | null;
  season: number;
  week: number;
  kind: "win_prob" | "projection";
  /** Unique within the week: a team id for matchups, a player name otherwise. */
  subject: string;
  position?: string | null;
  predicted: number;
}

/** Writes down what the app is telling the user, before the games are played. */
export async function recordPredictions(supabase: DB, rows: PredictionRecord[]) {
  if (!rows.length) return 0;
  const payload = rows.map((r) => ({
    user_id: r.userId,
    league_id: r.leagueId,
    team_id: r.teamId ?? null,
    season: r.season,
    week: r.week,
    kind: r.kind,
    subject: r.subject,
    position: r.position ?? null,
    predicted: r.predicted,
  }));
  for (let i = 0; i < payload.length; i += 300) {
    // Predictions are overwritten until the week is graded — the last thing
    // the user was shown is the thing we hold the app to.
    const { error } = await supabase
      .from("calibration_log")
      .upsert(payload.slice(i, i + 300) as never, {
        onConflict: "user_id,season,week,kind,subject",
        ignoreDuplicates: false,
      });
    if (error) throw new Error(error.message);
  }
  return payload.length;
}

/**
 * Once a week is final, fill in what actually happened: did the favourite win,
 * and how far off was each player projection?
 */
export async function gradeCalibration(
  admin: DB,
  season: number,
  week: number,
): Promise<{ graded: number }> {
  const { data: pending } = await admin
    .from("calibration_log")
    .select("id, kind, subject, league_id, predicted")
    .eq("season", season)
    .eq("week", week)
    .is("graded_at", null);
  if (!pending?.length) return { graded: 0 };

  const winRows = pending.filter((r) => r.kind === "win_prob");
  const projRows = pending.filter((r) => r.kind === "projection");

  // Matchups: the subject is my team id, so the result is in the matchup row.
  const wonByTeam = new Map<string, boolean>();
  if (winRows.length) {
    const leagueIds = [...new Set(winRows.map((r) => r.league_id).filter(Boolean))] as string[];
    const { data: games } = await admin
      .from("matchups")
      .select("home_team_id, away_team_id, home_score, away_score, is_final")
      .in("league_id", leagueIds)
      .eq("week", week);
    for (const g of games ?? []) {
      if (!g.is_final || !g.home_team_id || !g.away_team_id) continue;
      const home = Number(g.home_score);
      const away = Number(g.away_score);
      wonByTeam.set(g.home_team_id, home > away);
      wonByTeam.set(g.away_team_id, away > home);
    }
  }

  // Projections: the subject is the player's name.
  const actualByName = new Map<string, number>();
  if (projRows.length) {
    const { data: stats } = await admin
      .from("player_week_stats")
      .select("player_id, src_points, players(full_name)")
      .eq("season", season)
      .eq("week", week)
      .eq("source", "actual");
    for (const row of (stats ?? []) as unknown as {
      src_points: number;
      players: { full_name: string } | null;
    }[]) {
      if (row.players?.full_name) actualByName.set(row.players.full_name, Number(row.src_points));
    }
  }

  const now = new Date().toISOString();
  let graded = 0;
  for (const row of pending) {
    let actual: number | null = null;
    let error: number | null = null;
    let brierScore: number | null = null;

    if (row.kind === "win_prob") {
      const won = wonByTeam.get(row.subject);
      if (won === undefined) continue;
      actual = won ? 1 : 0;
      brierScore = (Number(row.predicted) - actual) ** 2;
      error = Math.abs(Number(row.predicted) - actual);
    } else {
      const points = actualByName.get(row.subject);
      if (points === undefined) continue;
      actual = points;
      error = Math.abs(Number(row.predicted) - points);
    }

    await admin
      .from("calibration_log")
      .update({ actual, error, brier: brierScore, graded_at: now })
      .eq("id", row.id);
    graded += 1;
  }
  return { graded };
}

export interface CalibrationSummary {
  brier: WeeklyBrier[];
  mae: PositionError[];
  verdict: ReturnType<typeof calibrationVerdict>;
  adjustments: {
    week: number;
    position: string;
    previous: number;
    next: number;
    reason: string;
  }[];
}

async function loadRows(admin: DB, season: number): Promise<CalibrationRow[]> {
  const { data } = await admin
    .from("calibration_log")
    .select("week, kind, position, predicted, actual")
    .eq("season", season)
    .not("actual", "is", null)
    .limit(20000);
  return (data ?? []).map((r) => ({
    week: r.week,
    kind: r.kind === "win_prob" ? "win_prob" : "projection",
    position: r.position,
    predicted: Number(r.predicted),
    actual: r.actual === null ? null : Number(r.actual),
  }));
}

export async function calibrationSummary(
  admin: DB,
  season: number,
  currentWeek: number,
): Promise<CalibrationSummary> {
  const rows = await loadRows(admin, season);
  const { data: adjustments } = await admin
    .from("volatility_adjustments")
    .select("week, position, previous, next, reason")
    .eq("season", season)
    .order("created_at", { ascending: false })
    .limit(30);

  return {
    brier: weeklyBrier(rows),
    mae: maeByPosition(rows),
    verdict: calibrationVerdict(rows, currentWeek),
    adjustments: (adjustments ?? []).map((a) => ({
      week: a.week,
      position: a.position,
      previous: Number(a.previous),
      next: Number(a.next),
      reason: a.reason,
    })),
  };
}

/**
 * The self-correction: when mid-range favourites have been winning far more or
 * far less than the app said, every position's assumed swing moves 10% and the
 * change is written down.
 */
export async function applyCalibration(
  admin: DB,
  season: number,
  currentWeek: number,
): Promise<{ changed: boolean; reason: string; factor: number }> {
  const rows = await loadRows(admin, season);
  const verdict = calibrationVerdict(rows, currentWeek);
  if (verdict.factor === 1) return { changed: false, reason: verdict.reason, factor: 1 };

  const updates: Record<string, number> = {};
  const logRows = [];
  for (const [position, previous] of Object.entries(DEFAULT_VOLATILITY)) {
    const next = Math.round(previous * verdict.factor * 1000) / 1000;
    updates[position] = next;
    logRows.push({
      season,
      week: currentWeek,
      position,
      previous,
      next,
      reason: verdict.reason,
      sample_weeks: verdict.samples,
    });
  }
  const { error } = await admin.from("volatility_adjustments").insert(logRows as never);
  if (error) throw new Error(error.message);
  setVolatilityDefaults(updates);
  return { changed: true, reason: verdict.reason, factor: verdict.factor };
}

/** Loads the latest stored defaults into the engine for this request. */
export async function loadVolatilityDefaults(supabase: DB, season: number) {
  const { data } = await supabase
    .from("volatility_adjustments")
    .select("position, next, created_at")
    .eq("season", season)
    .order("created_at", { ascending: false })
    .limit(40);
  const latest: Record<string, number> = {};
  for (const row of data ?? []) {
    if (latest[row.position] === undefined) latest[row.position] = Number(row.next);
  }
  if (Object.keys(latest).length) setVolatilityDefaults(latest);
  return latest;
}
