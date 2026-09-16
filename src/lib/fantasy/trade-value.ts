/**
 * Dynasty trade currency: what a player or a future draft pick is worth on the
 * Keep Trade Cut market, and how to balance a two-sided offer with it.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

import { normalizeName } from "./names";

type DB = SupabaseClient<Database>;

export type ValueFormat = "1qb" | "sf";
export type PickSlot = "early" | "mid" | "late" | "unknown";

export interface PickAsset {
  kind: "pick";
  season: number;
  round: number;
  slot: PickSlot;
  label: string;
  value: number;
}

export interface PlayerAsset {
  kind: "player";
  id: string | null;
  name: string;
  position: string;
  value: number;
}

export type TradeAsset = PlayerAsset | PickAsset;

const ROUND_LABEL: Record<number, string> = { 1: "1st", 2: "2nd", 3: "3rd", 4: "4th", 5: "5th" };

export function pickLabel(season: number, round: number, slot: PickSlot) {
  const suffix = ROUND_LABEL[round] ?? `${round}th`;
  return slot === "unknown" ? `${season} ${suffix}` : `${season} ${slot} ${suffix}`;
}

/** Superflex and two-QB leagues price quarterbacks very differently. */
export function leagueValueFormat(slots: string[]): ValueFormat {
  const upper = slots.map((s) => s.toUpperCase().replace(/[^A-Z]/g, ""));
  const superflex = upper.some((s) => ["SUPERFLEX", "SFLEX", "OP", "QBWRRBTE"].includes(s));
  const twoQb = upper.filter((s) => s === "QB").length >= 2;
  return superflex || twoQb ? "sf" : "1qb";
}

export interface TradeValueBook {
  format: ValueFormat;
  /** Market value for a rostered player; falls back to projection-based value. */
  player: (id: string | null, name: string, position: string, projSeason: number) => number;
  /** Real KTC market price only — null when the player is not in the book. */
  market: (id: string | null, name: string, position: string) => number | null;
  /** Age from the market table — the primary age source for every player. */
  age: (id: string | null, name: string, position: string) => number | null;
  /** Median age of the position in the current market table. */
  medianAge: (position: string) => number | null;
  pick: (season: number, round: number, slot: PickSlot) => number;
  lastRefreshed: string | null;
  covered: boolean;
}

const POSITION_FLOOR: Record<string, number> = {
  QB: 45,
  RB: 40,
  WR: 40,
  TE: 35,
  K: 8,
  DEF: 8,
  DL: 10,
  LB: 10,
  DB: 10,
};

/**
 * Players outside the KTC top list still need a number, or every deep bench
 * piece would price at zero. We fall back to a projection-derived estimate.
 */
export function fallbackValue(position: string, projSeason: number) {
  const floor = POSITION_FLOOR[position.toUpperCase()] ?? 15;
  return Math.max(floor, Math.round(projSeason * 6));
}

export async function loadTradeValues(supabase: DB, format: ValueFormat): Promise<TradeValueBook> {
  const [{ data: values }, { data: picks }] = await Promise.all([
    supabase
      .from("player_trade_values")
      .select("player_id, norm_name, position, value, age, fetched_at")
      .eq("format", format),
    supabase.from("pick_values").select("season, round, slot, value").eq("format", format),
  ]);

  const byId = new Map<string, number>();
  const byName = new Map<string, number>();
  const ageById = new Map<string, number>();
  const ageByName = new Map<string, number>();
  const agesByPosition = new Map<string, number[]>();
  let lastRefreshed: string | null = null;

  for (const row of values ?? []) {
    const value = Number(row.value ?? 0);
    const pos = String(row.position).toUpperCase();
    if (row.player_id) byId.set(row.player_id, value);
    byName.set(`${row.norm_name}|${pos}`, value);
    byName.set(row.norm_name as string, Math.max(byName.get(row.norm_name as string) ?? 0, value));

    const age = row.age == null ? null : Number(row.age);
    if (age != null && Number.isFinite(age) && age > 0) {
      if (row.player_id) ageById.set(row.player_id, age);
      ageByName.set(`${row.norm_name}|${pos}`, age);
      if (!ageByName.has(row.norm_name as string)) ageByName.set(row.norm_name as string, age);
      const list = agesByPosition.get(pos);
      if (list) list.push(age);
      else agesByPosition.set(pos, [age]);
    }

    if (!lastRefreshed || String(row.fetched_at) > lastRefreshed) lastRefreshed = String(row.fetched_at);
  }

  const medians = new Map<string, number>();
  for (const [pos, ages] of agesByPosition) {
    const sorted = [...ages].sort((a, b) => a - b);
    medians.set(pos, sorted[Math.floor(sorted.length / 2)]!);
  }

  const pickMap = new Map<string, number>();
  for (const p of picks ?? []) {
    pickMap.set(`${p.season}|${p.round}|${p.slot}`, Number(p.value ?? 0));
  }

  const pick = (season: number, round: number, slot: PickSlot) => {
    const exact = pickMap.get(`${season}|${round}|${slot}`);
    if (exact != null) return exact;
    const mid = pickMap.get(`${season}|${round}|mid`) ?? pickMap.get(`${season}|${round}|unknown`);
    if (mid != null) return mid;
    // Unknown future season: decay the nearest known season by 12% a year.
    const known = [...pickMap.entries()]
      .map(([key, value]) => ({ parts: key.split("|"), value }))
      .filter((e) => Number(e.parts[1]) === round)
      .sort((a, b) => Number(b.parts[0]) - Number(a.parts[0]))[0];
    if (!known) return 0;
    const gap = Math.abs(season - Number(known.parts[0]));
    return Math.round(known.value * Math.pow(0.88, gap));
  };

  const market = (id: string | null, name: string, position: string) => {
    if (id && byId.has(id)) return byId.get(id)!;
    const norm = normalizeName(name);
    const pos = position.toUpperCase();
    return byName.get(`${norm}|${pos}`) ?? byName.get(norm) ?? null;
  };

  const age = (id: string | null, name: string, position: string) => {
    if (id && ageById.has(id)) return ageById.get(id)!;
    const norm = normalizeName(name);
    return ageByName.get(`${norm}|${position.toUpperCase()}`) ?? ageByName.get(norm) ?? null;
  };

  return {
    format,
    lastRefreshed,
    covered: byName.size > 0,
    market,
    age,
    medianAge: (position: string) => medians.get(position.toUpperCase()) ?? null,
    player: (id, name, position, projSeason) =>
      market(id, name, position) ?? fallbackValue(position.toUpperCase(), projSeason),
    pick,
  };
}

