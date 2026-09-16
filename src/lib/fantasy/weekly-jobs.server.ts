/**
 * Jobs that run once a week's games are finished: store what actually
 * happened, blend it into the rest-of-season outlook, re-measure how steady
 * each player is, and check every league's scoreboard against our own maths.
 * Server-only.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

import { blendRates, type Rates } from "./blend";
import { fetchAllRows } from "./paginate";
import { reconcileTeam, hasScoringGap, type ReconPlayer } from "./reconcile";
import { BASELINE_RULES, leagueScoring, scoreStats, type StatLine } from "./scoring";
import { historicalVolatility } from "./volatility";

type DB = SupabaseClient<Database>;

const SEASON_GAMES = 17;

function asStats(value: unknown): StatLine {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: StatLine = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const n = Number(v);
    if (Number.isFinite(n) && n !== 0) out[k] = n;
  }
  return out;
}

/**
 * Copy finished games out of the live feed into the weekly stat table under
 * `source = 'actual'`, so everything downstream reads results the same way it
 * reads projections.
 */
export async function storeWeekActuals(
  admin: DB,
  season: number,
  week: number,
): Promise<{ rows: number }> {
  const [{ data: liveRows }, { data: playerRows }] = await Promise.all([
    admin
      .from("live_player_stats")
      .select("player_id, stats, opponent, game_state")
      .eq("season", season)
      .eq("week", week),
    admin.from("players").select("id, position"),
  ]);

  const positionOf = new Map((playerRows ?? []).map((p) => [p.id, p.position]));
  const rows: Record<string, unknown>[] = [];
  for (const row of liveRows ?? []) {
    if (row.game_state !== "post") continue;
    const stats = asStats(row.stats);
    if (!Object.keys(stats).length) continue;
    const position = positionOf.get(row.player_id) ?? "";
    rows.push({
      player_id: row.player_id,
      season,
      week,
      opponent: row.opponent ?? null,
      stats,
      src_points: Math.round(scoreStats(stats, BASELINE_RULES, position) * 100) / 100,
      source: "actual",
    });
  }

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin
      .from("player_week_stats")
      .upsert(rows.slice(i, i + 500) as never, { onConflict: "player_id,season,week,source" });
    if (error) throw new Error(error.message);
  }
  return { rows: rows.length };
}

interface ActualLine {
  games: number;
  totals: Rates;
  points: number[];
}

async function actualsBySeason(admin: DB, season: number) {
  const rows = await fetchAllRows<{
    player_id: string;
    stats: unknown;
    src_points: number;
    week: number;
  }>((from, to) =>
    admin
      .from("player_week_stats")
      .select("player_id, stats, src_points, week")
      .eq("season", season)
      .eq("source", "actual")
      .order("player_id")
      .range(from, to),
  );

  const byPlayer = new Map<string, ActualLine>();
  for (const row of rows) {
    const stats = asStats(row.stats);
    // A player who did not take the field is not a game played.
    if (!Object.keys(stats).length) continue;
    const entry = byPlayer.get(row.player_id) ?? { games: 0, totals: {}, points: [] };
    entry.games += 1;
    entry.points.push(Number(row.src_points) || 0);
    for (const [key, value] of Object.entries(stats)) {
      entry.totals[key] = (entry.totals[key] ?? 0) + value;
    }
    byPlayer.set(row.player_id, entry);
  }
  return byPlayer;
}

/**
 * Blend this season's per-game production with the preseason projection and
 * store the result, with the weight so the app can say what it is based on.
 */
export async function recomputeBlendRates(
  admin: DB,
  season: number,
): Promise<{ players: number }> {
  const [actual, projRows] = await Promise.all([
    actualsBySeason(admin, season),
    fetchAllRows<{ player_id: string; stats: unknown }>((from, to) =>
      admin
        .from("player_season_projections")
        .select("player_id, stats")
        .eq("season", season)
        .eq("source", "app")
        .order("player_id")
        .range(from, to),
    ),
  ]);

  const projected = new Map<string, Rates>();
  for (const row of projRows) projected.set(row.player_id, asStats(row.stats));

  // Where no season total exists, add up the weekly app projections instead.
  const missing = [...actual.keys()].filter((id) => !projected.has(id));
  if (missing.length) {
    const weekRows = await fetchAllRows<{ player_id: string; stats: unknown }>((from, to) =>
      admin
        .from("player_week_stats")
        .select("player_id, stats")
        .eq("season", season)
        .eq("source", "app")
        .order("player_id")
        .range(from, to),
    );
    const totals = new Map<string, Rates>();
    for (const row of weekRows) {
      const line = totals.get(row.player_id) ?? {};
      for (const [key, value] of Object.entries(asStats(row.stats))) {
        line[key] = (line[key] ?? 0) + value;
      }
      totals.set(row.player_id, line);
    }
    for (const id of missing) {
      const line = totals.get(id);
      if (line) projected.set(id, line);
    }
  }

  const upserts: Record<string, unknown>[] = [];
  for (const [playerId, line] of actual) {
    const actualPerGame: Rates = {};
    for (const [key, value] of Object.entries(line.totals)) {
      actualPerGame[key] = value / line.games;
    }
    const projTotals = projected.get(playerId) ?? {};
    const projPerGame: Rates = {};
    for (const [key, value] of Object.entries(projTotals)) {
      projPerGame[key] = value / SEASON_GAMES;
    }
    const blended = blendRates(actualPerGame, projPerGame, line.games);
    upserts.push({
      player_id: playerId,
      season,
      source: "app",
      per_game: blended.perGame,
      blend_weight: Math.round(blended.weight * 1000) / 1000,
      games_played: line.games,
    });
  }

  for (let i = 0; i < upserts.length; i += 400) {
    const { error } = await admin
      .from("player_blend_rates")
      .upsert(upserts.slice(i, i + 400) as never, { onConflict: "player_id,season,source" });
    if (error) throw new Error(error.message);
  }
  return { players: upserts.length };
}

