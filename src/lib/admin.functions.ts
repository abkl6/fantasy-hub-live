/**
 * Admin console. Every handler re-checks the caller's admin role — the route
 * guard is only UX, and RLS on the admin tables is the real boundary.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizeName, playerIndex } from "@/lib/fantasy/names";

type Ctx = { supabase: { rpc: Function }; userId: string };

async function assertAdmin(context: Ctx) {
  const { data } = await (
    context.supabase as never as {
      rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: boolean | null }>;
    }
  ).rpc("has_role", { _user_id: context.userId, _role: "admin" });
  if (data !== true) throw new Error("Admins only.");
}

export const amIAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await (
      context.supabase as never as {
        rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: boolean | null }>;
      }
    ).rpc("has_role", { _user_id: context.userId, _role: "admin" });
    return { admin: data === true };
  });

const DAY = 24 * 60 * 60 * 1000;

// ------------------------------------------------------------------ overview

export const getAdminOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const since = new Date(Date.now() - 7 * DAY).toISOString();
    const dayAgo = new Date(Date.now() - DAY).toISOString();

    const [{ data: profiles }, { data: leagues }, { data: errors }, { data: notifications }] =
      await Promise.all([
        context.supabase.from("profiles").select("id, display_name, created_at"),
        context.supabase
          .from("leagues")
          .select("id, platform, user_id, last_synced_at, updated_at, last_sync_error"),
        context.supabase.from("job_errors").select("id, created_at, platform").gte("created_at", dayAgo),
        context.supabase.from("notification_log").select("id, created_at").gte("created_at", dayAgo),
      ]);

    const active = new Set(
      (leagues ?? [])
        .filter((l) => (l.last_synced_at ?? l.updated_at ?? "") >= since)
        .map((l) => l.user_id),
    );

    const byPlatform = new Map<string, { platform: string; leagues: number; lastSync: string | null; failing: number }>();
    for (const league of leagues ?? []) {
      const key = league.platform;
      const entry = byPlatform.get(key) ?? { platform: key, leagues: 0, lastSync: null, failing: 0 };
      entry.leagues += 1;
      if (league.last_sync_error) entry.failing += 1;
      if (league.last_synced_at && (!entry.lastSync || league.last_synced_at > entry.lastSync)) {
        entry.lastSync = league.last_synced_at;
      }
      byPlatform.set(key, entry);
    }

    return {
      users: (profiles ?? []).length,
      activeThisWeek: active.size,
      leagues: (leagues ?? []).length,
      errors24h: (errors ?? []).length,
      notifications24h: (notifications ?? []).length,
      platforms: [...byPlatform.values()].sort((a, b) => b.leagues - a.leagues),
      newUsers7d: (profiles ?? []).filter((p) => p.created_at >= since).length,
    };
  });

// --------------------------------------------------------------- sync health

export const getSyncHealth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const [{ data: leagues }, { data: profiles }] = await Promise.all([
      context.supabase
        .from("leagues")
        .select("id, name, platform, user_id, season, current_week, last_synced_at, last_sync_error, external_id")
        .order("last_synced_at", { ascending: true, nullsFirst: true }),
      context.supabase.from("profiles").select("id, display_name"),
    ]);
    const names = new Map((profiles ?? []).map((p) => [p.id, p.display_name ?? "Member"]));
    const stale = Date.now() - DAY;

    return {
      leagues: (leagues ?? []).map((l) => {
        const syncedAt = l.last_synced_at ? new Date(l.last_synced_at).getTime() : 0;
        const status = l.last_sync_error ? "error" : !syncedAt ? "never" : syncedAt < stale ? "stale" : "ok";
        return {
          id: l.id,
          name: l.name,
          platform: l.platform,
          userId: l.user_id,
          ownerName: names.get(l.user_id) ?? "Member",
          season: l.season,
          week: l.current_week,
          lastSyncedAt: l.last_synced_at,
          error: l.last_sync_error,
          status,
          externalId: l.external_id,
        };
      }),
    };
  });

export const adminResyncLeague = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ leagueId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: league } = await supabaseAdmin
      .from("leagues")
      .select("id, platform, user_id")
      .eq("id", data.leagueId)
      .maybeSingle();
    if (!league) throw new Error("That league no longer exists.");

    try {
      if (league.platform === "ffpc") {
        const { refreshFfpcLeague } = await import("./fantasy/ffpc-sync.server");
        const result = await refreshFfpcLeague(supabaseAdmin, league.user_id, league.id);
        if (!result.refreshed) throw new Error(result.reason ?? "FFPC re-sync failed");
      } else if (league.platform === "sleeper") {
        const { refreshSleeperLeague } = await import("./fantasy/sleeper-sync.server");
        await refreshSleeperLeague(supabaseAdmin, league.user_id, league.id);
      } else {
        const { syncLeagueRosters } = await import("./fantasy/rosters.server");
        await syncLeagueRosters(supabaseAdmin, league.user_id, league.id);
      }
      await supabaseAdmin
        .from("leagues")
        .update({ last_synced_at: new Date().toISOString(), last_sync_error: null })
        .eq("id", league.id);
      return { ok: true, error: null as string | null };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await supabaseAdmin.from("leagues").update({ last_sync_error: message }).eq("id", league.id);
      await supabaseAdmin.from("job_errors").insert({
        source: "admin-resync",
        platform: league.platform,
        scope: league.id,
        message,
        user_id: league.user_id,
      } as never);
      return { ok: false, error: message };
    }
  });

/** Read-only look at one member's leagues, for chasing a support question. */
export const adminViewAsUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: profile }, { data: leagues }, { data: teams }] = await Promise.all([
      supabaseAdmin.from("profiles").select("id, display_name, created_at").eq("id", data.userId).maybeSingle(),
      supabaseAdmin
        .from("leagues")
        .select("id, name, platform, season, current_week, last_synced_at, last_sync_error")
        .eq("user_id", data.userId),
      supabaseAdmin
        .from("teams")
        .select("id, league_id, name, is_mine, wins, losses, ties, points_for")
        .eq("user_id", data.userId),
    ]);
    return {
      profile: profile ?? null,
      leagues: (leagues ?? []).map((l) => ({
        ...l,
        myTeam: (teams ?? []).find((t) => t.league_id === l.id && t.is_mine) ?? null,
        teams: (teams ?? []).filter((t) => t.league_id === l.id).length,
      })),
    };
  });

