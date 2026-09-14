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

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin
      .from("player_trade_values")
      .upsert(rows.slice(i, i + 500), { onConflict: "norm_name,position,format" });
    if (error) throw new Error(error.message);
  }

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
