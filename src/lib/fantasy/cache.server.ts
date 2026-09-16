/**
 * Server-side result cache. Heavy page payloads (league analysis, Game Day,
 * the playoff picture, This week) are stored in analysis_cache and served back
 * while the inputs they were built from are unchanged and the entry is fresh.
 *
 * Results are cached per component — one team's lineup and scoring spread, the
 * league schedule, the simulation, the This week list — each with its own
 * inputs hash, so a change only rebuilds the parts that depend on it.
 * Server-only.
 */

import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { gameWindow } from "./gamewindow";

type DB = SupabaseClient<Database>;

export type CacheKind =
  | "analysis"
  | "gameday"
  | "gameday-summaries"
  | "playoff"
  | "this-week"
  | "impact"
  | "lineup"
  | "distribution"
  | "schedule"
  | "sim";

/** Placeholder league id used for cross-league rows (This week). */
export const GLOBAL_LEAGUE = null;

const FIFTEEN_MIN = 15 * 60_000;
const FIVE_MIN = 5 * 60_000;

/** 15 minutes normally, 5 while games are being played. */
export function defaultTtl(now: Date = new Date()): number {
  return gameWindow(now).live ? FIVE_MIN : FIFTEEN_MIN;
}

export function hashParts(parts: unknown[]): string {
  return createHash("sha1").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
}

/** Stable stringify so key order in jsonb columns never changes the hash. */
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .map((k) => [k, stable((value as Record<string, unknown>)[k])]);
  }
  return value;
}

/**
 * Everything that can change a league payload: rosters, projection choice,
 * scoring, slots, week, and the newest actuals we have loaded.
 */
export async function leagueInputsHash(supabase: DB, leagueId: string): Promise<string> {
  const { data: league } = await supabase
    .from("leagues")
    .select(
      "projection_source, scoring_rules, roster_slots, sos_adjust, class_override, current_week, season, contest_format, format, variant, eligible_positions, last_synced_at",
    )
    .eq("id", leagueId)
    .maybeSingle();

  const [{ data: spots, count: spotCount }, { data: actuals }] = await Promise.all([
    supabase
      .from("roster_spots")
      .select("created_at", { count: "exact" })
      .eq("league_id", leagueId)
      .order("created_at", { ascending: false })
      .limit(1),
    supabase
      .from("player_week_stats")
      .select("week")
      .eq("season", league?.season ?? new Date().getFullYear())
      .order("week", { ascending: false })
      .limit(1),
  ]);

  return hashParts([
    leagueId,
    league?.projection_source ?? null,
    stable(league?.scoring_rules ?? null),
    stable(league?.roster_slots ?? null),
    stable(league?.eligible_positions ?? null),
    league?.sos_adjust ?? null,
    league?.class_override ?? null,
    league?.current_week ?? null,
    league?.contest_format ?? null,
    league?.format ?? null,
    league?.variant ?? null,
    league?.last_synced_at ?? null,
    spots?.[0]?.created_at ?? null,
    spotCount ?? 0,
    actuals?.[0]?.week ?? null,
  ]);
}

/** One hash covering every league the member owns — used by This week. */
export async function allLeaguesInputsHash(supabase: DB): Promise<string> {
  const { data } = await supabase.from("leagues").select("id").order("id");
  const hashes = [];
  for (const row of data ?? []) hashes.push(await leagueInputsHash(supabase, row.id));
  return hashParts(hashes);
}

// ------------------------------------------------------------------ components

export interface ComponentHashes {
  /** League settings only: scoring, slots, week, projection source. */
  league: string;
  /** Per team: that team's roster plus the league settings. */
  teams: Record<string, string>;
  /** Fixtures. */
  schedule: string;
  /** Everything the season simulation reads. */
  sim: string;
}

/**
 * One hash per moving part, so a single roster move only invalidates that
 * team's spread and the league simulation — not every other team's work.
 */
