/**
 * Situation features behind a value trajectory: is a young player's role
 * growing, what draft capital is behind him, is he in a contract year, and how
 * much time has he missed lately.
 *
 * Each feature only ever nudges the one-year outlook — the caps live in
 * situationShift() in age-curve.ts.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

import { normalizeName } from "./names";
import type { SituationFeatures } from "./age-curve";

type DB = SupabaseClient<Database>;

export interface SituationBook {
  /** Features for a player, by canonical id when known and by name otherwise. */
  features: (id: string | null, name: string) => SituationFeatures;
  covered: boolean;
}

const EMPTY: SituationFeatures = {};

/** Workload proxy for a week: catches plus carries, however the row spells them. */
function workload(stats: Record<string, unknown>): number {
  const num = (key: string) => {
    const v = stats[key];
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
  };
  const catches = num("rec") || num("receptions");
  const carries = num("rush_att") || num("carries") || num("rush_yd") / 4.5;
  const targets = num("targets") || num("tgt");
  return Math.max(targets, catches) + carries;
}

export async function loadSituationBook(
  supabase: DB,
  options: { season: number; throughWeek: number },
): Promise<SituationBook> {
  const { season, throughWeek } = options;

  const [{ data: playerRows }, { data: weekRows }, { data: contracts }] = await Promise.all([
    supabase.from("players").select("id, full_name, search_name, position, nfl_team, draft_round, games_missed_2y"),
    supabase
      .from("player_week_stats")
      .select("player_id, week, stats")
      .eq("season", season)
      .eq("source", "sleeper")
      .lte("week", Math.max(1, throughWeek))
      .limit(40000),
    supabase
      .from("player_production_seasons")
      .select("norm_name, contract_end_year")
      .not("contract_end_year", "is", null)
      .limit(10000),
  ]);

  const players = playerRows ?? [];
  const teamOf = new Map<string, string>();
  const byId = new Map<string, (typeof players)[number]>();
  const byName = new Map<string, (typeof players)[number]>();
  for (const p of players) {
    byId.set(p.id, p);
    byName.set(String(p.search_name ?? normalizeName(p.full_name)), p);
    if (p.nfl_team) teamOf.set(p.id, String(p.nfl_team));
  }

  // Workload per player, split into "the whole season so far" and "the last
  // four weeks", plus the same totals per NFL team so we can take a share.
  const recentFrom = Math.max(1, throughWeek - 3);
  const seasonByPlayer = new Map<string, number>();
  const recentByPlayer = new Map<string, number>();
  const seasonByTeam = new Map<string, number>();
  const recentByTeam = new Map<string, number>();

  for (const row of weekRows ?? []) {
    if (!row.player_id) continue;
    const load = workload((row.stats ?? {}) as Record<string, unknown>);
    if (!(load > 0)) continue;
    const team = teamOf.get(row.player_id) ?? "FA";
    seasonByPlayer.set(row.player_id, (seasonByPlayer.get(row.player_id) ?? 0) + load);
    seasonByTeam.set(team, (seasonByTeam.get(team) ?? 0) + load);
    if (Number(row.week) >= recentFrom) {
      recentByPlayer.set(row.player_id, (recentByPlayer.get(row.player_id) ?? 0) + load);
      recentByTeam.set(team, (recentByTeam.get(team) ?? 0) + load);
    }
  }

  const contractYears = new Set(
    (contracts ?? [])
      .filter((c) => Number(c.contract_end_year) === season)
      .map((c) => String(c.norm_name)),
  );

  const roleTrend = (id: string): number | null => {
    const team = teamOf.get(id) ?? "FA";
    const seasonTeam = seasonByTeam.get(team) ?? 0;
    const recentTeam = recentByTeam.get(team) ?? 0;
    if (seasonTeam <= 0 || recentTeam <= 0) return null;
    const seasonShare = (seasonByPlayer.get(id) ?? 0) / seasonTeam;
    const recentShare = (recentByPlayer.get(id) ?? 0) / recentTeam;
    return Math.round((recentShare - seasonShare) * 1000) / 1000;
  };

  return {
    covered: players.length > 0,
    features: (id, name) => {
      const row = (id ? byId.get(id) : undefined) ?? byName.get(normalizeName(name));
      if (!row) return EMPTY;
      return {
        roleTrend: roleTrend(row.id),
        draftRound: row.draft_round ?? null,
        contractYear: contractYears.has(String(row.search_name ?? normalizeName(row.full_name))),
        gamesMissed2y: row.games_missed_2y ?? 0,
      };
    },
  };
}
