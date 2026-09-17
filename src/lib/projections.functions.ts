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
  /** Which set the shown base number came from. */
  basis: "app" | "user";
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
        /** Which set of numbers to show. Defaults to the caller's own upload when they have one. */
        source: z.enum(["app", "user"]).optional(),
        season: z.number().int().min(2020).max(2100).optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const season = data.season ?? new Date().getFullYear();
    const userSource = `user:${context.userId}`;
    const [{ data: players, error }, { data: overrides }, { data: uploadSeason }, { data: uploadWeeks }] =
      await Promise.all([
        context.supabase
          .from("players")
          .select("id, full_name, position, nfl_team, bye_week, status, proj_points_week, proj_points_season")
          .order("proj_points_season", { ascending: false }),
        context.supabase
          .from("player_projection_overrides")
          .select("player_id, proj_points_week, proj_points_season"),
        context.supabase
          .from("player_season_projections")
          .select("player_id, src_points")
          .eq("season", season)
          .eq("source", userSource),
        context.supabase
          .from("player_week_stats")
          .select("player_id, src_points")
          .eq("season", season)
          .eq("source", userSource),
      ]);
    if (error) throw new Error(error.message);

    const mine = new Map(
      (overrides ?? []).map((o) => [
        o.player_id,
        { week: Number(o.proj_points_week), season: Number(o.proj_points_season) },
      ]),
    );

    // The caller's own uploaded file: season totals stay whole, weekly files add up.
    const uploaded = new Map<string, { season: number; weeks: number }>();
    for (const row of uploadSeason ?? []) {
      uploaded.set(row.player_id, { season: Number(row.src_points), weeks: 0 });
    }
    for (const row of uploadWeeks ?? []) {
      const prev = uploaded.get(row.player_id) ?? { season: 0, weeks: 0 };
      uploaded.set(row.player_id, {
        season: prev.season + Number(row.src_points),
        weeks: prev.weeks + 1,
      });
    }
    const hasUpload = uploaded.size > 0;
    const source: "app" | "user" = data.source ?? (hasUpload ? "user" : "app");
    const useUpload = source === "user" && hasUpload;

    const search = data.search?.trim().toLowerCase();
    const position = data.position && data.position !== "ALL" ? data.position.toUpperCase() : null;

    const rows: BaselineRow[] = (players ?? [])
      .filter((p) => (position ? p.position.toUpperCase() === position : true))
      .filter((p) => (search ? p.full_name.toLowerCase().includes(search) : true))
      .filter((p) => (data.adjustedOnly ? mine.has(p.id) : true))
      .map((p) => {
        const own = mine.get(p.id);
        const up = useUpload ? uploaded.get(p.id) : undefined;
        const appSeason = Number(p.proj_points_season);
        const appWeek = Number(p.proj_points_week);
        return {
          id: p.id,
          name: p.full_name,
          position: p.position.toUpperCase(),
          nflTeam: p.nfl_team,
          byeWeek: p.bye_week,
          status: p.status,
          baseWeek: up ? up.season / (up.weeks > 0 ? up.weeks : 17) : appWeek,
          baseSeason: up ? up.season : appSeason,
          myWeek: own ? own.week : null,
          mySeason: own ? own.season : null,
          basis: up ? ("user" as const) : ("app" as const),
          trajectory: null as Trajectory | null,
        };
      })
      .sort((a, b) => (useUpload ? b.baseSeason - a.baseSeason : 0))
      .slice(0, data.limit ?? 100);

    // Market value trajectory for the rows we are about to show.
    const { loadAgeCurves } = await import("@/lib/fantasy/age-curve.server");
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

    return {
      rows,
      total: (players ?? []).length,
      adjusted: mine.size,
      source,
      uploadedCount: uploaded.size,
      season,
      admin: await callerIsAdmin(context),
    };
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
 * "My projections" upload. Accepts any of the four templates (offence, team
 * defence, individual defenders, kickers), either week by week (a `week`
 * column) or as season totals. Season totals are stored whole; each league
 * splits them into weeks when it reads them, so turning schedule adjustment on
 * or off never needs a re-upload. Stored privately under the member's own
 * source key, and only used by leagues set to "My projections".
 */
