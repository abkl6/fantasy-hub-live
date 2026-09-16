/**
 * Keeps every team in a league stocked with a roster so the waiver wire
 * (who is actually available) is accurate. Server-only.
 *
 * Platform imports (Sleeper / ESPN / Yahoo) bring real rosters for all teams.
 * Manual leagues only know the user's own roster, so opponent teams get an
 * estimated roster drafted from the canonical player pool. Those rows are
 * flagged is_auto so real entries always win and can replace them.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

import { slotAccepts } from "./engine";
import { normalizeName } from "./names";
import { loadProjections } from "./projections.server";
import { resolveProjectionSource } from "./projection-source";
import { leagueScoring } from "./scoring";


type DB = SupabaseClient<Database>;

const BENCH_SPOTS = 6;
const BENCH_POSITIONS = ["QB", "RB", "WR", "TE"];
const DEFAULT_SLOTS = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF"];

function asSlots(value: unknown): string[] {
  if (Array.isArray(value) && value.length) return value.map(String).filter((s) => s.toUpperCase() !== "BN");
  return DEFAULT_SLOTS;
}

const key = (name: string) => normalizeName(name);

interface PoolPlayer {
  id: string;
  full_name: string;
  position: string;
  nfl_team: string | null;
  proj_points_week: number;
}

/**
 * Ensures each team has a roster and that no player is held twice in the
 * league. Only auto-filled rows are ever changed.
 */
export async function syncLeagueRosters(supabase: DB, userId: string, leagueId: string) {
  const { data: league } = await supabase
    .from("leagues")
    .select("id, roster_slots")
    .eq("id", leagueId)
    .maybeSingle();
  if (!league) return { filled: 0, removed: 0 };

  const slots = asSlots(league.roster_slots);
  const targetSize = slots.length + BENCH_SPOTS;

  const [{ data: teamRows }, { data: spotRows }, { data: playerRows }] = await Promise.all([
    supabase.from("teams").select("id").eq("league_id", leagueId).order("created_at"),
    supabase
      .from("roster_spots")
      .select("id, team_id, player_name, is_auto")
      .eq("league_id", leagueId),
    supabase
      .from("players")
      .select("id, full_name, position, nfl_team, proj_points_week")
      .order("proj_points_week", { ascending: false }),
  ]);

  const teams = teamRows ?? [];
  let spots = spotRows ?? [];
  const pool: PoolPlayer[] = (playerRows ?? []).map((p) => ({
    id: p.id,
    full_name: p.full_name,
    position: p.position.toUpperCase(),
    nfl_team: p.nfl_team,
    proj_points_week: Number(p.proj_points_week),
  }));
  if (!teams.length || !pool.length) return { filled: 0, removed: 0 };

  // --- drop estimated duplicates of players held for real elsewhere --------
  const realNames = new Set(spots.filter((s) => !s.is_auto).map((s) => key(s.player_name)));
  const seenAuto = new Set<string>();
  const staleIds: string[] = [];
  for (const s of spots) {
    if (!s.is_auto) continue;
    const k = key(s.player_name);
    if (realNames.has(k) || seenAuto.has(k)) staleIds.push(s.id);
    else seenAuto.add(k);
  }
  if (staleIds.length) {
    await supabase.from("roster_spots").delete().in("id", staleIds);
    spots = spots.filter((s) => !staleIds.includes(s.id));
  }

  // --- fill teams that are empty or estimated up to a full roster ---------
  const taken = new Set(spots.map((s) => key(s.player_name)));
  const available = pool.filter((p) => !taken.has(key(p.full_name)));

  const byTeam = new Map<string, typeof spots>();
  for (const s of spots) byTeam.set(s.team_id, [...(byTeam.get(s.team_id) ?? []), s]);

  const fillable = teams.filter((t) => {
    const held = byTeam.get(t.id) ?? [];
    return held.length === 0 || held.every((s) => s.is_auto);
  });
  if (!fillable.length) return { filled: 0, removed: staleIds.length };

  const inserts: Record<string, unknown>[] = [];
  const needed = new Map(fillable.map((t) => [t.id, targetSize - (byTeam.get(t.id)?.length ?? 0)]));

  for (let round = 0; round < targetSize; round++) {
    const slot = round < slots.length ? slots[round]! : "BN";
    const order = round % 2 === 0 ? fillable : [...fillable].reverse();
    for (const team of order) {
      if ((needed.get(team.id) ?? 0) <= 0) continue;
      const idx = available.findIndex((p) =>
        slot === "BN" ? BENCH_POSITIONS.includes(p.position) : slotAccepts(slot, p.position),
      );
      if (idx < 0) continue;
      const [pick] = available.splice(idx, 1);
      if (!pick) continue;
      needed.set(team.id, (needed.get(team.id) ?? 0) - 1);
      inserts.push({
        team_id: team.id,
        league_id: leagueId,
        user_id: userId,
        player_id: pick.id,
        player_name: pick.full_name,
        position: pick.position,
        nfl_team: pick.nfl_team,
        slot,
        is_starter: round < slots.length,
        proj_points: pick.proj_points_week,
        is_auto: true,
      });
    }
  }

  if (inserts.length) {
    const { error } = await supabase.from("roster_spots").insert(inserts as never);
    if (error) throw new Error(error.message);
  }

  return { filled: inserts.length, removed: staleIds.length };
}

