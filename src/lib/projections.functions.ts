/**
 * Projections: an admin-maintained baseline for every player, plus personal
 * adjustments any member can make for themselves. Adjustments apply across all
 * of that member's leagues and are layered on top of the baseline everywhere.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizeName, playerIndex } from "@/lib/fantasy/names";
import { tierFromRank, trajectoryFor, type Trajectory } from "@/lib/fantasy/age-curve";
import { loadAgeCurves } from "@/lib/fantasy/age-curve.server";
import { loadTradeValues } from "@/lib/fantasy/trade-value";

export interface BaselineRow {
  id: string;
  name: string;
  position: string;
  nflTeam: string | null;
  byeWeek: number | null;
  status: string;
  baseWeek: number;
  baseSeason: number;
  myWeek: number | null;
  mySeason: number | null;
  /** Dynasty market trajectory; null when the market knows no age. */
  trajectory: Trajectory | null;
}

async function callerIsAdmin(context: { supabase: { rpc: Function }; userId: string }) {
  const { data } = await (context.supabase as never as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: boolean | null }>;
  }).rpc("has_role", { _user_id: context.userId, _role: "admin" });
  return data === true;
}

export const amIProjectionAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => ({ admin: await callerIsAdmin(context) }));

/** Baseline table with the caller's own adjustments merged in. */
export const listProjections = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        search: z.string().max(80).optional(),
        position: z.string().max(8).optional(),
        adjustedOnly: z.boolean().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const [{ data: players, error }, { data: overrides }] = await Promise.all([
      context.supabase
        .from("players")
        .select("id, full_name, position, nfl_team, bye_week, status, proj_points_week, proj_points_season")
        .order("proj_points_season", { ascending: false }),
      context.supabase
        .from("player_projection_overrides")
        .select("player_id, proj_points_week, proj_points_season"),
    ]);
    if (error) throw new Error(error.message);

    const mine = new Map(
      (overrides ?? []).map((o) => [
        o.player_id,
        { week: Number(o.proj_points_week), season: Number(o.proj_points_season) },
      ]),
    );

    const search = data.search?.trim().toLowerCase();
    const position = data.position && data.position !== "ALL" ? data.position.toUpperCase() : null;

    const rows: BaselineRow[] = (players ?? [])
      .filter((p) => (position ? p.position.toUpperCase() === position : true))
      .filter((p) => (search ? p.full_name.toLowerCase().includes(search) : true))
      .filter((p) => (data.adjustedOnly ? mine.has(p.id) : true))
      .slice(0, data.limit ?? 100)
      .map((p) => {
        const own = mine.get(p.id);
        return {
          id: p.id,
          name: p.full_name,
          position: p.position.toUpperCase(),
          nflTeam: p.nfl_team,
          byeWeek: p.bye_week,
          status: p.status,
          baseWeek: Number(p.proj_points_week),
          baseSeason: Number(p.proj_points_season),
          myWeek: own ? own.week : null,
          mySeason: own ? own.season : null,
          trajectory: null as Trajectory | null,
        };
      });

    // Market value trajectory for the rows we are about to show.
    const [values, curves] = await Promise.all([
      loadTradeValues(context.supabase, "sf"),
      loadAgeCurves(context.supabase, "sf"),
    ]);
    for (const row of rows) {
      const age = values.age(row.id, row.name, row.position);
      const value = values.market(row.id, row.name, row.position);
      if (age == null || !value) continue;
      row.trajectory = trajectoryFor({
        position: row.position,
        age,
        value,
        tier: tierFromRank(values.positionRank(row.id, row.name, row.position), 12, row.position),
        curve: curves.curve(row.position),
      });
    }

    return { rows, total: (players ?? []).length, adjusted: mine.size, admin: await callerIsAdmin(context) };
  });

// ------------------------------------------------------------ baseline (admin)

const numberPair = z.object({
  playerId: z.string().uuid(),
  week: z.number().min(0).max(80),
  season: z.number().min(0).max(700),
});

export const updateBaseline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => numberPair.parse(d))
  .handler(async ({ data, context }) => {
    if (!(await callerIsAdmin(context))) throw new Error("Only an admin can change baseline projections.");
    const { error } = await context.supabase
      .from("players")
      .update({ proj_points_week: data.week, proj_points_season: data.season })
      .eq("id", data.playerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Very small CSV reader: handles quoted fields and commas inside quotes. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch !== "\r") field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim().length));
}

const HEADERS = {
  name: ["player", "name", "player name", "full name"],
  position: ["position", "pos"],
  week: ["week points", "week", "weekly", "proj week", "points week"],
  season: ["season points", "season", "proj season", "points season", "total"],
};

function headerIndex(header: string[], keys: string[]) {
  return header.findIndex((h) => keys.includes(h.trim().toLowerCase()));
}

