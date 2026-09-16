/**
 * Effective projections = the admin-maintained weekly stat database, scored
 * with each league's own rules, with the signed-in member's personal
 * adjustments layered on top. RLS scopes the override table to the caller,
 * so no user id is needed here. Server-only.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

import { normalizeName } from "./names";
import type { ResolvedProjectionSource } from "./projection-source";
import { fetchAllRows } from "./paginate";
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
  /**
   * Where this player's number came from:
   * "source"  - the league's chosen projection source,
   * "fallback"- no number in that source, so the platform's own figure,
   * "unknown" - the name matches no known NFL player at all.
   */
  basis(
    playerId: string | null | undefined,
    name: string | null | undefined,
  ): "source" | "fallback" | "unknown";
  /** Where these numbers come from, e.g. "Sleeper projections". */
  sourceLabel: string;
  /** True when this league adjusts numbers for opponent strength. */
  sosOn: boolean;
  /** "easy" | "neutral" | "tough" for this week's matchup, or null. */
  matchupRating(
    playerId: string | null | undefined,
    position: string,
  ): "easy" | "neutral" | "tough" | null;
}

const EMPTY: ProjectionSet = {
  count: 0,
  week: (_id, _name, _pos, base) => base,
  season: (_id, _name, _pos, base) => base,
  opponent: () => null,
  hasOverride: () => false,
  basis: () => "source",
  sourceLabel: "App projections",
  sosOn: false,
  matchupRating: () => null,
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
  /** Where the league reads projections from. */
  source?: ResolvedProjectionSource;
  /** Adjust weekly numbers for how tough each opponent is. */
  sos?: boolean | null | undefined;
}

/** Sources that already publish a number for every week — never re-shaped. */
const WEEKLY_SOURCES = new Set(["sleeper", "espn"]);