/**
 * Measure how much each player swings week to week and store it, so the season
 * simulation stops guessing from position alone.
 */
export async function recomputeVolatility(
  admin: DB,
  season: number,
): Promise<{ players: number }> {
  const [thisSeason, lastSeason] = await Promise.all([
    actualsBySeason(admin, season),
    actualsBySeason(admin, season - 1),
  ]);

  const byValue = new Map<number, string[]>();
  const ids = new Set([...thisSeason.keys(), ...lastSeason.keys()]);
  for (const id of ids) {
    const points = [...(lastSeason.get(id)?.points ?? []), ...(thisSeason.get(id)?.points ?? [])];
    const value = historicalVolatility(points);
    if (value === null) continue;
    const list = byValue.get(value) ?? [];
    list.push(id);
    byValue.set(value, list);
  }

  let updated = 0;
  for (const [value, list] of byValue) {
    for (let i = 0; i < list.length; i += 200) {
      const slice = list.slice(i, i + 200);
      const { error } = await admin.from("players").update({ volatility: value }).in("id", slice);
      if (error) throw new Error(error.message);
      updated += slice.length;
    }
  }
  return { players: updated };
}

export interface ReconciliationSummary {
  leagues: number;
  teams: number;
  flagged: number;
}

/**
 * Re-score every team's week from the stat lines we hold and compare with the
 * score their platform reported.
 */
export async function runReconciliation(
  admin: DB,
  season: number,
  week: number,
): Promise<ReconciliationSummary> {
  const [{ data: leagues }, { data: playerRows }] = await Promise.all([
    admin
      .from("leagues")
      .select("id, user_id, scoring_type, scoring_rules")
      .eq("season", season),
    admin.from("players").select("id, full_name, position"),
  ]);
  if (!leagues?.length) return { leagues: 0, teams: 0, flagged: 0 };

  const meta = new Map((playerRows ?? []).map((p) => [p.id, p]));
  const statRows = await fetchAllRows<{ player_id: string; stats: unknown }>((from, to) =>
    admin
      .from("player_week_stats")
      .select("player_id, stats")
      .eq("season", season)
      .eq("week", week)
      .eq("source", "actual")
      .order("player_id")
      .range(from, to),
  );
  const statsById = new Map(statRows.map((r) => [r.player_id, asStats(r.stats)]));
  if (!statsById.size) return { leagues: 0, teams: 0, flagged: 0 };

  let teamsChecked = 0;
  let flagged = 0;
  const upserts: Record<string, unknown>[] = [];

  for (const league of leagues) {
    const [{ data: spots }, { data: games }] = await Promise.all([
      admin
        .from("roster_spots")
        .select("team_id, player_id, player_name, position, is_starter")
        .eq("league_id", league.id)
        .eq("is_starter", true),
      admin
        .from("matchups")
        .select("home_team_id, away_team_id, home_score, away_score, is_final")
        .eq("league_id", league.id)
        .eq("week", week),
    ]);
    if (!spots?.length || !games?.length) continue;

    const reported = new Map<string, number>();
    for (const game of games) {
      if (!game.is_final) continue;
      if (game.home_team_id) reported.set(game.home_team_id, Number(game.home_score) || 0);
      if (game.away_team_id) reported.set(game.away_team_id, Number(game.away_score) || 0);
    }
    if (!reported.size) continue;

    const rules = leagueScoring(league.scoring_type, league.scoring_rules as never).rules;
    const byTeam = new Map<string, ReconPlayer[]>();
    for (const spot of spots) {
      if (!spot.player_id) continue;
      const stats = statsById.get(spot.player_id);
      if (!stats) continue;
      const list = byTeam.get(spot.team_id) ?? [];
      list.push({
        name: meta.get(spot.player_id)?.full_name ?? spot.player_name,
        position: spot.position,
        stats,
      });
      byTeam.set(spot.team_id, list);
    }

    for (const [teamId, starters] of byTeam) {
      const score = reported.get(teamId);
      if (score === undefined) continue;
      const result = reconcileTeam(starters, rules, score);
      teamsChecked += 1;
      if (hasScoringGap(result.diff)) flagged += 1;
      upserts.push({
        user_id: league.user_id,
        league_id: league.id,
        team_id: teamId,
        season,
        week,
        computed: result.computed,
        reported: result.reported,
        diff: result.diff,
        top_player_name: result.topPlayerName,
        top_player_diff: result.topPlayerDiff,
      });
    }
  }

  for (let i = 0; i < upserts.length; i += 300) {
    const { error } = await admin
      .from("score_reconciliation")
      .upsert(upserts.slice(i, i + 300) as never, { onConflict: "league_id,team_id,week" });
    if (error) throw new Error(error.message);
  }

  return { leagues: leagues.length, teams: teamsChecked, flagged };
}

/** Everything that happens once a week's games are in the books. */
export async function runWeeklyResultsJob(
  admin: DB,
  season: number,
  week: number,
): Promise<{
  actuals: number;
  blended: number;
  volatility: number;
  reconciliation: ReconciliationSummary;
}> {
  const actuals = await storeWeekActuals(admin, season, week);
  const [blended, volatility, reconciliation] = await Promise.all([
    recomputeBlendRates(admin, season),
    recomputeVolatility(admin, season),
    runReconciliation(admin, season, week),
  ]);
  return {
    actuals: actuals.rows,
    blended: blended.players,
    volatility: volatility.players,
    reconciliation,
  };
}
