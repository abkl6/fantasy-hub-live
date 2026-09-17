/**
 * Keep Trade Cut dynasty market values.
 *
 * KTC has no official data feed, so we read the JSON payload their public
 * dynasty-rankings page embeds (`<script id="ktc-players">`). One request
 * returns both the 1QB and Superflex value for every ranked player and every
 * future draft pick.
 *
 * Failure is never destructive: if the page changes shape or blocks us we log
 * the failure and leave the last good values in place.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

import { writeBackPlatformIds } from "./player-ids.server";
import { normalizeName } from "./names";

type DB = SupabaseClient<Database>;

export const KTC_URL =
  "https://keeptradecut.com/dynasty-rankings?page=0&filters=QB|WR|RB|TE|RDP&format=2";

export type ValueFormat = "1qb" | "sf";
export type PickSlot = "early" | "mid" | "late" | "unknown";

export interface KtcPlayerValue {
  name: string;
  position: string;
  nflTeam: string | null;
  age: number | null;
  values: Record<ValueFormat, { value: number; tier: number | null; overallRank: number | null; positionRank: number | null }>;
}

export interface KtcPickValue {
  season: number;
  round: number;
  slot: PickSlot;
  values: Record<ValueFormat, number>;
}

interface RawSide {
  value?: number;
  overallTier?: number;
  rank?: number;
  positionalRank?: number;
}

interface RawEntry {
  playerName?: string;
  position?: string;
  team?: string | null;
  age?: number | null;
  oneQBValues?: RawSide;
  superflexValues?: RawSide;
}

const ORDINAL: Record<string, number> = { "1st": 1, "2nd": 2, "3rd": 3, "4th": 4, "5th": 5 };

/** "2027 Early 1st" / "2026 Pick 1.05" / "2028 2nd" -> structured pick. */
export function parsePickName(name: string): { season: number; round: number; slot: PickSlot } | null {
  const clean = name.trim();
  const season = Number(/^(\d{4})\b/.exec(clean)?.[1]);
  if (!Number.isFinite(season)) return null;

  const numbered = /\bPick\s+(\d+)\.(\d+)/i.exec(clean);
  if (numbered) {
    const round = Number(numbered[1]);
    const pick = Number(numbered[2]);
    const slot: PickSlot = pick <= 4 ? "early" : pick <= 8 ? "mid" : "late";
    return { season, round, slot };
  }

  const ordinal = /\b(1st|2nd|3rd|4th|5th)\b/i.exec(clean);
  if (!ordinal) return null;
  const round = ORDINAL[ordinal[1]!.toLowerCase()]!;
  const slotWord = /\b(early|mid|late)\b/i.exec(clean)?.[1]?.toLowerCase();
  return { season, round, slot: (slotWord as PickSlot) ?? "unknown" };
}

function side(raw: RawSide | undefined) {
  return {
    value: Math.max(0, Math.round(Number(raw?.value ?? 0))),
    tier: raw?.overallTier ?? null,
    overallRank: raw?.rank ?? null,
    positionRank: raw?.positionalRank ?? null,
  };
}

