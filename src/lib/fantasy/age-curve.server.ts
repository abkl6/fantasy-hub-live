/**
 * Storing and reading the fitted age curves. The fit itself lives in
 * age-curve.ts so it can be tested without a database.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

import {
  CURVE_POSITIONS,
  fitAgeCurves,
  handCurve,
  type AgeCurve,
  type CurvePoint,
} from "./age-curve";

type DB = SupabaseClient<Database>;

export interface AgeCurveBook {
  /** Never null — falls back to the hand-set shape. */
  curve: (position: string) => AgeCurve;
  fittedAt: string | null;
  fromMarket: boolean;
}

/** Refits every position from the current market table and stores the result. */
export async function refitAgeCurves(admin: DB, format: "1qb" | "sf" = "sf") {
  const { data } = await admin
    .from("player_trade_values")
    .select("position, age, value")
    .eq("format", format);

  const rows = (data ?? []).map((r) => ({
    position: String(r.position ?? ""),
    age: r.age == null ? null : Number(r.age),
    value: Number(r.value ?? 0),
  }));

  const fittedAt = new Date().toISOString();
  const curves = fitAgeCurves(rows, fittedAt);
  const { error } = await admin.from("age_curves").upsert(
    curves.map((c) => ({
      position: c.position,
      format,
      points: c.points as unknown as Database["public"]["Tables"]["age_curves"]["Insert"]["points"],
      sample_size: c.sampleSize,
      source: c.source === "market" ? "ktc" : "hand",
      fitted_at: fittedAt,
    })),
    { onConflict: "position,format" },
  );
  if (error) throw new Error(error.message);
  return curves;
}

export async function loadAgeCurves(supabase: DB, format: "1qb" | "sf" = "sf"): Promise<AgeCurveBook> {
  const { data } = await supabase
    .from("age_curves")
    .select("position, points, sample_size, source, fitted_at")
    .eq("format", format);

  const byPosition = new Map<string, AgeCurve>();
  let fittedAt: string | null = null;
  for (const row of data ?? []) {
    const points = Array.isArray(row.points) ? (row.points as unknown as CurvePoint[]) : [];
    if (!points.length) continue;
    const position = String(row.position).toUpperCase();
    byPosition.set(position, {
      position,
      points,
      sampleSize: Number(row.sample_size ?? 0),
      source: row.source === "hand" ? "hand" : "market",
      fittedAt: row.fitted_at ? String(row.fitted_at) : null,
    });
    if (!fittedAt || String(row.fitted_at) > fittedAt) fittedAt = String(row.fitted_at);
  }

  const fallbacks = new Map<string, AgeCurve>();
  return {
    fittedAt,
    fromMarket: [...byPosition.values()].some((c) => c.source === "market"),
    curve: (position: string) => {
      const key = position.toUpperCase();
      const known = byPosition.get(key);
      if (known) return known;
      const nearest = (CURVE_POSITIONS as readonly string[]).includes(key) ? key : "WR";
      const viaNearest = byPosition.get(nearest);
      if (viaNearest) return viaNearest;
      const cached = fallbacks.get(key);
      if (cached) return cached;
      const made = handCurve(key);
      fallbacks.set(key, made);
      return made;
    },
  };
}