export async function loadProjections(
  supabase: DB,
  opts: ProjectionOptions = {},
): Promise<ProjectionSet> {
  const season = opts.season ?? 2026;
  const week = Math.min(18, Math.max(1, opts.week ?? 1));
  const scoring = opts.scoring;
  const source = opts.source ?? { setting: "app" as const, sources: ["app"], label: "App projections" };
  const rank = new Map(source.sources.map((s, i) => [s, i]));
  const shapeable = source.sources.some((s) => !WEEKLY_SOURCES.has(s));

  const [overrideRes, weekRows, seasonRows] = await Promise.all([
    supabase
      .from("player_projection_overrides")
      .select("player_id, proj_points_week, proj_points_season, players(full_name)"),
    fetchAllRows<{ player_id: string; opponent: string | null; stats: unknown; source: string }>(
      (from, to) =>
        supabase
          .from("player_week_stats")
          .select("player_id, opponent, stats, source")
          .eq("season", season)
          .eq("week", week)
          .in("source", source.sources)
          .order("player_id")
          .range(from, to),
    ),
    fetchAllRows<{ player_id: string; stats: unknown; source: string }>((from, to) =>
      supabase
        .from("player_season_projections")
        .select("player_id, stats, source")
        .eq("season", season)
        .in("source", source.sources)
        .order("player_id")
        .range(from, to),
    ),
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

  // Highest-priority source wins; the app database only fills the gaps.
  // `shaped` marks a line that already had the matchup applied when it was
  // split out of a season total, so it is never adjusted twice.
  const weekStats = new Map<
    string,
    { stats: StatLine | null; opponent: string | null; rank: number; shaped: boolean; weekly: boolean }
  >();
  for (const row of weekRows) {
    const order = rank.get(row.source) ?? 99;
    const held = weekStats.get(row.player_id);
    if (held && held.rank <= order) continue;
    weekStats.set(row.player_id, {
      stats: asStats(row.stats),
      opponent: row.opponent,
      rank: order,
      shaped: false,
      weekly: WEEKLY_SOURCES.has(row.source),
    });
  }


  // Season totals are stored whole and split here, so a league can change its
  // mind about schedule adjustment without anyone re-uploading anything.
  const seasonTotals = new Map<string, { stats: StatLine | null; rank: number }>();
  for (const row of seasonRows) {
    const order = rank.get(row.source) ?? 99;
    const held = seasonTotals.get(row.player_id);
    if (held && held.rank <= order) continue;
    seasonTotals.set(row.player_id, { stats: asStats(row.stats), rank: order });
  }

  // Opponent strength: only when this league has asked for it, and never for a
  // source that is already week by week.
  const { loadStrengthBook, neutralStrength, loadScheduleByTeam } = await import("./sos.server");
  const wantsSos = !!opts.sos && shapeable;
  const [strength, scheduleByTeam] = await Promise.all([
    wantsSos ? loadStrengthBook(supabase, season) : Promise.resolve(neutralStrength()),
    seasonTotals.size ? loadScheduleByTeam(supabase, season) : Promise.resolve(new Map()),
  ]);
  const sosOn = wantsSos && strength.covered;

  // Betting lines for the week: a team expected to score heavily carries its
  // players a little further. Applied after the schedule split.
  const { loadImpliedBook } = await import("./implied.server");
  const implied = await loadImpliedBook(supabase, season);

  const { data: teamRows } = await supabase.from("players").select("id, position, nfl_team");
  const teamOf = new Map((teamRows ?? []).map((p) => [p.id, p]));

  // What each player has actually been doing this season, mixed into the
  // preseason projection. Rebuilt after every week's results load.
  const { data: blendRows } = await supabase
    .from("player_blend_rates")
    .select("player_id, per_game, blend_weight, games_played")
    .eq("season", season);
  const blendByPlayer = new Map(
    (blendRows ?? []).map((row) => [
      row.player_id,
      {
        perGame: (row.per_game ?? {}) as Record<string, number>,
        weight: Number(row.blend_weight) || 0,
        games: row.games_played ?? 0,
      },
    ]),
  );

  // Where a player has no week row, fall back to their season total split
  // across the weeks their team plays.
  if (seasonTotals.size) {
    const { spreadSeasonTotals } = await import("./sos");
    const { ratesToTotals } = await import("./blend");
    for (const [playerId, entry] of seasonTotals) {
      const held = weekStats.get(playerId);
      if (held && held.rank <= entry.rank) continue;
      const meta = teamOf.get(playerId);
      const games = (scheduleByTeam as Map<string, { week: number; opponent: string | null }[]>).get(
        (meta?.nfl_team ?? "").toUpperCase(),
      );
      const play =
        games && games.length
          ? games
          : Array.from({ length: 17 }, (_, i) => ({ week: i + 1, opponent: null }));
      // Once real games exist, the rest of the season runs on the blended
      // per-game rate rather than the preseason total.
      const blend = blendByPlayer.get(playerId);
      const totals =
        blend && blend.weight > 0
          ? ratesToTotals(blend.perGame, play.length)
          : ((entry.stats ?? {}) as Record<string, number>);
      const split = spreadSeasonTotals(
        totals,
        play,
        meta?.position ?? null,
        sosOn ? (group, opponent) => strength.category(group, opponent) : undefined,
      );
      const hit = split.find((s) => s.week === week);
      weekStats.set(playerId, {
        stats: hit ? asStats(hit.stats) : null,
        opponent: hit?.opponent ?? null,
        rank: entry.rank,
        shaped: true,
        weekly: false,
      });

    }
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

  const { applyMatchup } = await import("./sos");

  /** Stat line for this week, with the matchup applied where it belongs. */
  const lineFor = (playerId: string | null | undefined, position: string) => {
    const line = playerId ? weekStats.get(playerId) : undefined;
    if (!line) return undefined;
    if (!sosOn || line.shaped || line.weekly || !line.stats) return line;
    const shaped = applyMatchup(
      line.stats as Record<string, number>,
      position,
      line.opponent,
      (group, opponent) => strength.category(group, opponent),
    );
    return { ...line, stats: shaped as StatLine };
  };

  /** How much this week's betting line moves a player, 1 when there is none. */
  const impliedOf = (playerId: string | null | undefined) => {
    if (!playerId || !implied.covered) return 1;
    const team = teamOf.get(playerId)?.nfl_team ?? null;
    return implied.multiplier(team, week);
  };

  /** Whole-player multiplier, for numbers that have no stat line behind them. */
  const flat = (playerId: string | null | undefined, position: string) => {
    const line = playerId ? weekStats.get(playerId) : undefined;
    const sos =
      sosOn && line && !line.shaped && !line.weekly
        ? strength.multiplier(position, line.opponent)
        : 1;
    return sos * impliedOf(playerId);
  };

  /** See ProjectionSet.basis. */
  const basisOf = (
    playerId: string | null | undefined,
    name: string | null | undefined,
  ): "source" | "fallback" | "unknown" => {
    if (find(playerId, name)) return "source";
    if (playerId && weekStats.has(playerId)) return "source";
    // For a platform-sourced league the number carried on the roster is the source.
    if (source.setting === "platform") return "source";
    return playerId ? "fallback" : "unknown";
  };

  return {
    count: byId.size,
    basis: basisOf,
    week: (playerId, name, position, base) => {
      if (basisOf(playerId, name) === "unknown") return 0;
      const override = find(playerId, name);
      if (override) {
        const m = flat(playerId, position);
        return round((scoring ? scoring.scale(position, override.week) : override.week) * m);
      }
      const line = lineFor(playerId, position);
      if (scoring && line?.stats) {
        return round(scoring.score(position, line.stats) * impliedOf(playerId));
      }
      if (line && !line.stats) return 0; // bye week or no projected usage
      const m = flat(playerId, position);
      return round((scoring ? scoring.scale(position, base) : base) * m);
    },
    season: (playerId, name, position, base, stats) => {
      const override = find(playerId, name);
      if (override) return scoring ? scoring.scale(position, override.season) : override.season;
      const stored = playerId ? seasonTotals.get(playerId)?.stats : null;
      const line = stored ?? asStats(stats);
      if (scoring && line) return round(scoring.score(position, line));
      return scoring ? scoring.scale(position, base) : base;
    },
    opponent: (playerId) => (playerId ? (weekStats.get(playerId)?.opponent ?? null) : null),
    hasOverride: (playerId, name) => !!find(playerId, name),
    sourceLabel: source.label,
    sosOn,
    matchupRating: (playerId, position) => {
      if (!sosOn || !playerId) return null;
      const line = weekStats.get(playerId);
      if (!line?.opponent || line.weekly) return null;
      return strength.rating(position, line.opponent);
    },
    blendNote: (playerId) => {
      const blend = playerId ? blendByPlayer.get(playerId) : undefined;
      if (!blend || blend.weight <= 0) return null;
      return { games: blend.games, weight: blend.weight };
    },
    impliedMultiplier: (playerId) => impliedOf(playerId),
  };

}