/** Pulls the embedded JSON out of the rankings HTML. */
export function parseKtcHtml(html: string): { players: KtcPlayerValue[]; picks: KtcPickValue[] } {
  const match = /id="ktc-players"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!match?.[1]) throw new Error("Keep Trade Cut page did not contain the expected values block");

  let raw: RawEntry[];
  try {
    raw = JSON.parse(match[1]) as RawEntry[];
  } catch {
    throw new Error("Keep Trade Cut values could not be read");
  }
  if (!Array.isArray(raw) || !raw.length) throw new Error("Keep Trade Cut returned no values");

  const players: KtcPlayerValue[] = [];
  const picks = new Map<string, KtcPickValue>();

  for (const entry of raw) {
    const name = (entry.playerName ?? "").trim();
    if (!name) continue;
    const one = side(entry.oneQBValues);
    const sf = side(entry.superflexValues);

    if ((entry.position ?? "").toUpperCase() === "RDP") {
      const parsed = parsePickName(name);
      if (!parsed) continue;
      const key = `${parsed.season}-${parsed.round}-${parsed.slot}`;
      const existing = picks.get(key);
      if (existing) {
        existing.values["1qb"] = Math.max(existing.values["1qb"], one.value);
        existing.values.sf = Math.max(existing.values.sf, sf.value);
      } else {
        picks.set(key, { ...parsed, values: { "1qb": one.value, sf: sf.value } });
      }
      continue;
    }

    players.push({
      name,
      position: (entry.position ?? "").toUpperCase(),
      nflTeam: entry.team ?? null,
      age: typeof entry.age === "number" ? entry.age : null,
      values: { "1qb": one, sf },
    });
  }

  return { players, picks: [...picks.values()] };
}

export async function fetchKtcValues(): Promise<{ players: KtcPlayerValue[]; picks: KtcPickValue[] }> {
  const response = await fetch(KTC_URL, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      accept: "text/html",
    },
  });
  if (!response.ok) throw new Error(`Keep Trade Cut responded ${response.status}`);
  return parseKtcHtml(await response.text());
}

interface PlayerRow {
  id: string;
  full_name: string;
  position: string;
}

/**
 * Keep Trade Cut carries an age for every ranked player, so it is our primary
 * age source. Our own record is filled in from it wherever it is still blank;
 * an age we already hold is left alone.
 */
async function backfillPlayerAges(
  admin: DB,
  players: KtcPlayerValue[],
  byKey: Map<string, string>,
) {
  const ageById = new Map<string, number>();
  for (const player of players) {
    if (player.age == null || !Number.isFinite(player.age) || player.age <= 0) continue;
    const id = byKey.get(`${normalizeName(player.name)}|${player.position}`);
    if (id && !ageById.has(id)) ageById.set(id, player.age);
  }
  if (!ageById.size) return 0;

  const { data: blank } = await admin.from("players").select("id").is("age", null);
  const needed = (blank ?? []).map((r) => r.id as string).filter((id) => ageById.has(id));

  // Group by age so one update covers every player of that age.
  const idsByAge = new Map<number, string[]>();
  for (const id of needed) {
    const age = ageById.get(id)!;
    const list = idsByAge.get(age);
    if (list) list.push(id);
    else idsByAge.set(age, [id]);
  }

  let filled = 0;
  for (const [age, ids] of idsByAge) {
    for (let i = 0; i < ids.length; i += 200) {
      const slice = ids.slice(i, i + 200);
      const { error } = await admin.from("players").update({ age }).in("id", slice);
      if (!error) filled += slice.length;
    }
  }
  return filled;
}

