/**
 * Strength of schedule, server side.
 *
 * For the scoring positions (QB, RB, WR, TE, K) strength is the fantasy points
 * a team gives up per game to that position. Last season's actual numbers are
 * the baseline (uploaded by an admin) and this season's own results are mixed
 * in as the weeks go by — this season counts fully from eight games on.
 *
 * Team defence and individual defenders have no "points allowed" of their own,
 * so they keep being derived from how strong the opponent's offence is.
 *
 * Everything lands in `team_position_strength`, where an admin can override any
 * number by hand (`source = 'user'` is never overwritten).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

import { fetchAllRows } from "./paginate";
import { BASELINE_RULES, scoreStats } from "./scoring";
import {
  POSITION_GROUPS,
  blendMeasure,
  clampMultiplier,
  groupOf,
  multipliersFromMeasure,
  ratingOf,
  seasonRating,
  type CategoryMultiplier,
  type MatchupRating,
  type PositionGroup,
  type WeekSlot,
} from "./sos";

type DB = SupabaseClient<Database>;

export interface StrengthBook {
  /** How favourable facing `opponent` is for this position. 1 = neutral. */
  multiplier(position: string | null | undefined, opponent: string | null | undefined): number;
  /** Same, but for one stat category's governing position group. */
  category: CategoryMultiplier;
  rating(position: string | null | undefined, opponent: string | null | undefined): MatchupRating;
  /** Average multiplier across a whole season of opponents. */
  season(position: string | null | undefined, weeks: WeekSlot[]): number;
  /** True when at least some teams have a rating. */
  covered: boolean;
}

const NEUTRAL: StrengthBook = {
  multiplier: () => 1,
  category: () => 1,
  rating: () => "neutral",
  season: () => 1,
  covered: false,
};

export function neutralStrength(): StrengthBook {
  return NEUTRAL;
}