/** Bulk baseline upload. Unmatched names are always reported back. */
export const bulkUpsertBaseline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ csv: z.string().min(1).max(500_000), apply: z.boolean().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    if (!(await callerIsAdmin(context))) throw new Error("Only an admin can change baseline projections.");

    const rows = parseCsv(data.csv);
    if (rows.length < 2) throw new Error("That file has no rows under the header.");
    const header = rows[0]!;
    const iName = headerIndex(header, HEADERS.name);
    const iPos = headerIndex(header, HEADERS.position);
    const iWeek = headerIndex(header, HEADERS.week);
    const iSeason = headerIndex(header, HEADERS.season);
    if (iName < 0 || (iWeek < 0 && iSeason < 0)) {
      throw new Error('The file needs a "player" column and at least one of "week points" or "season points".');
    }

    const { data: players, error } = await context.supabase
      .from("players")
      .select("id, full_name, position, proj_points_week, proj_points_season");
    if (error) throw new Error(error.message);
    const index = playerIndex(players ?? []);

    const matched: {
      playerId: string;
      name: string;
      position: string;
      week: number;
      season: number;
      fromWeek: number;
      fromSeason: number;
    }[] = [];
    const unmatched: string[] = [];

    for (const raw of rows.slice(1)) {
      const name = (raw[iName] ?? "").trim();
      if (!name || !normalizeName(name)) continue;
      const position = iPos >= 0 ? (raw[iPos] ?? "").trim() : null;
      const hit = index.find(name, position);
      if (!hit) { unmatched.push(name); continue; }
      const week = iWeek >= 0 ? Number(raw[iWeek]) : NaN;
      const season = iSeason >= 0 ? Number(raw[iSeason]) : NaN;
      const nextWeek = Number.isFinite(week) ? week : Number(hit.proj_points_week);
      const nextSeason = Number.isFinite(season) ? season : Number(hit.proj_points_season);
      matched.push({
        playerId: hit.id,
        name: hit.full_name,
        position: hit.position.toUpperCase(),
        week: Math.max(0, nextWeek),
        season: Math.max(0, nextSeason),
        fromWeek: Number(hit.proj_points_week),
        fromSeason: Number(hit.proj_points_season),
      });
    }

    if (data.apply) {
      for (const m of matched) {
        const { error: upErr } = await context.supabase
          .from("players")
          .update({ proj_points_week: m.week, proj_points_season: m.season })
          .eq("id", m.playerId);
        if (upErr) throw new Error(upErr.message);
      }
    }

    return {
      applied: !!data.apply,
      matched: matched.slice(0, 300),
      matchedCount: matched.length,
      unmatched: unmatched.slice(0, 100),
      unmatchedCount: unmatched.length,
    };
  });

// ------------------------------------------------------- personal adjustments

export const setOverride = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => numberPair.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("player_projection_overrides")
      .upsert(
        {
          user_id: context.userId,
          player_id: data.playerId,
          proj_points_week: data.week,
          proj_points_season: data.season,
        },
        { onConflict: "user_id,player_id" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const clearOverride = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ playerId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("player_projection_overrides")
      .delete()
      .eq("user_id", context.userId)
      .eq("player_id", data.playerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const clearAllOverrides = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error } = await context.supabase
      .from("player_projection_overrides")
      .delete()
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ------------------------------------------------- projection sources

/**
 * Pulls the host platform's own weekly projections (Sleeper, ESPN) into the
 * projection database so leagues set to "platform" score them with their own
 * rules. Sleeper's numbers are league-independent; ESPN's are read through one
 * of the caller's ESPN leagues.
 */
export const importPlatformProjections = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        platform: z.enum(["sleeper", "espn"]),
        season: z.number().int().min(2020).max(2100).optional(),
        fromWeek: z.number().int().min(1).max(18).optional(),
        toWeek: z.number().int().min(1).max(18).optional(),
        espnLeagueId: z.string().max(40).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    if (!(await callerIsAdmin(context))) {
      throw new Error("Only an admin can refresh platform projections.");
    }
    const { importSleeperProjections, importEspnProjections } = await import(
      "@/lib/fantasy/platform-projections.server"
    );
    const season = data.season ?? new Date().getFullYear();
    const from = data.fromWeek ?? 1;
    const to = Math.max(from, data.toWeek ?? from);

    const results: { week: number; matched: number; unmatched: number; error?: string }[] = [];
    for (let week = from; week <= to; week++) {
      try {
        const res =
          data.platform === "sleeper"
            ? await importSleeperProjections(context.supabase, season, week)
            : await importEspnProjections(
                context.supabase,
                data.espnLeagueId ?? "",
                season,
                week,
                await espnCreds(context),
              );
        results.push({ week, matched: res.matched, unmatched: res.unmatched.length });
      } catch (e) {
        results.push({ week, matched: 0, unmatched: 0, error: e instanceof Error ? e.message : "Failed" });
      }
    }
    return { platform: data.platform, season, results };
  });

