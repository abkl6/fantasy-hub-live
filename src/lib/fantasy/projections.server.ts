/**
 * Effective projections = the admin-maintained weekly stat database, scored
 * with each league's own rules, with the signed-in member's personal
 * adjustments layered on top. RLS scopes the override table to the caller,
 * so no user id is needed here. Server-only.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

import { normalizeName } from "./names";
import type { LeagueScoring, StatLine } from "./scoring";

type DB = SupabaseClient<Database>;

interface OverrideValue {
  week: number;
  season: number;
}

export interface ProjectionSet {
  /** How many players this member has adjusted. */
  count: number;
  /** Points for the current week in this league's scoring. */
  week(
    playerId: string | null | undefined,
    name: string | null | undefined,
    position: string,
    base: number,
  ): number;
  /** Points for the full season in this league's scoring. */
  season(
    playerId: string | null | undefined,
    name: string | null | undefined,
    position: string,
    base: number,
    stats?: unknown,
  ): number;
  /** This week's opponent from the projection database, when known. */
  opponent(playerId: string | null | undefined, name: string | null | undefined): string | null;
  hasOverride(playerId: string | null | undefined, name: string | null | undefined): boolean;
}

const EMPTY: ProjectionSet = {
  count: 0,
  week: (_id, _name, _pos, base) => base,
  season: (_id, _name, _pos, base) => base,
  opponent: () => null,
  hasOverride: () => false,
};

export function emptyProjections(): ProjectionSet {
  return EMPTY;
}

function asStats(value: unknown): StatLine | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: StatLine = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const n = Number(v);
    if (Number.isFinite(n) && n !== 0) out[k] = n;
  }
  return Object.keys(out).length ? out : null;
}

export interface ProjectionOptions {
  /** League scoring rules. Without it the stored baseline numbers are used. */
  scoring?: LeagueScoring;
  /** Week whose stat line drives weekly projections. */
  week?: number;
  season?: number;
}

export async function loadProjections(
  supabase: DB,
  opts: ProjectionOptions = {},
): Promise<ProjectionSet> {
  const season = opts.season ?? 2026;
  const week = Math.min(18, Math.max(1, opts.week ?? 1));
  const scoring = opts.scoring;

  const [overrideRes, weekRes] = await Promise.all([
    supabase
      .from("player_projection_overrides")
      .select("player_id, proj_points_week, proj_points_season, players(full_name)"),
    supabase
      .from("player_week_stats")
      .select("player_id, opponent, stats, src_points")
      .eq("season", season)
      .eq("week", week),
  ]);

  const byId = new Map<string, OverrideValue>();
  const byName = new Map<string, OverrideValue>();
  for (const row of overrideRes.data ?? []) {
    const value: OverrideValue = {
      week: Number(row.proj_points_week),
      season: Number(row.proj_points_season),
    };
    byId.set(row.player_id, value);
    const fullName = (row as { players?: { full_name: string } | null }).players?.full_name;
    if (fullName) byName.set(normalizeName(fullName), value);
  }

  const weekStats = new Map<string, { stats: StatLine | null; opponent: string | null }>();
  for (const row of weekRes.data ?? []) {
    weekStats.set(row.player_id, {
      stats: asStats(row.stats),
      opponent: row.opponent,
    });
  }

  const find = (playerId?: string | null, name?: string | null) => {
    if (playerId) {
      const hit = byId.get(playerId);
      if (hit) return hit;
    }
    if (name) return byName.get(normalizeName(name));
    return undefined;
  };

  const round = (n: number) => Math.round(n * 10) / 10;

  return {
    count: byId.size,
    week: (playerId, name, position, base) => {
      const override = find(playerId, name);
      if (override) return scoring ? scoring.scale(position, override.week) : override.week;
      const line = playerId ? weekStats.get(playerId) : undefined;
      if (scoring && line?.stats) return round(scoring.score(position, line.stats));
      if (line && !line.stats) return 0; // bye week or no projected usage
      return scoring ? scoring.scale(position, base) : base;
    },
    season: (playerId, name, position, base, stats) => {
      const override = find(playerId, name);
      if (override) return scoring ? scoring.scale(position, override.season) : override.season;
      const line = asStats(stats);
      if (scoring && line) return round(scoring.score(position, line));
      return scoring ? scoring.scale(position, base) : base;
    },
    opponent: (playerId) => (playerId ? (weekStats.get(playerId)?.opponent ?? null) : null),
    hasOverride: (playerId, name) => !!find(playerId, name),
  };
}
