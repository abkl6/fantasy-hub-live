/**
 * Effective projections = the admin-maintained baseline in `players`, with the
 * signed-in member's personal adjustments layered on top. RLS scopes the
 * override table to the caller, so no user id is needed here. Server-only.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

import { normalizeName } from "./names";

type DB = SupabaseClient<Database>;

interface OverrideValue {
  week: number;
  season: number;
}

export interface ProjectionSet {
  /** How many players this member has adjusted. */
  count: number;
  week(playerId: string | null | undefined, name: string | null | undefined, base: number): number;
  season(playerId: string | null | undefined, name: string | null | undefined, base: number): number;
  hasOverride(playerId: string | null | undefined, name: string | null | undefined): boolean;
}

const EMPTY: ProjectionSet = {
  count: 0,
  week: (_id, _name, base) => base,
  season: (_id, _name, base) => base,
  hasOverride: () => false,
};

export function emptyProjections(): ProjectionSet {
  return EMPTY;
}

export async function loadProjections(supabase: DB): Promise<ProjectionSet> {
  const { data, error } = await supabase
    .from("player_projection_overrides")
    .select("player_id, proj_points_week, proj_points_season, players(full_name)");
  if (error || !data || !data.length) return EMPTY;

  const byId = new Map<string, OverrideValue>();
  const byName = new Map<string, OverrideValue>();
  for (const row of data) {
    const value: OverrideValue = {
      week: Number(row.proj_points_week),
      season: Number(row.proj_points_season),
    };
    byId.set(row.player_id, value);
    const fullName = (row as { players?: { full_name: string } | null }).players?.full_name;
    if (fullName) byName.set(normalizeName(fullName), value);
  }

  const find = (playerId?: string | null, name?: string | null) => {
    if (playerId) {
      const hit = byId.get(playerId);
      if (hit) return hit;
    }
    if (name) return byName.get(normalizeName(name));
    return undefined;
  };

  return {
    count: byId.size,
    week: (playerId, name, base) => find(playerId, name)?.week ?? base,
    season: (playerId, name, base) => find(playerId, name)?.season ?? base,
    hasOverride: (playerId, name) => !!find(playerId, name),
  };
}