export const uploadMyProjections = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        csv: z.string().min(1).max(8_000_000),
        season: z.number().int().min(2020).max(2100).optional(),
        apply: z.boolean().optional(),
        group: z.enum(["offense", "dst", "idp", "k"]).optional(),
      })
      .parse(d),
  )

  .handler(async ({ data, context }) => {
    const { BASELINE_RULES, scoreStats } = await import("@/lib/fantasy/scoring");
    const season = data.season ?? new Date().getFullYear();

    const { detectGroup, mapHeaders, GROUP_LABEL } = await import(
      "@/lib/fantasy/projection-templates"
    );

    const rows = parseCsv(data.csv);
    if (rows.length < 2) throw new Error("That file has no rows under the header.");
    const rawHeader = rows[0]!.map((h) => h.trim());
    const header = rawHeader.map((h) => h.toLowerCase());
    const iName = headerIndex(header, HEADERS.name);
    const iPos = headerIndex(header, HEADERS.position);
    const iWeek = header.findIndex((h) => h === "week");
    const iOpp = header.findIndex((h) => h === "opponent" || h === "opp");
    if (iName < 0) throw new Error('The file needs a "name" or "player" column.');

    const detected = detectGroup(rawHeader);
    const group = data.group ?? detected;
    if (!group) {
      throw new Error(
        "The columns in this file were not recognised. Download a template and use its headings.",
      );
    }
    if (data.group && detected && detected !== data.group) {
      throw new Error(
        `That file looks like the ${GROUP_LABEL[detected]} template, not ${GROUP_LABEL[data.group]}.`,
      );
    }

    // Template columns first, then anything else that is already a scoring key.
    const mapped = mapHeaders(group, rawHeader);
    const statCols = [
      ...mapped.map((m) => ({ key: m.key, i: m.index })),
      ...header
        .map((h, i) => ({ key: h.replace(/\s+/g, "_"), i }))
        .filter((c) => c.key in BASELINE_RULES && !mapped.some((m) => m.index === c.i)),
    ];
    if (!statCols.length) {
      throw new Error(
        `No stat columns were recognised for ${GROUP_LABEL[group]}. Download that template and use its headings.`,
      );
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
    const recognised = statCols.map((c) => rawHeader[c.i] ?? "").filter(Boolean);
    const unrecognised = rawHeader.filter(
      (h, i) =>
        h && !statCols.some((c) => c.i === i) && i !== iName && i !== iPos && i !== iWeek && i !== iOpp,
    );
    const seenPos = new Set<string>();
    const preview: { name: string; position: string; points: number }[] = [];
    const weekOut: Record<string, unknown>[] = [];
    const seasonOut: Record<string, unknown>[] = [];
    const unmatched: string[] = [];
    const unmatchedSeen = new Set<string>();
    const previewSeen = new Set<string>();
    const matchedSeen = new Set<string>();
    let matchedCount = 0;

    for (const raw of rows.slice(1)) {
      const name = (raw[iName] ?? "").trim();
      if (!name || !normalizeName(name)) continue;
      const hit = index.find(name, iPos >= 0 ? (raw[iPos] ?? "").trim() : null);
      if (!hit) {
        // Weekly files repeat every player on every week — report each once.
        if (!unmatchedSeen.has(name)) { unmatchedSeen.add(name); unmatched.push(name); }
        continue;
      }

      const stats: Record<string, number> = {};
      for (const col of statCols) {
        const n = Number(raw[col.i]);
        if (Number.isFinite(n) && n !== 0) stats[col.key] = n;
      }
      // Weekly files hold one row per player per week — count players once.
      matchedSeen.add(hit.id);
      matchedCount = matchedSeen.size;
      seenPos.add(hit.position.toUpperCase());
      const points = Math.round(scoreStats(stats, BASELINE_RULES, hit.position) * 100) / 100;
      if (!previewSeen.has(hit.id)) {
        previewSeen.add(hit.id);
        preview.push({ name: hit.full_name ?? name, position: hit.position.toUpperCase(), points });
      }

      if (iWeek >= 0) {
        const week = Number(raw[iWeek]);
        if (!Number.isFinite(week) || week < 1 || week > 18) continue;
        // A file that names its own opponent column wins over the stored
        // schedule — these uploads often carry fresher fixtures.
        const fileOpp = iOpp >= 0 ? (raw[iOpp] ?? "").trim().toUpperCase() : "";
        const games = weeksByTeam.get((hit.nfl_team ?? "").toUpperCase()) ?? [];
        weekOut.push({
          player_id: hit.id,
          season,
          week,
          opponent:
            fileOpp && !["BYE", "-", "--"].includes(fileOpp)
              ? fileOpp
              : (games.find((g) => g.week === week)?.opponent ?? null),
          stats,
          src_points: points,
          source,
        });
      } else {
        // Season totals are kept whole. Each league splits them at read time,
        // evenly or shaped by its own schedule setting.
        seasonOut.push({ player_id: hit.id, season, stats, src_points: points, source });
      }
    }

    // A file that silently lost a whole stat category is worse than no file at
    // all: every player in that category ends up priced far too low.
    const haveKeys = new Set(statCols.map((c) => c.key));
    const missing: string[] = [];
    if (group === "offense") {
      if (seenPos.has("QB") && !haveKeys.has("pass_yd")) missing.push("passing yards");
      if (seenPos.has("RB") && !haveKeys.has("rush_yd")) missing.push("rushing yards");
      if ((seenPos.has("WR") || seenPos.has("TE")) && !haveKeys.has("rec_yd")) {
        missing.push("receiving yards");
      }
    }
    if (group === "k" && !haveKeys.has("fg_made")) missing.push("field goals made");
    if (missing.length) {
      throw new Error(
        `No column for ${missing.join(" or ")} was recognised, so those points would all be lost. ` +
          `Columns read: ${recognised.join(", ") || "none"}. ` +
          `Columns not recognised: ${unrecognised.join(", ") || "none"}. ` +
          `Rename them to match the template headings and upload again.`,
      );
    }

    if (data.apply) {
      const { error: batchError } = await context.supabase.from("projection_batches").insert({
        source,
        label: `${GROUP_LABEL[group]} · ${iWeek >= 0 ? "weekly" : "season totals"}`,
        season,
        published: true,
        row_count: weekOut.length + seasonOut.length,
        matched_count: matchedCount,
        uploaded_by: context.userId,
        rows: {
          recognised,
          unrecognised,
          unmatchedCount: unmatched.length,
          preview: preview.slice(0, 10),
        },
      } as never);
      if (batchError) throw new Error(batchError.message);

      for (let i = 0; i < weekOut.length; i += 500) {
        const { error } = await context.supabase
          .from("player_week_stats")
          .upsert(weekOut.slice(i, i + 500) as never, {
            onConflict: "player_id,season,week,source",
          });
        if (error) throw new Error(error.message);
      }
      for (let i = 0; i < seasonOut.length; i += 500) {
        const { error } = await context.supabase
          .from("player_season_projections")
          .upsert(seasonOut.slice(i, i + 500) as never, {
            onConflict: "player_id,season,source",
          });
        if (error) throw new Error(error.message);
      }

      // Fresh numbers in — every cached screen built on the old ones must go.
      await context.supabase.from("analysis_cache").delete().eq("user_id", context.userId);
    }

    return {
      applied: !!data.apply,
      season,
      group,
      groupLabel: GROUP_LABEL[group],
      mode: iWeek >= 0 ? ("weekly" as const) : ("season" as const),
      matchedCount,
      rowsWritten: weekOut.length + seasonOut.length,
      unmatched: unmatched.slice(0, 100),
      unmatchedCount: unmatched.length,
      recognised,
      unrecognised,
      preview: [...preview].sort((a, b) => b.points - a.points).slice(0, 8),
    };
  });


/**
 * A schedule grid (one row per NFL team, one column per week) replaces the
 * stored fixture list for the season. These files often travel with stat-line
 * projection packs and carry the freshest fixtures, which schedule adjustment
 * and Game Day both read.
 */
export const uploadOpponentGrid = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        csv: z.string().min(1).max(500_000),
        season: z.number().int().min(2020).max(2100).optional(),
        apply: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    if (!(await callerIsAdmin(context))) {
      throw new Error("Only an admin can replace the season schedule.");
    }
    const season = data.season ?? new Date().getFullYear();
    const { parseOpponentGrid, detectOpponentGrid } = await import(
      "@/lib/fantasy/projection-templates"
    );
    const header = (data.csv.split(/\r?\n/)[0] ?? "").split(",");
    if (!detectOpponentGrid(header)) {
      throw new Error(
        "That file is not a schedule grid — it needs a team column and one column per week (Wk1, Wk2, …).",
      );
    }
    const grid = parseOpponentGrid(data.csv);
    if (!grid.length) throw new Error("No team rows were found in that file.");

    const rows = grid.flatMap((team) =>
      team.opponents.map((o) => ({
        season,
        week: o.week,
        nfl_team: team.nflTeam,
        opponent: o.opponent,
      })),
    );

    if (data.apply) {
      const weeks = [...new Set(rows.map((r) => r.week))];
      for (const week of weeks) {
        const { error: delErr } = await context.supabase
          .from("nfl_schedule")
          .delete()
          .eq("season", season)
          .eq("week", week);
        if (delErr) throw new Error(delErr.message);
      }
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await context.supabase
          .from("nfl_schedule")
          .insert(rows.slice(i, i + 500) as never);
        if (error) throw new Error(error.message);
      }
      await context.supabase.from("analysis_cache").delete().eq("user_id", context.userId);
    }

    return {
      applied: !!data.apply,
      season,
      teams: grid.length,
      rows: rows.length,
      byes: rows.filter((r) => r.opponent === null).length,
      weeks: [...new Set(rows.map((r) => r.week))].sort((a, b) => a - b),
    };
  });