// ---------------------------------------------------------------------- data

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
  team: ["team", "nfl team", "nfl"],
  week: ["week points", "week", "weekly", "proj week", "points week"],
  season: ["season points", "season", "proj season", "points season", "total"],
};

const headerIndex = (header: string[], keys: string[]) =>
  header.findIndex((h) => keys.includes(h.trim().toLowerCase()));

interface BatchRow {
  playerId: string;
  name: string;
  week: number;
  season: number;
}

/** Applies a batch's numbers onto the shared player baseline. */
async function applyBatch(
  supabase: { from: Function },
  rows: BatchRow[],
) {
  for (const row of rows) {
    await (supabase as never as { from: Function })
      .from("players")
      .update({ proj_points_week: row.week, proj_points_season: row.season })
      .eq("id", row.playerId);
  }
}

export const uploadProjectionBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        csv: z.string().min(1).max(1_000_000),
        label: z.string().min(1).max(80),
        source: z.string().min(1).max(40),
        season: z.number().int().min(2024).max(2040),
        week: z.number().int().min(1).max(18).nullable().optional(),
        published: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);

    const parsed = parseCsv(data.csv);
    if (parsed.length < 2) throw new Error("That file has no rows under the header.");
    const header = parsed[0]!;
    const iName = headerIndex(header, HEADERS.name);
    const iPos = headerIndex(header, HEADERS.position);
    const iTeam = headerIndex(header, HEADERS.team);
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

    const rows: BatchRow[] = [];
    const unmatched: { raw_name: string; position: string | null; nfl_team: string | null; payload: unknown }[] = [];

    for (const raw of parsed.slice(1)) {
      const name = (raw[iName] ?? "").trim();
      if (!name || !normalizeName(name)) continue;
      const position = iPos >= 0 ? (raw[iPos] ?? "").trim() : null;
      const week = iWeek >= 0 ? Number(raw[iWeek]) : NaN;
      const season = iSeason >= 0 ? Number(raw[iSeason]) : NaN;
      const hit = index.find(name, position);
      if (!hit) {
        unmatched.push({
          raw_name: name,
          position: position || null,
          nfl_team: iTeam >= 0 ? (raw[iTeam] ?? "").trim() || null : null,
          payload: { week: Number.isFinite(week) ? week : null, season: Number.isFinite(season) ? season : null },
        });
        continue;
      }
      rows.push({
        playerId: hit.id,
        name: hit.full_name,
        week: Math.max(0, Number.isFinite(week) ? week : Number(hit.proj_points_week)),
        season: Math.max(0, Number.isFinite(season) ? season : Number(hit.proj_points_season)),
      });
    }

    const { data: batch, error: batchError } = await context.supabase
      .from("projection_batches")
      .insert({
        source: data.source,
        label: data.label,
        season: data.season,
        week: data.week ?? null,
        published: !!data.published,
        row_count: rows.length + unmatched.length,
        matched_count: rows.length,
        uploaded_by: context.userId,
        rows: rows as never,
      } as never)
      .select("id")
      .single();
    if (batchError) throw new Error(batchError.message);

    if (unmatched.length) {
      await context.supabase
        .from("unmatched_players")
        .insert(unmatched.map((u) => ({ ...u, batch_id: batch.id })) as never);
    }
    if (data.published) await applyBatch(context.supabase, rows);

    return { batchId: batch.id, matched: rows.length, unmatched: unmatched.length };
  });

