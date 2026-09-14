/**
 * Trade value browser: read the Keep Trade Cut market table, trigger a manual
 * refresh, or upload a CSV when the automatic pull is unavailable.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizeName } from "@/lib/fantasy/names";
import { calibratedScale, fallbackValue } from "@/lib/fantasy/trade-value";

export interface TradeValueRow {
  name: string;
  position: string;
  nflTeam: string | null;
  value: number;
  tier: number | null;
  overallRank: number | null;
  positionRank: number | null;
  /** What our projections imply this player should be worth. */
  projValue: number | null;
  /** projValue minus market value; positive means the market is sleeping. */
  gap: number | null;
  undervalued: boolean;
}

export interface PickValueRow {
  season: number;
  round: number;
  slot: string;
  value: number;
}

async function callerIsAdmin(context: { supabase: unknown; userId: string }) {
  const { data } = await (context.supabase as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: boolean | null }>;
  }).rpc("has_role", { _user_id: context.userId, _role: "admin" });
  return data === true;
}

export const listTradeValues = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        format: z.enum(["1qb", "sf"]).default("sf"),
        search: z.string().max(80).optional(),
        position: z.string().max(8).optional(),
        limit: z.number().int().min(1).max(400).optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const [{ data: values, error }, { data: picks }, { data: log }, { data: playerRows }] =
      await Promise.all([
        context.supabase
          .from("player_trade_values")
          .select("display_name, position, nfl_team, value, tier, overall_rank, position_rank, fetched_at")
          .eq("format", data.format)
          .order("value", { ascending: false })
          .limit(600),
        context.supabase
          .from("pick_values")
          .select("season, round, slot, value")
          .eq("format", data.format)
          .order("value", { ascending: false }),
        context.supabase
          .from("trade_value_refresh_log")
          .select("run_at, status, error, rows_upserted, scope")
          .order("run_at", { ascending: false })
          .limit(1),
        context.supabase
          .from("players")
          .select("search_name, position, proj_points_season")
          .limit(3000),
      ]);
    if (error) throw new Error(error.message);

    // Projection-implied market worth, so the table can flag who our numbers
    // like more than the dynasty market does. Calibrated onto the KTC scale
    // with the median market/projection ratio across players in both tables.
    const projByName = new Map<string, number>();
    for (const p of playerRows ?? []) {
      const projValue = fallbackValue(
        String(p.position).toUpperCase(),
        Number(p.proj_points_season ?? 0),
      );
      const nameKey = String(p.search_name);
      projByName.set(nameKey, Math.max(projByName.get(nameKey) ?? 0, projValue));
    }
    const scale = calibratedScale(
      (values ?? []).map((r) => ({
        market: Number(r.value ?? 0),
        proj: projByName.get(normalizeName(String(r.display_name))) ?? 0,
      })),
    );

    const search = normalizeName(data.search ?? "");
    const position = (data.position ?? "ALL").toUpperCase();

    const rows: TradeValueRow[] = (values ?? [])
      .filter((r) => (position === "ALL" ? true : String(r.position).toUpperCase() === position))
      .filter((r) => (search ? normalizeName(String(r.display_name)).includes(search) : true))
      .slice(0, data.limit ?? 150)
      .map((r) => {
        const value = Number(r.value ?? 0);
        const projValue = projByName.get(normalizeName(String(r.display_name))) ?? null;
        const gap = projValue === null ? null : projValue - value;
        return {
          name: String(r.display_name),
          position: String(r.position).toUpperCase(),
          nflTeam: r.nfl_team,
          value,
          tier: r.tier,
          overallRank: r.overall_rank,
          positionRank: r.position_rank,
          projValue,
          gap,
          undervalued: gap !== null && projValue! >= value * 1.25 && gap >= 400,
        };
      });

    const last = log?.[0] ?? null;
    return {
      rows,
      picks: (picks ?? []).map((p) => ({
        season: p.season,
        round: p.round,
        slot: String(p.slot),
        value: Number(p.value ?? 0),
      })) as PickValueRow[],
      total: (values ?? []).length,
      lastRefresh: last
        ? {
            at: String(last.run_at),
            status: String(last.status),
            error: last.error ?? null,
            scope: String(last.scope),
          }
        : null,
      admin: await callerIsAdmin(context),
    };
  });

/** Manual "Refresh now" — admins only. */
export const refreshTradeValuesNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    if (!(await callerIsAdmin(context))) throw new Error("Only an admin can refresh trade values.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { refreshTradeValues } = await import("@/lib/fantasy/ktc.server");
    const result = await refreshTradeValues(supabaseAdmin, "full");
    return { ok: true, ...result };
  });

/** CSV backup: name,position,value1qb,valuesf (picks use "2027 Early 1st" as the name). */
export const uploadTradeValues = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        rows: z
          .array(
            z.object({
              name: z.string().min(1).max(80),
              position: z.string().max(8).optional(),
              oneQb: z.number().min(0).max(20000).optional(),
              sf: z.number().min(0).max(20000).optional(),
            }),
          )
          .min(1)
          .max(3000),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    if (!(await callerIsAdmin(context))) throw new Error("Only an admin can upload trade values.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { saveKtcValues, parsePickName } = await import("@/lib/fantasy/ktc.server");

    const players = [] as Parameters<typeof saveKtcValues>[1]["players"];
    const picks = [] as Parameters<typeof saveKtcValues>[1]["picks"];

    for (const row of data.rows) {
      const one = row.oneQb ?? row.sf ?? 0;
      const sf = row.sf ?? row.oneQb ?? 0;
      const parsed = parsePickName(row.name);
      if (parsed && !row.position) {
        picks.push({ ...parsed, values: { "1qb": one, sf } });
        continue;
      }
      players.push({
        name: row.name,
        position: (row.position ?? "").toUpperCase(),
        nflTeam: null,
        age: null,
        values: {
          "1qb": { value: one, tier: null, overallRank: null, positionRank: null },
          sf: { value: sf, tier: null, overallRank: null, positionRank: null },
        },
      });
    }

    const saved = await saveKtcValues(supabaseAdmin, { players, picks });
    await supabaseAdmin.from("trade_value_refresh_log").insert({
      scope: "upload",
      source: "csv",
      rows_upserted: saved.players,
      picks_upserted: saved.picks,
      status: "ok",
    });
    return saved;
  });