// ------------------------------------------------- templates & schedule strength

/**
 * A ready-to-fill spreadsheet for one group: every current player with their
 * name, position, team and bye already in place, and blank stat columns for
 * the season total.
 */
export const projectionTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ group: z.enum(["offense", "dst", "idp", "k"]) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { templateColumns, templateHeaderRow, GROUP_POSITIONS, GROUP_LABEL } = await import(
      "@/lib/fantasy/projection-templates"
    );
    const positions = GROUP_POSITIONS[data.group];
    const { data: players, error } = await context.supabase
      .from("players")
      .select("full_name, position, nfl_team, bye_week, proj_points_season")
      .in("position", positions)
      .order("proj_points_season", { ascending: false });
    if (error) throw new Error(error.message);

    const blanks = templateColumns(data.group).length - 5;
    const lines = [templateHeaderRow(data.group)];
    for (const p of players ?? []) {
      const team = (p.nfl_team ?? "").toUpperCase();
      const name = p.full_name.includes(",") ? `"${p.full_name}"` : p.full_name;
      lines.push(
        [
          `${p.full_name.replace(/,/g, "")}|${team}`,
          name,
          p.position.toUpperCase(),
          team,
          p.bye_week ?? "",
          ...Array(blanks).fill(""),
        ].join(","),
      );
    }
    return {
      group: data.group,
      label: GROUP_LABEL[data.group],
      filename: `${data.group}_season_projections.csv`,
      csv: lines.join("\n"),
      players: (players ?? []).length,
    };
  });