/**
 * Projection-derived worth and KTC prices live on different scales. The
 * median market/projection ratio across players present in both puts our
 * "what they should be worth" number on the market's scale.
 */
export function calibratedScale(pairs: { market: number; proj: number }[]): number {
  const ratios = pairs
    .filter((p) => p.market > 0 && p.proj > 0)
    .map((p) => p.market / p.proj)
    .sort((a, b) => a - b);
  if (ratios.length < 10) return 1;
  const median = ratios[Math.floor(ratios.length / 2)]!;
  return Math.min(20, Math.max(0.25, median));
}

export type Fairness = "even" | "you-win" | "they-win";

export function fairnessOf(giveValue: number, getValue: number): Fairness {
  const base = Math.max(1, (giveValue + getValue) / 2);
  const edge = (getValue - giveValue) / base;
  if (edge > 0.1) return "you-win";
  if (edge < -0.1) return "they-win";
  return "even";
}

export function fairnessLabel(giveValue: number, getValue: number) {
  const f = fairnessOf(giveValue, getValue);
  if (f === "even") return "Fair value both ways";
  if (f === "you-win") return "Tilts your way";
  return "Tilts their way";
}

/**
 * Adds sweeteners from `pool` (cheapest first) to whichever side owes value
 * until the two sides are within 10% of each other.
 */
export function balanceTrade(
  give: TradeAsset[],
  get: TradeAsset[],
  myPool: TradeAsset[],
  theirPool: TradeAsset[],
  maxSweeteners = 2,
) {
  const total = (a: TradeAsset[]) => a.reduce((sum, x) => sum + x.value, 0);
  const nextGive = [...give];
  const nextGet = [...get];
  const used = new Set([...give, ...get].map((a) => `${a.kind}:${a.kind === "pick" ? a.label : a.name}`));

  for (let i = 0; i < maxSweeteners; i += 1) {
    const gap = total(nextGet) - total(nextGive);
    const base = Math.max(1, (total(nextGet) + total(nextGive)) / 2);
    if (Math.abs(gap) / base <= 0.1) break;

    const owing = gap > 0 ? nextGive : nextGet;
    const pool = gap > 0 ? myPool : theirPool;
    const target = Math.abs(gap);
    const candidate = pool
      .filter((a) => !used.has(`${a.kind}:${a.kind === "pick" ? a.label : a.name}`))
      .filter((a) => a.value <= target * 1.25)
      .sort((a, b) => Math.abs(target - a.value) - Math.abs(target - b.value))[0];
    if (!candidate) break;
    used.add(`${candidate.kind}:${candidate.kind === "pick" ? candidate.label : candidate.name}`);
    owing.push(candidate);
  }

  return {
    give: nextGive,
    get: nextGet,
    giveValue: Math.round(total(nextGive)),
    getValue: Math.round(total(nextGet)),
    fairness: fairnessOf(total(nextGive), total(nextGet)),
  };
}

export function assetLabel(asset: TradeAsset) {
  return asset.kind === "pick" ? asset.label : `${asset.name} (${asset.position})`;
}
