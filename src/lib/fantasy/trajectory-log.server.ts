/**
 * Keeping score on the Rising / Peak / Declining / Cliff calls.
 *
 * Each week every player's classification is written to trajectory_log. A year
 * later the same player's real value move grades the call, and the admin
 * Overview shows how often each class has been right, by position.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

import { classifyTrajectory, tierFromRank, trajectoryFor } from "./age-curve";
import { loadAgeCurves } from "./age-curve.server";
import { loadSituationBook } from "./situation.server";

type DB = SupabaseClient<Database>;

/** Writes this week's classification for every valued player. */
export async function logTrajectories(
  admin: DB,
  options: { season: number; week: number; format?: "1qb" | "sf" },
) {
  const format = options.format ?? "sf";
  const [{ data: values }, curves, situations] = await Promise.all([
    admin
      .from("player_trade_values")
      .select("player_id, norm_name, display_name, position, value, age, position_rank")
      .eq("format", format)
      .limit(2000),
    loadAgeCurves(admin, format),
    loadSituationBook(admin, { season: options.season, throughWeek: options.week }),
  ]);

  const rows: Database["public"]["Tables"]["trajectory_log"]["Insert"][] = [];
  for (const v of values ?? []) {
    const age = v.age == null ? null : Number(v.age);
    const value = Number(v.value ?? 0);
    if (age == null || !Number.isFinite(age) || !(value > 0)) continue;
    const position = String(v.position).toUpperCase();
    const t = trajectoryFor({
      position,
      age,
      value,
      tier: tierFromRank(v.position_rank == null ? null : Number(v.position_rank), 12, position),
      curve: curves.curve(position),
      declineCurve: curves.declineCurve(position),
      situation: situations.features(v.player_id ?? null, String(v.display_name ?? v.norm_name)),
    });
    rows.push({
      season: options.season,
      week: options.week,
      norm_name: String(v.norm_name),
      display_name: String(v.display_name ?? v.norm_name),
      position,
      format,
      classification: t.classification,
      uncertain: t.uncertain,
      change1: t.change1,
      value: t.now,
      age,
    });
  }

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin
      .from("trajectory_log")
      .upsert(rows.slice(i, i + 500), { onConflict: "season,week,norm_name,position,format" });
    if (error) throw new Error(error.message);
  }
  return { logged: rows.length };
}

/**
 * Grades every call that is now about a year old against the player's value in
 * the market history. Calls without a later snapshot stay ungraded.
 */
export async function gradeTrajectories(admin: DB, now = new Date()) {
  const cutoff = new Date(now.getTime() - 330 * 24 * 3600 * 1000).toISOString();
  const { data: pending } = await admin
    .from("trajectory_log")
    .select("id, norm_name, position, format, classification, value, created_at")
    .eq("graded", false)
    .lte("created_at", cutoff)
    .limit(2000);
  if (!pending?.length) return { graded: 0 };

  const { data: history } = await admin
    .from("trade_value_history")
    .select("norm_name, position, format, value, snapshot_date")
    .gte("snapshot_date", new Date(now.getTime() - 45 * 24 * 3600 * 1000).toISOString().slice(0, 10))
    .limit(50000);

  const latest = new Map<string, number>();
  for (const h of history ?? []) {
    const key = `${h.norm_name}|${String(h.position).toUpperCase()}|${h.format}`;
    latest.set(key, Number(h.value ?? 0));
  }

  let graded = 0;
  for (const row of pending) {
    const key = `${row.norm_name}|${String(row.position).toUpperCase()}|${row.format}`;
    const later = latest.get(key);
    const before = Number(row.value ?? 0);
    if (later == null || !(before > 0)) continue;
    const actual = later / before - 1;
    await admin
      .from("trajectory_log")
      .update({
        graded: true,
        actual_change: actual,
        correct: classifyTrajectory(actual) === row.classification,
        graded_at: now.toISOString(),
      })
      .eq("id", row.id);
    graded += 1;
  }
  return { graded };
}

export interface TrajectoryHitRate {
  classification: string;
  position: string;
  graded: number;
  correct: number;
  rate: number;
}

/** Hit rate by class and position. Empty until a season of history exists. */
export async function trajectoryHitRates(supabase: DB): Promise<TrajectoryHitRate[]> {
  const { data } = await supabase
    .from("trajectory_log")
    .select("classification, position, correct")
    .eq("graded", true)
    .limit(20000);

  const buckets = new Map<string, { graded: number; correct: number }>();
  for (const row of data ?? []) {
    const key = `${row.classification}|${String(row.position).toUpperCase()}`;
    const b = buckets.get(key) ?? { graded: 0, correct: 0 };
    b.graded += 1;
    if (row.correct) b.correct += 1;
    buckets.set(key, b);
  }

  return [...buckets.entries()]
    .map(([key, b]) => {
      const [classification, position] = key.split("|");
      return {
        classification: classification!,
        position: position!,
        graded: b.graded,
        correct: b.correct,
        rate: Math.round((b.correct / Math.max(1, b.graded)) * 100) / 100,
      };
    })
    .sort((a, b) => b.graded - a.graded);
}
