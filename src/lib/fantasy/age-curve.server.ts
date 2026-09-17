/**
 * Storing and reading the fitted age curves. The fits themselves live in
 * age-curve.ts so they can be tested without a database.
 *
 * Each refit writes up to three kinds of curve per position:
 *   market     — year-over-year moves from trade_value_history, else today's
 *                cross-section, else the hand-set shape
 *   production — fantasy points by age from uploaded season totals
 *   blended    — the two mixed 50/50, used only for the decline rate
 *
 * Quarterbacks are fitted twice more, split by rushing share.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

import {
  CURVE_POSITIONS,
  blendCurves,
  fitCurve,
  fitFromPairs,
  fitSpline,
  handCurve,
  knotFor,
  qbVariant,
  type AgeCurve,
  type CurvePoint,
  type CurveVariant,
  type DispersionPoint,
  type YearPair,
} from "./age-curve";

type DB = SupabaseClient<Database>;

export interface AgeCurveBook {
  /** Market curve — never null; falls back to the hand-set shape. */
  curve: (position: string, variant?: CurveVariant) => AgeCurve;
  /** Market blended with production — how fast a player falls. */
  declineCurve: (position: string, variant?: CurveVariant) => AgeCurve;
  fittedAt: string | null;
  fromMarket: boolean;
  pairCount: number;
}

type CurveRow = Database["public"]["Tables"]["age_curves"]["Insert"];

function toRow(curve: AgeCurve, format: string, kind: string, variant: string, fittedAt: string): CurveRow {
  return {
    position: curve.position,
    format,
    kind,
    variant,
    points: curve.points as unknown as NonNullable<CurveRow["points"]>,
    dispersion: (curve.dispersion ?? []) as unknown as NonNullable<CurveRow["points"]>,
    pair_count: curve.pairCount ?? 0,
    sample_size: curve.sampleSize,
    source: curve.source === "market" ? "ktc" : "hand",
    fitted_at: fittedAt,
  };
}

/**
 * Same-player year-over-year value pairs, from the weekly market snapshots.
 * A pair is a player's value on one snapshot and the closest snapshot about a
 * year later (within six weeks either side).
 */
export async function yearOverYearPairs(
  admin: DB,
  format: "1qb" | "sf",
): Promise<Map<string, YearPair[]>> {
  const { data } = await admin
    .from("trade_value_history")
    .select("snapshot_date, norm_name, position, value, age")
    .eq("format", format)
    .order("snapshot_date", { ascending: true })
    .limit(200000);

  interface Snap { t: number; value: number; age: number | null; position: string }
  const byPlayer = new Map<string, Snap[]>();
  for (const row of data ?? []) {
    const value = Number(row.value ?? 0);
    if (!(value > 0)) continue;
    const key = `${row.norm_name}|${String(row.position).toUpperCase()}`;
    const list = byPlayer.get(key) ?? [];
    list.push({
      t: Date.parse(`${row.snapshot_date}T00:00:00Z`),
      value,
      age: row.age == null ? null : Number(row.age),
      position: String(row.position).toUpperCase(),
    });
    byPlayer.set(key, list);
  }

  const YEAR = 365 * 24 * 3600 * 1000;
  const WINDOW = 42 * 24 * 3600 * 1000;
  const out = new Map<string, YearPair[]>();
  for (const snaps of byPlayer.values()) {
    for (const from of snaps) {
      if (from.age == null) continue;
      const later = snaps
        .filter((s) => Math.abs(s.t - from.t - YEAR) <= WINDOW)
        .sort((a, b) => Math.abs(a.t - from.t - YEAR) - Math.abs(b.t - from.t - YEAR))[0];
      if (!later) continue;
      const list = out.get(from.position) ?? [];
      list.push({ age: from.age, ratio: later.value / from.value });
      out.set(from.position, list);
    }
  }
  return out;
}

/** Fantasy-points-by-age curve per position, from uploaded season totals. */
export async function productionCurves(admin: DB, fittedAt: string): Promise<Map<string, AgeCurve>> {
  const { data } = await admin
    .from("player_production_seasons")
    .select("position, age, fantasy_points")
    .limit(50000);

  const byPosition = new Map<string, { age: number; value: number }[]>();
  for (const row of data ?? []) {
    const age = row.age == null ? null : Number(row.age);
    const value = Number(row.fantasy_points ?? 0);
    if (age == null || !Number.isFinite(age) || !(value > 0)) continue;
    const pos = String(row.position).toUpperCase();
    const list = byPosition.get(pos) ?? [];
    list.push({ age, value });
    byPosition.set(pos, list);
  }

  const out = new Map<string, AgeCurve>();
  for (const [position, samples] of byPosition) {
    const points = fitSpline(samples, knotFor(position));
    if (!points) continue;
    out.set(position, {
      position,
      points,
      sampleSize: samples.length,
      source: "market",
      fittedAt,
      kind: "production",
      variant: "all",
      pairCount: 0,
    });
  }
  return out;
}