/** The printable column reference, straight from the template definitions. */
export const templateReference = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { TEMPLATE_GROUPS, GROUP_LABEL, templateColumns } = await import(
      "@/lib/fantasy/projection-templates"
    );
    return {
      groups: TEMPLATE_GROUPS.map((g) => ({
        group: g,
        label: GROUP_LABEL[g],
        columns: templateColumns(g),
      })),
    };
  });

/** How tough every NFL team is to face, per position group. */
export const listScheduleStrength = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ season: z.number().int().min(2020).max(2100).optional() }).parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const season = data.season ?? new Date().getFullYear();
    const { data: rows, error } = await context.supabase
      .from("team_position_strength")
      .select("nfl_team, position_group, multiplier, source, updated_at")
      .eq("season", season)
      .order("nfl_team");
    if (error) throw new Error(error.message);
    return {
      season,
      rows: (rows ?? []).map((r) => ({
        team: r.nfl_team,
        group: r.position_group,
        multiplier: Number(r.multiplier),
        source: r.source,
        updatedAt: r.updated_at,
      })),
      admin: await callerIsAdmin(context),
    };
  });

/** Admin: recompute schedule strength from the current projection database. */
export const refreshScheduleStrength = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ season: z.number().int().min(2020).max(2100).optional() }).parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    if (!(await callerIsAdmin(context))) {
      throw new Error("Only an admin can refresh schedule strength.");
    }
    const { refreshTeamStrength } = await import("@/lib/fantasy/sos.server");
    const season = data.season ?? new Date().getFullYear();
    const res = await refreshTeamStrength(context.supabase, season, ["app", `user:${context.userId}`]);
    return { season, ...res };
  });