export async function componentHashes(supabase: DB, leagueId: string): Promise<ComponentHashes> {
  const { data: league } = await supabase
    .from("leagues")
    .select(
      "projection_source, scoring_rules, scoring_type, roster_slots, sos_adjust, class_override, current_week, season, contest_format, format, variant, eligible_positions, playoff_teams, regular_season_weeks, playoff_byes, all_play_weeks",
    )
    .eq("id", leagueId)
    .maybeSingle();

  const [{ data: spots }, { data: matchups }, { data: actuals }] = await Promise.all([
    supabase
      .from("roster_spots")
      .select("team_id, player_id, player_name, position, is_starter")
      .eq("league_id", leagueId),
    supabase
      .from("matchups")
      .select("week, home_team_id, away_team_id, is_final")
      .eq("league_id", leagueId),
    supabase
      .from("player_week_stats")
      .select("week")
      .eq("season", league?.season ?? new Date().getFullYear())
      .order("week", { ascending: false })
      .limit(1),
  ]);

  const leagueHash = hashParts([
    leagueId,
    league?.projection_source ?? null,
    league?.scoring_type ?? null,
    stable(league?.scoring_rules ?? null),
    stable(league?.roster_slots ?? null),
    stable(league?.eligible_positions ?? null),
    league?.sos_adjust ?? null,
    league?.class_override ?? null,
    league?.current_week ?? null,
    league?.contest_format ?? null,
    league?.format ?? null,
    league?.variant ?? null,
    actuals?.[0]?.week ?? null,
  ]);

  const byTeam = new Map<string, string[]>();
  for (const spot of spots ?? []) {
    const list = byTeam.get(spot.team_id) ?? [];
    list.push(
      [spot.player_id ?? "", spot.player_name ?? "", spot.position ?? "", spot.is_starter ? 1 : 0].join("|"),
    );
    byTeam.set(spot.team_id, list);
  }

  const teams: Record<string, string> = {};
  for (const [teamId, rows] of byTeam) {
    teams[teamId] = hashParts([leagueHash, teamId, rows.sort()]);
  }

  const schedule = hashParts([
    leagueHash,
    (matchups ?? [])
      .map((m) => [m.week, m.home_team_id ?? "", m.away_team_id ?? "", m.is_final ? 1 : 0].join("|"))
      .sort(),
  ]);

  const sim = hashParts([
    schedule,
    Object.keys(teams)
      .sort()
      .map((id) => teams[id]),
    league?.playoff_teams ?? null,
    league?.regular_season_weeks ?? null,
    league?.playoff_byes ?? null,
    stable(league?.all_play_weeks ?? null),
  ]);

  return { league: leagueHash, teams, schedule, sim };
}

export interface CacheOptions {
  userId: string;
  leagueId?: string | null;
  kind: CacheKind;
  /** Extra key material, e.g. a waiver candidate name. */
  suffix?: string;
  ttlMs?: number;
  /** Skip the read and always recompute (still writes the result). */
  force?: boolean;
}

export interface CachedResult<T> {
  payload: T;
  computedAt: string;
  /** True when the result was built during this call rather than read back. */
  fresh: boolean;
  computeMs: number | null;
}

/** Reads a stored component without computing anything. */
export async function readCached<T>(
  supabase: DB,
  opts: Pick<CacheOptions, "userId" | "leagueId" | "kind" | "suffix">,
  inputsHash: string,
): Promise<CachedResult<T> | null> {
  const key = opts.suffix ? `${inputsHash}:${opts.suffix}` : inputsHash;
  const { data } = await supabase
    .from("analysis_cache")
    .select("payload, expires_at, computed_at, compute_ms")
    .eq("user_id", opts.userId)
    .eq("kind", opts.kind)
    .eq("inputs_hash", key)
    .filter("league_id", opts.leagueId ? "eq" : "is", opts.leagueId ?? null)
    .maybeSingle();
  if (!data || new Date(data.expires_at).getTime() <= Date.now()) return null;
  return {
    payload: data.payload as T,
    computedAt: data.computed_at,
    fresh: false,
    computeMs: data.compute_ms,
  };
}

