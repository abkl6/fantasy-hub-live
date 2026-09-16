/**
 * Strength of schedule, server side.
 *
 * Multipliers are derived from the projection database itself: how many points
 * a team's defence is projected to score (a proxy for how hard it is to play
 * against) and how strong a team's offence is (a proxy for how good it is to
 * face as a defence or an individual defender). Everything is stored in
 * `team_position_strength` so an admin can override any number by hand.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

import { fetchAllRows } from "./paginate";
import {
  POSITION_GROUPS,
  clampMultiplier,
  groupOf,
  multipliersFromMeasure,
  ratingOf,
  seasonRating,
  type MatchupRating,
  type PositionGroup,
  type WeekSlot,
} from "./sos";

type DB = SupabaseClient<Database>;

export interface StrengthBook {
  /** How favourable facing `opponent` is for this position. 1 = neutral. */
  multiplier(position: string | null | undefined, opponent: string | null | undefined): number;
  rating(position: string | null | undefined, opponent: string | null | undefined): MatchupRating;
  /** Average multiplier across a whole season of opponents. */
  season(position: string | null | undefined, weeks: WeekSlot[]): number;
  /** True when at least some teams have a rating. */
  covered: boolean;
}

const NEUTRAL: StrengthBook = {
  multiplier: () => 1,
  rating: () => "neutral",
  season: () => 1,
  covered: false,
};

export function neutralStrength(): StrengthBook {
  return NEUTRAL;
}

function bookFrom(map: Map<string, number>): StrengthBook {
  if (!map.size) return NEUTRAL;
  const lookup = (position: string | null | undefined, opponent: string | null | undefined) => {
    const group = groupOf(position);
    const team = (opponent ?? "").toUpperCase();
    if (!group || !team || team === "BYE") return 1;
    return map.get(`${group}|${team}`) ?? 1;
  };
  return {
    multiplier: lookup,
    rating: (position, opponent) => ratingOf(lookup(position, opponent)),
    season: (position, weeks) => seasonRating(weeks, (opp) => lookup(position, opp)),
    covered: true,
  };
}

export async function loadStrengthBook(supabase: DB, season: number): Promise<StrengthBook> {
  const { data } = await supabase
    .from("team_position_strength")
    .select("nfl_team, position_group, multiplier")
    .eq("season", season);
  const map = new Map<string, number>();
  for (const row of data ?? []) {
    map.set(
      `${row.position_group.toUpperCase()}|${row.nfl_team.toUpperCase()}`,
      clampMultiplier(Number(row.multiplier)),
    );
  }
  return bookFrom(map);
}

/** Every team's weeks and opponents for a season. */
export async function loadScheduleByTeam(
  supabase: DB,
  season: number,
): Promise<Map<string, WeekSlot[]>> {
  const { data } = await supabase
    .from("nfl_schedule")
    .select("week, nfl_team, opponent")
    .eq("season", season);
  const out = new Map<string, WeekSlot[]>();
  for (const row of data ?? []) {
    if (!row.opponent || row.opponent.toUpperCase() === "BYE") continue;
    const key = row.nfl_team.toUpperCase();
    const list = out.get(key) ?? [];
    list.push({ week: row.week, opponent: row.opponent.toUpperCase() });
    out.set(key, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.week - b.week);
  return out;
}

/**
 * Recomputes every team's strength from the current projection database and
 * saves it. Hand-set rows (source = 'user') are left alone.
 */
export async function refreshTeamStrength(
  supabase: DB,
  season: number,
  sources: string[] = ["app"],
): Promise<{ rows: number }> {
  const rows = await fetchAllRows<{ player_id: string; src_points: number }>((from, to) =>
    supabase
      .from("player_week_stats")
      .select("player_id, src_points")
      .eq("season", season)
      .in("source", sources)
      .order("player_id")
      .range(from, to),
  );
  const { data: players } = await supabase
    .from("players")
    .select("id, position, nfl_team");
  const meta = new Map((players ?? []).map((p) => [p.id, p]));

  const offense = new Map<string, number>();
  const defense = new Map<string, number>();
  for (const row of rows) {
    const p = meta.get(row.player_id);
    const team = (p?.nfl_team ?? "").toUpperCase();
    if (!team) continue;
    const group = groupOf(p?.position);
    const points = Number(row.src_points) || 0;
    if (group === "QB" || group === "RB" || group === "WR" || group === "TE") {
      offense.set(team, (offense.get(team) ?? 0) + points);
    } else if (group === "DST") {
      defense.set(team, (defense.get(team) ?? 0) + points);
    }
  }

  // Facing a defence that scores a lot is hard; facing a weak offence is easy.
  const invert = (m: Map<string, number>) => {
    const out = new Map<string, number>();
    for (const [team, value] of m) if (value > 0) out.set(team, 1 / value);
    return out;
  };

  const vsOffense = multipliersFromMeasure(invert(defense), 0.6);
  const vsDefense = multipliersFromMeasure(invert(offense), 0.5);
  const vsIdp = multipliersFromMeasure(offense, 0.3);

  const upserts: Record<string, unknown>[] = [];
  const push = (group: PositionGroup, map: Map<string, number>, weight = 1) => {
    for (const [team, value] of map) {
      upserts.push({
        season,
        nfl_team: team,
        position_group: group,
        multiplier: clampMultiplier(1 + (value - 1) * weight),
        source: "computed",
      });
    }
  };
  push("QB", vsOffense);
  push("RB", vsOffense);
  push("WR", vsOffense);
  push("TE", vsOffense);
  push("K", vsOffense, 0.5);
  push("DST", vsDefense);
  push("IDP", vsIdp);

  if (!upserts.length) return { rows: 0 };

  // Never overwrite a number an admin set by hand.
  const { data: manual } = await supabase
    .from("team_position_strength")
    .select("nfl_team, position_group")
    .eq("season", season)
    .eq("source", "user");
  const held = new Set((manual ?? []).map((m) => `${m.position_group}|${m.nfl_team}`));
  const toWrite = upserts.filter((u) => !held.has(`${u["position_group"]}|${u["nfl_team"]}`));

  for (let i = 0; i < toWrite.length; i += 300) {
    const { error } = await supabase
      .from("team_position_strength")
      .upsert(toWrite.slice(i, i + 300) as never, { onConflict: "season,nfl_team,position_group" });
    if (error) throw new Error(error.message);
  }
  return { rows: toWrite.length };
}

export { POSITION_GROUPS };