export const setBatchPublished = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ batchId: z.string().uuid(), published: z.boolean() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { data: batch } = await context.supabase
      .from("projection_batches")
      .select("id, rows")
      .eq("id", data.batchId)
      .maybeSingle();
    if (!batch) throw new Error("That upload no longer exists.");

    await context.supabase
      .from("projection_batches")
      .update({ published: data.published })
      .eq("id", data.batchId);
    if (data.published) await applyBatch(context.supabase, (batch.rows ?? []) as unknown as BatchRow[]);
    return { ok: true };
  });

export const getAdminData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const season = new Date().getUTCFullYear();
    const [{ data: batches }, { data: queue }, { data: schedule }, { data: defense }] = await Promise.all([
      context.supabase
        .from("projection_batches")
        .select("id, label, source, season, week, published, row_count, matched_count, created_at")
        .order("created_at", { ascending: false })
        .limit(25),
      context.supabase
        .from("unmatched_players")
        .select("id, raw_name, position, nfl_team, payload, status, created_at")
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(100),
      context.supabase.from("nfl_schedule").select("season, week, nfl_team, opponent").eq("season", season),
      context.supabase
        .from("defense_ranks")
        .select("id, season, week, nfl_team, rank, points_allowed")
        .eq("season", season)
        .order("rank"),
    ]);

    const weeks = new Map<number, number>();
    for (const row of schedule ?? []) weeks.set(row.week, (weeks.get(row.week) ?? 0) + 1);

    return {
      season,
      batches: batches ?? [],
      queue: queue ?? [],
      scheduleWeeks: [...weeks.entries()].map(([week, teams]) => ({ week, teams })).sort((a, b) => a.week - b.week),
      defense: defense ?? [],
    };
  });

export const resolveUnmatchedPlayer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        playerId: z.string().uuid().nullable().optional(),
        dismiss: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (data.dismiss || !data.playerId) {
      await context.supabase.from("unmatched_players").update({ status: "dismissed" }).eq("id", data.id);
      return { ok: true, applied: false };
    }

    const { data: row } = await context.supabase
      .from("unmatched_players")
      .select("id, payload")
      .eq("id", data.id)
      .maybeSingle();
    const payload = (row?.payload ?? {}) as { week?: number | null; season?: number | null };
    const patch: Record<string, number> = {};
    if (typeof payload.week === "number") patch['proj_points_week'] = Math.max(0, payload.week);
    if (typeof payload.season === "number") patch['proj_points_season'] = Math.max(0, payload.season);
    if (Object.keys(patch).length) {
      await context.supabase.from("players").update(patch as never).eq("id", data.playerId);
    }
    await context.supabase
      .from("unmatched_players")
      .update({ status: "resolved", resolved_player_id: data.playerId })
      .eq("id", data.id);
    return { ok: true, applied: Object.keys(patch).length > 0 };
  });