/** Stores a component payload, replacing any earlier row for the same key. */
export async function writeCached(
  supabase: DB,
  opts: CacheOptions,
  inputsHash: string,
  payload: unknown,
  computeMs: number,
): Promise<string> {
  const key = opts.suffix ? `${inputsHash}:${opts.suffix}` : inputsHash;
  const computedAt = new Date().toISOString();
  const ttl = opts.ttlMs ?? defaultTtl();

  await supabase
    .from("analysis_cache")
    .delete()
    .eq("user_id", opts.userId)
    .eq("kind", opts.kind)
    .eq("inputs_hash", key)
    .filter("league_id", opts.leagueId ? "eq" : "is", opts.leagueId ?? null);

  await supabase.from("analysis_cache").insert({
    user_id: opts.userId,
    league_id: opts.leagueId ?? null,
    kind: opts.kind,
    inputs_hash: key,
    payload: payload as never,
    compute_ms: computeMs,
    computed_at: computedAt,
    expires_at: new Date(Date.now() + ttl).toISOString(),
  });

  return computedAt;
}

/** Timings for the admin Overview, recorded alongside every stored payload. */
export async function cachedWithMeta<T>(
  supabase: DB,
  opts: CacheOptions,
  inputsHash: string,
  compute: () => Promise<T>,
): Promise<CachedResult<T>> {
  if (!opts.force) {
    const hit = await readCached<T>(supabase, opts, inputsHash);
    if (hit) return hit;
  }

  const started = Date.now();
  const payload = await compute();
  const computeMs = Date.now() - started;
  const computedAt = await writeCached(supabase, opts, inputsHash, payload, computeMs);
  return { payload, computedAt, fresh: true, computeMs };
}

export async function cached<T>(
  supabase: DB,
  opts: CacheOptions,
  inputsHash: string,
  compute: () => Promise<T>,
): Promise<T> {
  return (await cachedWithMeta(supabase, opts, inputsHash, compute)).payload;
}

/** Drops every stored result for a league, plus the cross-league This week row. */
export async function clearCache(supabase: DB, userId: string, leagueId?: string): Promise<void> {
  if (leagueId) {
    await supabase.from("analysis_cache").delete().eq("user_id", userId).eq("league_id", leagueId);
  }
  await supabase.from("analysis_cache").delete().eq("user_id", userId).is("league_id", null);
}

/**
 * Recomputes and stores every cached kind for a league. Called by the
 * background worker after a sync or a live poll so page loads are plain reads.
 */
export async function warmLeagueCache(supabase: DB, userId: string, leagueId: string): Promise<void> {
  try {
    const hash = await leagueInputsHash(supabase, leagueId);
    const { buildAnalysis } = await import("./analysis.server");
    const { buildGameDay } = await import("./live.server");
    const { loadPlayoffPicture } = await import("./playoff.server");

    await cached(supabase, { userId, leagueId, kind: "analysis", force: true }, hash, () =>
      buildAnalysis(supabase, leagueId),
    );
    await cached(supabase, { userId, leagueId, kind: "gameday", force: true }, hash, () =>
      buildGameDay(supabase, { leagueId }),
    );
    await cached(supabase, { userId, leagueId, kind: "playoff", force: true }, hash, () =>
      loadPlayoffPicture(supabase, leagueId),
    );
  } catch {
    // A cold cache just means the next page load computes normally.
  }
}

/**
 * The league analysis every screen leans on, taken from the store when it is
 * there. Cross-league views call this once per league instead of rebuilding.
 */
export async function leagueAnalysis(
  supabase: DB,
  userId: string,
  leagueId: string,
): Promise<Awaited<ReturnType<typeof import("./analysis.server").buildAnalysis>>> {
  const hash = await leagueInputsHash(supabase, leagueId);
  const { buildAnalysis } = await import("./analysis.server");
  return cached(supabase, { userId, leagueId, kind: "analysis" }, hash, () =>
    buildAnalysis(supabase, leagueId),
  );
}