/** Share of a quarterback's fantasy points that comes from rushing. */
export async function qbRushShares(admin: DB): Promise<Map<string, number>> {
  const { data } = await admin
    .from("players")
    .select("search_name, position, stat_projections")
    .eq("position", "QB")
    .limit(500);

  const out = new Map<string, number>();
  for (const row of data ?? []) {
    const stats = (row.stat_projections ?? {}) as Record<string, number>;
    const passing = (Number(stats['pass_yds'] ?? 0) / 25) + Number(stats['pass_td'] ?? 0) * 4;
    const rushing = (Number(stats['rush_yds'] ?? 0) / 10) + Number(stats['rush_td'] ?? 0) * 6;
    const total = passing + rushing;
    if (total <= 0) continue;
    out.set(String(row.search_name), rushing / total);
  }
  return out;
}

/** Refits every position from history, the market table and production. */
export async function refitAgeCurves(admin: DB, format: "1qb" | "sf" = "sf") {
  const fittedAt = new Date().toISOString();

  const [{ data: market }, pairsByPosition, production, rushShares] = await Promise.all([
    admin.from("player_trade_values").select("norm_name, position, age, value").eq("format", format),
    yearOverYearPairs(admin, format),
    productionCurves(admin, fittedAt),
    qbRushShares(admin),
  ]);

  const rows = (market ?? []).map((r) => ({
    norm: String(r.norm_name ?? ""),
    position: String(r.position ?? "").toUpperCase(),
    age: r.age == null ? null : Number(r.age),
    value: Number(r.value ?? 0),
  }));

  const inserts: CurveRow[] = [];
  const fitted: AgeCurve[] = [];

  const fitOne = (position: string, variant: CurveVariant, own: typeof rows, pairs: YearPair[]) => {
    const curve =
      fitFromPairs(position, pairs, fittedAt) ??
      fitCurve(position, own.map((r) => ({ age: r.age, value: r.value })), fittedAt) ??
      handCurve(position);
    curve.variant = variant;
    const prod = production.get(position) ?? null;
    const blended = blendCurves({ ...curve, kind: "market" }, prod, 0.5);
    inserts.push(toRow(curve, format, "market", variant, fittedAt));
    if (prod) inserts.push(toRow({ ...prod, variant }, format, "production", variant, fittedAt));
    inserts.push(toRow({ ...blended, dispersion: curve.dispersion }, format, "blended", variant, fittedAt));
    fitted.push(curve);
  };

  for (const position of CURVE_POSITIONS) {
    const own = rows.filter((r) => r.position === position);
    fitOne(position, "all", own, pairsByPosition.get(position) ?? []);

    // Running quarterbacks age differently from pocket passers.
    if (position === "QB") {
      for (const variant of ["rush", "pocket"] as const) {
        const subset = own.filter((r) => {
          const share = rushShares.get(r.norm);
          return qbVariant(share ?? null) === variant;
        });
        if (subset.length < 15) continue;
        fitOne(position, variant, subset, []);
      }
    }
  }

  for (let i = 0; i < inserts.length; i += 100) {
    const { error } = await admin
      .from("age_curves")
      .upsert(inserts.slice(i, i + 100), { onConflict: "position,format,kind,variant" });
    if (error) throw new Error(error.message);
  }
  return fitted;
}

export async function loadAgeCurves(supabase: DB, format: "1qb" | "sf" = "sf"): Promise<AgeCurveBook> {
  const { data } = await supabase
    .from("age_curves")
    .select("position, points, sample_size, source, fitted_at, kind, variant, dispersion, pair_count")
    .eq("format", format);

  const stored = new Map<string, AgeCurve>();
  let fittedAt: string | null = null;
  let pairCount = 0;

  for (const row of data ?? []) {
    const points = Array.isArray(row.points) ? (row.points as unknown as CurvePoint[]) : [];
    if (!points.length) continue;
    const position = String(row.position).toUpperCase();
    const kind = String(row.kind ?? "market");
    const variant = String(row.variant ?? "all");
    stored.set(`${kind}|${position}|${variant}`, {
      position,
      points,
      sampleSize: Number(row.sample_size ?? 0),
      source: row.source === "hand" ? "hand" : "market",
      fittedAt: row.fitted_at ? String(row.fitted_at) : null,
      kind: kind as AgeCurve["kind"],
      variant,
      pairCount: Number(row.pair_count ?? 0),
      dispersion: Array.isArray(row.dispersion) ? (row.dispersion as unknown as DispersionPoint[]) : [],
    });
    pairCount = Math.max(pairCount, Number(row.pair_count ?? 0));
    if (!fittedAt || String(row.fitted_at) > fittedAt) fittedAt = String(row.fitted_at);
  }

  const fallbacks = new Map<string, AgeCurve>();
  const pick = (kind: string, position: string, variant: CurveVariant): AgeCurve => {
    const key = position.toUpperCase();
    const exact = stored.get(`${kind}|${key}|${variant}`) ?? stored.get(`${kind}|${key}|all`);
    if (exact) return exact;
    const nearest = (CURVE_POSITIONS as readonly string[]).includes(key) ? key : "WR";
    const viaNearest = stored.get(`${kind}|${nearest}|all`) ?? stored.get(`market|${nearest}|all`);
    if (viaNearest) return viaNearest;
    const cached = fallbacks.get(key);
    if (cached) return cached;
    const made = handCurve(key);
    fallbacks.set(key, made);
    return made;
  };

  return {
    fittedAt,
    pairCount,
    fromMarket: [...stored.values()].some((c) => c.source === "market"),
    curve: (position: string, variant: CurveVariant = "all") => pick("market", position, variant),
    declineCurve: (position: string, variant: CurveVariant = "all") => pick("blended", position, variant),
  };
}
