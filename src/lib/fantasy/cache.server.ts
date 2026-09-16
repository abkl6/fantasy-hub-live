/**
 * Server-side result cache. Heavy page payloads (league analysis, Game Day,
 * the playoff picture, This week) are stored in analysis_cache and served back
 * while the inputs they were built from are unchanged and the entry is fresh.
 * Server-only.
 */

import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { gameWindow } from "./gamewindow";

type DB = SupabaseClient<Database>;

export type CacheKind = "analysis" | "gameday" | "playoff" | "this-week" | "impact";

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

/** Timings for the admin Overview, recorded alongside every stored payload. */
export async function cached<T>(
  supabase: DB,
  opts: CacheOptions,
  inputsHash: string,
  compute: () => Promise<T>,
): Promise<T> {
  const key = opts.suffix ? `${inputsHash}:${opts.suffix}` : inputsHash;
  const ttl = opts.ttlMs ?? defaultTtl();

  if (!opts.force) {
    const { data } = await supabase
      .from("analysis_cache")
      .select("payload, expires_at")
      .eq("user_id", opts.userId)
      .eq("kind", opts.kind)
      .eq("inputs_hash", key)
      .filter("league_id", opts.leagueId ? "eq" : "is", opts.leagueId ?? null)
      .maybeSingle();
    if (data && new Date(data.expires_at).getTime() > Date.now()) {
      return data.payload as T;
    }
  }

  const started = Date.now();
  const payload = await compute();
  const computeMs = Date.now() - started;

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
    computed_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + ttl).toISOString(),
  });

  return payload;
}

/** Drops every stored result for a league, plus the cross-league This week row. */
export async function clearCache(supabase: DB, userId: string, leagueId?: string): Promise<void> {
  if (leagueId) {
    await supabase.from("analysis_cache").delete().eq("user_id", userId).eq("league_id", leagueId);
  }
  await supabase.from("analysis_cache").delete().eq("user_id", userId).is("league_id", null);
}

/**
 * Recomputes and stores every cached kind for a league. Called in the
 * background after a sync or a live poll so page loads are plain reads.
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