export interface WaiverPlayer {
  id: string;
  name: string;
  position: string;
  nflTeam: string | null;
  proj: number;
  byeWeek: number | null;
  status: string;
}

/** Players not held by any team in this league, limited to positions it uses. */
export async function leagueWaiverWire(
  supabase: DB,
  leagueId: string,
  opts: { search?: string; position?: string; limit?: number } = {},
): Promise<WaiverPlayer[]> {
  const { data: league } = await supabase
    .from("leagues")
    .select("roster_slots, scoring_type, scoring_rules, current_week, platform, projection_source, user_id, sos_adjust")
    .eq("id", leagueId)
    .maybeSingle();
  const slots = asSlots(league?.roster_slots);
  const scoring = leagueScoring(
    league?.scoring_type,
    (league?.scoring_rules ?? {}) as Record<string, number>,
  );

  const [{ data: spots }, { data: players }] = await Promise.all([
    supabase.from("roster_spots").select("player_name").eq("league_id", leagueId),
    supabase
      .from("players")
      .select("id, full_name, position, nfl_team, proj_points_week, bye_week, status")
      .order("proj_points_week", { ascending: false }),
  ]);

  const proj = await loadProjections(supabase, {
    scoring,
    week: league?.current_week ?? 1,
    source: resolveProjectionSource(league ?? {}),
    sos: (league as { sos_adjust?: boolean } | null)?.sos_adjust,
  });

  const taken = new Set((spots ?? []).map((s) => key(s.player_name)));
  const usable = (position: string) =>
    slots.some((slot) => slotAccepts(slot, position)) || BENCH_POSITIONS.includes(position);

  const search = opts.search?.trim().toLowerCase();
  const wanted = opts.position?.toUpperCase();

  return (players ?? [])
    .filter((p) => !taken.has(key(p.full_name)))
    .filter((p) => usable(p.position.toUpperCase()))
    .filter((p) => (wanted && wanted !== "ALL" ? p.position.toUpperCase() === wanted : true))
    .filter((p) => (search ? p.full_name.toLowerCase().includes(search) : true))
    .slice(0, opts.limit ?? 40)
    .map((p) => ({
      id: p.id,
      name: p.full_name,
      position: p.position.toUpperCase(),
      nflTeam: p.nfl_team,
      proj: proj.week(p.id, p.full_name, p.position.toUpperCase(), Number(p.proj_points_week)),
      byeWeek: p.bye_week,
      status: p.status,
    }));
}