export const searchPlayersForMatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ search: z.string().min(2).max(60) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { data: players } = await context.supabase
      .from("players")
      .select("id, full_name, position, nfl_team")
      .ilike("full_name", `%${data.search.trim()}%`)
      .limit(15);
    return { players: players ?? [] };
  });

export const saveScheduleRow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        season: z.number().int().min(2024).max(2040),
        week: z.number().int().min(1).max(18),
        nflTeam: z.string().min(2).max(4),
        opponent: z.string().max(5).nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const team = data.nflTeam.toUpperCase();
    await context.supabase
      .from("nfl_schedule")
      .delete()
      .eq("season", data.season)
      .eq("week", data.week)
      .eq("nfl_team", team);
    const { error } = await context.supabase.from("nfl_schedule").insert({
      season: data.season,
      week: data.week,
      nfl_team: team,
      opponent: data.opponent ? data.opponent.toUpperCase() : null,
    } as never);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const saveDefenseRank = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        season: z.number().int().min(2024).max(2040),
        week: z.number().int().min(0).max(18),
        nflTeam: z.string().min(2).max(4),
        rank: z.number().int().min(1).max(32),
        pointsAllowed: z.number().min(0).max(100),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await context.supabase.from("defense_ranks").upsert(
      {
        season: data.season,
        week: data.week,
        nfl_team: data.nflTeam.toUpperCase(),
        rank: data.rank,
        points_allowed: data.pointsAllowed,
      } as never,
      { onConflict: "season,week,nfl_team" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Re-applies every published upload, newest last, onto the player baseline. */
export const recomputeProjections = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { data: batches } = await context.supabase
      .from("projection_batches")
      .select("id, rows, created_at")
      .eq("published", true)
      .order("created_at", { ascending: true });

    let applied = 0;
    for (const batch of batches ?? []) {
      const rows = (batch.rows ?? []) as unknown as BatchRow[];
      await applyBatch(context.supabase, rows);
      applied += rows.length;
    }
    return { batches: (batches ?? []).length, players: applied };
  });

// ------------------------------------------------------------- notifications

export const getAdminNotifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const [{ data: log }, { data: profiles }, { data: subs }] = await Promise.all([
      context.supabase
        .from("notification_log")
        .select("id, user_id, kind, title, body, url, created_at")
        .order("created_at", { ascending: false })
        .limit(100),
      context.supabase.from("profiles").select("id, display_name"),
      context.supabase.from("push_subscriptions").select("id, user_id, user_agent, created_at"),
    ]);
    const names = new Map((profiles ?? []).map((p) => [p.id, p.display_name ?? "Member"]));
    return {
      devices: (subs ?? []).length,
      log: (log ?? []).map((row) => ({ ...row, ownerName: names.get(row.user_id) ?? "Member" })),
    };
  });

export const sendTestNotification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ userId: z.string().uuid().optional(), body: z.string().max(120).optional() }).parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { notifyUser, loadPrefs } = await import("./push/notify.server");
    const target = data.userId ?? context.userId;
    const prefs = await loadPrefs(supabaseAdmin, [target]);
    const sent = await notifyUser(supabaseAdmin, target, prefs.get(target)!, {
      kind: "lineup_lock",
      title: "Gridiron Edge test",
      body: data.body || "Alerts are working on this device.",
      url: "/gameday",
      dedupeKey: `test:${target}:${Date.now()}`,
    });
    return { sent };
  });

// -------------------------------------------------------------------- errors

export const getAdminErrors = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ platform: z.string().max(20).optional() }).parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    let query = context.supabase
      .from("job_errors")
      .select("id, source, platform, scope, message, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (data.platform && data.platform !== "all") query = query.eq("platform", data.platform);
    const [{ data: errors }, { data: syncErrors }] = await Promise.all([
      query,
      context.supabase
        .from("leagues")
        .select("id, name, platform, last_sync_error, last_synced_at")
        .not("last_sync_error", "is", null),
    ]);
    return {
      errors: errors ?? [],
      leagueErrors: (syncErrors ?? []).filter(
        (l) => !data.platform || data.platform === "all" || l.platform === data.platform,
      ),
    };
  });