/**
 * Admin: seed last season's fantasy points allowed per game. CSV columns:
 * `nfl_team, position_group, points_allowed_per_game, games`.
 */
export const uploadPriorStrength = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        csv: z.string().min(1).max(2_000_000),
        season: z.number().int().min(2020).max(2100).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    if (!(await callerIsAdmin(context))) {
      throw new Error("Only an admin can upload last season's points allowed.");
    }
    const { savePriorStrength } = await import("@/lib/fantasy/sos.server");
    const { POSITION_GROUPS } = await import("@/lib/fantasy/sos");
    const season = data.season ?? new Date().getFullYear();

    const rows = parseCsv(data.csv);
    if (rows.length < 2) throw new Error("That file has no rows under the header.");
    const header = rows[0]!.map((h) => h.trim().toLowerCase());
    const iTeam = header.findIndex((h) => h === "nfl_team" || h === "team");
    const iGroup = header.findIndex((h) => h === "position_group" || h === "pos" || h === "position");
    const iPer = header.findIndex(
      (h) => h === "points_allowed_per_game" || h === "pts_allowed_per_game" || h === "per_game",
    );
    const iGames = header.findIndex((h) => h === "games");
    if (iTeam < 0 || iGroup < 0 || iPer < 0) {
      throw new Error(
        "That file needs nfl_team, position_group and points_allowed_per_game columns.",
      );
    }

    const valid = new Set<string>(POSITION_GROUPS);
    const parsed: { team: string; group: (typeof POSITION_GROUPS)[number]; perGame: number; games?: number }[] = [];
    const skipped: string[] = [];
    for (const raw of rows.slice(1)) {
      const team = (raw[iTeam] ?? "").trim().toUpperCase();
      const group = (raw[iGroup] ?? "").trim().toUpperCase();
      const perGame = Number(raw[iPer]);
      if (!team || !valid.has(group) || !Number.isFinite(perGame) || perGame <= 0) {
        if (team || group) skipped.push(`${team} ${group}`.trim());
        continue;
      }
      const games = iGames >= 0 ? Number(raw[iGames]) : NaN;
      parsed.push({
        team,
        group: group as (typeof POSITION_GROUPS)[number],
        perGame,
        ...(Number.isFinite(games) && games > 0 ? { games } : {}),
      });
    }

    const res = await savePriorStrength(context.supabase, season, parsed);
    return { season, ...res, skipped: skipped.slice(0, 20), skippedCount: skipped.length };
  });

/** Removes every projection this member has uploaded. */
export const clearMyProjections = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const source = `user:${context.userId}`;
    const { error } = await context.supabase
      .from("player_week_stats")
      .delete()
      .eq("source", source);
    if (error) throw new Error(error.message);
    const { error: seasonError } = await context.supabase
      .from("player_season_projections")
      .delete()
      .eq("source", source);
    if (seasonError) throw new Error(seasonError.message);

    return { ok: true };
  });

/** Points every one of this member's leagues at the same projection set. */
export const setProjectionSourceEverywhere = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ source: z.enum(["platform", "app", "user"]) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("leagues")
      .update({ projection_source: data.source } as never)
      .eq("user_id", context.userId)
      .select("id");
    if (error) throw new Error(error.message);
    // Cached analysis was built on the old numbers.
    await context.supabase.from("analysis_cache").delete().eq("user_id", context.userId);
    return { updated: rows?.length ?? 0 };
  });