/** Writes values to the database, matching players by normalized name + position. */
export async function saveKtcValues(
  admin: DB,
  data: { players: KtcPlayerValue[]; picks: KtcPickValue[] },
  options: { onlyNames?: Set<string> | undefined; scope?: string } = {},
) {
  const { data: existing } = await admin.from("players").select("id, full_name, position");
  const byKey = new Map<string, string>();
  for (const p of (existing ?? []) as PlayerRow[]) {
    byKey.set(`${normalizeName(p.full_name)}|${p.position.toUpperCase()}`, p.id);
  }

  const fetchedAt = new Date().toISOString();
  const rows: Database["public"]["Tables"]["player_trade_values"]["Insert"][] = [];

  for (const player of data.players) {
    const norm = normalizeName(player.name);
    if (options.onlyNames && !options.onlyNames.has(norm)) continue;
    for (const format of ["1qb", "sf"] as ValueFormat[]) {
      const v = player.values[format];
      rows.push({
        player_id: byKey.get(`${norm}|${player.position}`) ?? null,
        norm_name: norm,
        display_name: player.name,
        position: player.position,
        format,
        value: v.value,
        tier: v.tier,
        overall_rank: v.overallRank,
        position_rank: v.positionRank,
        age: player.age,
        nfl_team: player.nflTeam,
        source: "ktc",
        fetched_at: fetchedAt,
      });
    }
  }

  // Remember each matched player's Keep Trade Cut handle so later refreshes
  // line up by identifier rather than by name.
  const learntSlugs = new Map<string, string>();
  for (const player of data.players) {
    const id = byKey.get(`${normalizeName(player.name)}|${player.position}`);
    if (id && !learntSlugs.has(id)) {
      learntSlugs.set(id, normalizeName(player.name).replace(/ /g, "-"));
    }
  }
  await writeBackPlatformIds(admin, "ktc_slug", learntSlugs);

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin
      .from("player_trade_values")
      .upsert(rows.slice(i, i + 500), { onConflict: "norm_name,position,format" });
    if (error) throw new Error(error.message);
  }

  await backfillPlayerAges(admin, data.players, byKey);

  let pickRows = 0;
  if (!options.onlyNames && data.picks.length) {
    const picks = data.picks.flatMap((p) =>
      (["1qb", "sf"] as ValueFormat[]).map((format) => ({
        season: p.season,
        round: p.round,
        slot: p.slot,
        format,
        value: p.values[format],
        source: "ktc",
        fetched_at: fetchedAt,
      })),
    );
    const { error } = await admin.from("pick_values").upsert(picks, { onConflict: "season,round,slot,format" });
    if (error) throw new Error(error.message);
    pickRows = picks.length;
  }

  return { players: rows.length, picks: pickRows };
}

/** Copies today's market table into the dated history used to fit age curves. */
export async function snapshotTradeValues(admin: DB) {
  const today = new Date().toISOString().slice(0, 10);
  const { data: values } = await admin
    .from("player_trade_values")
    .select("norm_name, display_name, position, format, value, overall_rank, position_rank, age")
    .limit(5000);

  const rows = (values ?? []).map((v) => ({
    snapshot_date: today,
    norm_name: String(v.norm_name),
    display_name: String(v.display_name ?? v.norm_name),
    position: String(v.position).toUpperCase(),
    format: String(v.format),
    value: Number(v.value ?? 0),
    overall_rank: v.overall_rank,
    position_rank: v.position_rank,
    age: v.age,
  }));

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin
      .from("trade_value_history")
      .upsert(rows.slice(i, i + 500), { onConflict: "snapshot_date,norm_name,position,format" });
    if (error) throw new Error(error.message);
  }
  return { snapshot: rows.length };
}