function bookFrom(map: Map<string, number>): StrengthBook {
  if (!map.size) return NEUTRAL;
  const byGroup = (group: PositionGroup | null, opponent: string | null | undefined) => {
    const team = (opponent ?? "").toUpperCase();
    if (!group || !team || team === "BYE") return 1;
    return map.get(`${group}|${team}`) ?? 1;
  };
  const lookup = (position: string | null | undefined, opponent: string | null | undefined) =>
    byGroup(groupOf(position), opponent);
  return {
    multiplier: lookup,
    category: (group, opponent) => byGroup(group, opponent),
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

/** Points allowed per game, by opponent team and position group. */
interface Allowed {
  points: Map<string, number>;
  weeks: Map<string, Set<number>>;
}

function addAllowed(acc: Allowed, team: string, group: PositionGroup, week: number, points: number) {
  const key = `${group}|${team}`;
  acc.points.set(key, (acc.points.get(key) ?? 0) + points);
  const weeks = acc.weeks.get(team) ?? new Set<number>();
  weeks.add(week);
  acc.weeks.set(team, weeks);
}

/**
 * This season's actual points allowed per game, from finished games.
 */
async function currentAllowed(supabase: DB, season: number): Promise<Allowed> {
  const acc: Allowed = { points: new Map(), weeks: new Map() };
  const rows = await fetchAllRows<{
    player_id: string;
    week: number;
    opponent: string | null;
    stats: unknown;
    game_state: string;
  }>((from, to) =>
    supabase
      .from("live_player_stats")
      .select("player_id, week, opponent, stats, game_state")
      .eq("season", season)
      .order("player_id")
      .range(from, to),
  );
  if (!rows.length) return acc;

  const { data: players } = await supabase.from("players").select("id, position");
  const meta = new Map((players ?? []).map((p) => [p.id, p.position]));

  for (const row of rows) {
    if (row.game_state !== "post") continue;
    const team = (row.opponent ?? "").toUpperCase().replace(/^@/, "");
    if (!team || team === "BYE") continue;
    const group = groupOf(meta.get(row.player_id));
    if (!group || group === "DST" || group === "IDP") continue;
    const stats = (row.stats ?? {}) as Record<string, number>;
    const points = scoreStats(stats, BASELINE_RULES, meta.get(row.player_id) ?? "");
    if (!Number.isFinite(points)) continue;
    addAllowed(acc, team, group, row.week, points);
  }
  return acc;
}

/** Last season's baseline, as uploaded by an admin. */
async function priorMeasures(supabase: DB, season: number) {
  const { data } = await supabase
    .from("team_position_strength")
    .select("nfl_team, position_group, prior_measure")
    .eq("season", season);
  const out = new Map<string, number>();
  for (const row of data ?? []) {
    const value = Number((row as { prior_measure: number | null }).prior_measure);
    if (Number.isFinite(value) && value > 0) {
      out.set(`${row.position_group.toUpperCase()}|${row.nfl_team.toUpperCase()}`, value);
    }
  }
  return out;
}

/**
 * Recomputes every team's strength and saves it. Hand-set rows (`source =
 * 'user'`) are left alone.
 */
export async function refreshTeamStrength(
  supabase: DB,
  season: number,
  sources: string[] = ["app"],
): Promise<{ rows: number }> {
  // ---- scoring positions: fantasy points allowed per game ------------------
  const [allowed, prior] = await Promise.all([
    currentAllowed(supabase, season),
    priorMeasures(supabase, season),
  ]);

  const scoringGroups: PositionGroup[] = ["QB", "RB", "WR", "TE", "K"];
  const measures = new Map<PositionGroup, Map<string, number>>();
  const gamesByTeam = new Map<string, number>();
  const measureRows = new Map<string, { measure: number; games: number }>();

  const teams = new Set<string>([
    ...[...allowed.weeks.keys()],
    ...[...prior.keys()].map((k) => k.split("|")[1]!),
  ]);
  for (const team of teams) gamesByTeam.set(team, allowed.weeks.get(team)?.size ?? 0);

  for (const group of scoringGroups) {
    const map = new Map<string, number>();
    for (const team of teams) {
      const games = gamesByTeam.get(team) ?? 0;
      const total = allowed.points.get(`${group}|${team}`);
      const current = games > 0 && total !== undefined ? total / games : null;
      const blended = blendMeasure(prior.get(`${group}|${team}`) ?? null, current, games);
      if (blended === null) continue;
      map.set(team, blended);
      measureRows.set(`${group}|${team}`, { measure: blended, games });
    }
    measures.set(group, map);
  }

  // ---- defence and individual defenders: opponent offensive production -----
  const projRows = await fetchAllRows<{ player_id: string; src_points: number }>((from, to) =>
    supabase
      .from("player_week_stats")
      .select("player_id, src_points")
      .eq("season", season)
      .in("source", sources)
      .order("player_id")
      .range(from, to),
  );
  const { data: players } = await supabase.from("players").select("id, position, nfl_team");
  const meta = new Map((players ?? []).map((p) => [p.id, p]));

  const offense = new Map<string, number>();
  for (const row of projRows) {
    const p = meta.get(row.player_id);
    const team = (p?.nfl_team ?? "").toUpperCase();
    if (!team) continue;
    const group = groupOf(p?.position);
    if (group === "QB" || group === "RB" || group === "WR" || group === "TE") {
      offense.set(team, (offense.get(team) ?? 0) + (Number(row.src_points) || 0));
    }
  }
  const invert = (m: Map<string, number>) => {
    const out = new Map<string, number>();
    for (const [team, value] of m) if (value > 0) out.set(team, 1 / value);
    return out;
  };

  // ---- multipliers ---------------------------------------------------------
  const upserts: Record<string, unknown>[] = [];
  const push = (group: PositionGroup, map: Map<string, number>, weight: number) => {
    for (const [team, value] of multipliersFromMeasure(map, weight)) {
      const measured = measureRows.get(`${group}|${team}`);
      upserts.push({
        season,
        nfl_team: team,
        position_group: group,
        multiplier: clampMultiplier(value),
        measure: measured?.measure ?? null,
        games: measured?.games ?? 0,
        source: "computed",
      });
    }
  };

  for (const group of scoringGroups) push(group, measures.get(group) ?? new Map(), 0.6);
  push("DST", invert(offense), 0.5);
  push("IDP", offense, 0.3);

  if (!upserts.length) return { rows: 0 };

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

/**
 * Admin seed: last season's fantasy points allowed per game, per team and
 * position group. Rows are stored against the *current* season as the baseline
 * this season's results are blended into.
 */
export async function savePriorStrength(
  supabase: DB,
  season: number,
  rows: { team: string; group: PositionGroup; perGame: number; games?: number }[],
): Promise<{ rows: number }> {
  // Keep whatever multiplier and source a row already has; this only seeds the
  // baseline measure.
  const { data: existing } = await supabase
    .from("team_position_strength")
    .select("nfl_team, position_group, multiplier, source")
    .eq("season", season);
  const held = new Map(
    (existing ?? []).map((r) => [
      `${r.position_group.toUpperCase()}|${r.nfl_team.toUpperCase()}`,
      r,
    ]),
  );

  const payload = rows
    .filter((r) => r.team && r.perGame > 0)
    .map((r) => {
      const team = r.team.toUpperCase();
      const prev = held.get(`${r.group}|${team}`);
      return {
        season,
        nfl_team: team,
        position_group: r.group,
        prior_measure: Math.round(r.perGame * 1000) / 1000,
        prior_games: r.games ?? 17,
        multiplier: prev ? Number(prev.multiplier) : 1,
        source: prev?.source ?? "prior",
      };
    });
  if (!payload.length) return { rows: 0 };

  for (let i = 0; i < payload.length; i += 300) {
    const { error } = await supabase
      .from("team_position_strength")
      .upsert(payload.slice(i, i + 300) as never, {
        onConflict: "season,nfl_team,position_group",
        ignoreDuplicates: false,
      });
    if (error) throw new Error(error.message);
  }
  return { rows: payload.length };
}

export { POSITION_GROUPS };