async function espnCreds(context: { supabase: any; userId: string }) {
  const { data } = await context.supabase
    .from("platform_credentials")
    .select("payload")
    .eq("platform", "espn")
    .maybeSingle();
  const payload = (data?.payload ?? {}) as Record<string, string>;
  return { swid: payload["swid"] ?? null, espnS2: payload["espn_s2"] ?? null };
}

/**
 * "My projections" upload. Accepts the weekly stat template (a `week` column
 * plus stat columns) or season totals, which are split evenly across the
 * weeks that player's NFL team actually plays. Stored privately under the
 * member's own source key, and only used by leagues set to "My projections".
 */
export const uploadMyProjections = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        csv: z.string().min(1).max(2_000_000),
        season: z.number().int().min(2020).max(2100).optional(),
        apply: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { BASELINE_RULES, scoreStats } = await import("@/lib/fantasy/scoring");
    const season = data.season ?? new Date().getFullYear();

    const rows = parseCsv(data.csv);
    if (rows.length < 2) throw new Error("That file has no rows under the header.");
    const header = rows[0]!.map((h) => h.trim().toLowerCase());
    const iName = headerIndex(header, HEADERS.name);
    const iPos = headerIndex(header, HEADERS.position);
    const iWeek = header.findIndex((h) => h === "week");
    if (iName < 0) throw new Error('The file needs a "player" column.');

    const statCols = header
      .map((h, i) => ({ key: h.replace(/\s+/g, "_"), i }))
      .filter((c) => c.key in BASELINE_RULES);
    if (!statCols.length) {
      throw new Error("No stat columns were recognised. Use the weekly stats template.");
    }

    const { data: players } = await context.supabase
      .from("players")
      .select("id, full_name, position, nfl_team");
    const index = playerIndex(players ?? []);

    const { data: schedule } = await context.supabase
      .from("nfl_schedule")
      .select("week, nfl_team, opponent")
      .eq("season", season);
    const weeksByTeam = new Map<string, { week: number; opponent: string | null }[]>();
    for (const row of schedule ?? []) {
      if (!row.opponent) continue;
      const key = row.nfl_team.toUpperCase();
      const list = weeksByTeam.get(key) ?? [];
      list.push({ week: row.week, opponent: row.opponent });
      weeksByTeam.set(key, list);
    }

    const source = `user:${context.userId}`;
    const out: Record<string, unknown>[] = [];
    const unmatched: string[] = [];
    let matchedCount = 0;

    for (const raw of rows.slice(1)) {
      const name = (raw[iName] ?? "").trim();
      if (!name || !normalizeName(name)) continue;
      const hit = index.find(name, iPos >= 0 ? (raw[iPos] ?? "").trim() : null);
      if (!hit) { unmatched.push(name); continue; }

      const stats: Record<string, number> = {};
      for (const col of statCols) {
        const n = Number(raw[col.i]);
        if (Number.isFinite(n) && n !== 0) stats[col.key] = n;
      }
      matchedCount++;

      const push = (week: number, line: Record<string, number>, opponent: string | null) =>
        out.push({
          player_id: hit.id,
          season,
          week,
          opponent,
          stats: line,
          src_points: Math.round(scoreStats(line, BASELINE_RULES, hit.position) * 100) / 100,
          source,
        });

      if (iWeek >= 0) {
        const week = Number(raw[iWeek]);
        if (!Number.isFinite(week) || week < 1 || week > 18) continue;
        const games = weeksByTeam.get((hit.nfl_team ?? "").toUpperCase()) ?? [];
        push(week, stats, games.find((g) => g.week === week)?.opponent ?? null);
      } else {
        // Season totals: spread them across the weeks this team actually plays.
        const games = weeksByTeam.get((hit.nfl_team ?? "").toUpperCase()) ?? [];
        const play = games.length ? games : Array.from({ length: 17 }, (_, i) => ({ week: i + 1, opponent: null }));
        for (const g of play) {
          const per: Record<string, number> = {};
          for (const [k, v] of Object.entries(stats)) per[k] = Math.round((v / play.length) * 1000) / 1000;
          push(g.week, per, g.opponent);
        }
      }
    }

    if (data.apply && out.length) {
      for (let i = 0; i < out.length; i += 500) {
        const { error } = await context.supabase
          .from("player_week_stats")
          .upsert(out.slice(i, i + 500) as never, { onConflict: "player_id,season,week,source" });
        if (error) throw new Error(error.message);
      }
    }

    return {
      applied: !!data.apply,
      season,
      mode: iWeek >= 0 ? ("weekly" as const) : ("season" as const),
      matchedCount,
      rowsWritten: out.length,
      unmatched: unmatched.slice(0, 100),
      unmatchedCount: unmatched.length,
    };
  });

/** Removes every projection this member has uploaded. */
export const clearMyProjections = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error } = await context.supabase
      .from("player_week_stats")
      .delete()
      .eq("source", `user:${context.userId}`);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