/** Full weekly refresh. Logs success or failure and never clears old values. */
export async function refreshTradeValues(admin: DB, scope: "full" | "ir" = "full") {
  try {
    const data = await fetchKtcValues();

    let onlyNames: Set<string> | undefined;
    if (scope === "ir") {
      const cutoff = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString();
      const { data: hurt } = await admin
        .from("players")
        .select("full_name, status, ir_since")
        .gte("ir_since", cutoff);
      onlyNames = new Set((hurt ?? []).map((p) => normalizeName(p.full_name as string)));
      if (!onlyNames.size) {
        await admin.from("trade_value_refresh_log").insert({ scope, rows_upserted: 0, picks_upserted: 0, status: "ok" });
        return { players: 0, picks: 0, skipped: true };
      }
    }

    const saved = await saveKtcValues(admin, data, { onlyNames, scope });

    // Weekly photograph of the market, so curves can later be fitted from how
    // the same player actually moved year over year.
    if (scope === "full") {
      try {
        await snapshotTradeValues(admin);
      } catch (snapshotError) {
        await admin.from("job_errors").insert({
          source: "trade-values",
          scope: "snapshot",
          message: snapshotError instanceof Error ? snapshotError.message : "Snapshot failed",
        });
      }
    }

    // Refit the market-implied age curves from the values we just stored. A
    // bad fit must never fail the refresh, so it is logged and swallowed.
    if (scope === "full") {
      try {
        const { refitAgeCurves } = await import("./age-curve.server");
        await Promise.all([refitAgeCurves(admin, "sf"), refitAgeCurves(admin, "1qb")]);
      } catch (curveError) {
        await admin.from("job_errors").insert({
          source: "age-curves",
          scope: "fit",
          message: curveError instanceof Error ? curveError.message : "Age curve fit failed",
        });
      }
    }
    await admin.from("trade_value_refresh_log").insert({
      scope,
      rows_upserted: saved.players,
      picks_upserted: saved.picks,
      status: "ok",
    });
    return { ...saved, skipped: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Refresh failed";
    await admin.from("trade_value_refresh_log").insert({ scope, status: "failed", error: message });
    throw error;
  }
}

/**
 * Keeps values current without a scheduler: refreshes the whole market once a
 * week, and tops up injured players daily. Safe to call on any page load — it
 * no-ops when a recent run already succeeded.
 */
export async function refreshTradeValuesIfStale(admin: DB) {
  const { data: last } = await admin
    .from("trade_value_refresh_log")
    .select("run_at, scope, status")
    .eq("status", "ok")
    .order("run_at", { ascending: false })
    .limit(10);

  const newest = (scope: string) =>
    (last ?? []).find((r) => r.scope === scope)?.run_at ?? null;
  const ageMs = (at: string | null) => (at ? Date.now() - new Date(at).getTime() : Infinity);

  const WEEK = 7 * 24 * 60 * 60 * 1000;
  const DAY = 24 * 60 * 60 * 1000;

  if (ageMs(newest("full")) > WEEK) return refreshTradeValues(admin, "full");
  if (ageMs(newest("ir")) > DAY) return refreshTradeValues(admin, "ir");
  return null;
}

/** True when we already hold market values from a successful run under a day old. */
export async function tradeValuesFresh(admin: DB): Promise<boolean> {
  const { count } = await admin
    .from("player_trade_values")
    .select("id", { count: "exact", head: true });
  if (!count) return false;

  const { data: last } = await admin
    .from("trade_value_refresh_log")
    .select("run_at")
    .eq("status", "ok")
    .eq("scope", "full")
    .order("run_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!last?.run_at) return false;
  return Date.now() - new Date(last.run_at).getTime() < 24 * 60 * 60 * 1000;
}

/**
 * Called after a league import or a league-type change. Fetches the market once
 * when it is missing or stale, and never throws: a failure is logged to the
 * refresh log (by refreshTradeValues) and to job_errors for the admin Errors tab.
 */
export async function ensureTradeValues(
  admin: DB,
  ctx: { scope?: string | null; userId?: string | null; platform?: string | null } = {},
): Promise<void> {
  try {
    if (await tradeValuesFresh(admin)) return;
    await refreshTradeValues(admin, "full");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Trade value refresh failed";
    try {
      await admin.from("job_errors").insert({
        source: "trade-values",
        platform: ctx.platform ?? null,
        scope: ctx.scope ?? "import",
        user_id: ctx.userId ?? null,
        message: message.slice(0, 400),
        detail: {},
      });
    } catch {
      // logging must never surface to the caller
    }
  }
}

/**
 * Fire-and-forget wrapper: starts the check without awaiting it so an import
 * never waits on the market, and hands the promise to the worker's background
 * hook where one is available so it is not cut short.
 */
export function ensureTradeValuesInBackground(ctx: {
  scope?: string | null;
  userId?: string | null;
  platform?: string | null;
}): void {
  const task = (async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await ensureTradeValues(supabaseAdmin as unknown as DB, ctx);
  })().catch(() => undefined);

  const waitUntil = (globalThis as { waitUntil?: (p: Promise<unknown>) => void }).waitUntil;
  if (typeof waitUntil === "function") {
    try {
      waitUntil(task);
    } catch {
      // no background hook available; the promise still runs
    }
  }
}
