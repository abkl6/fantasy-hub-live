import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { LEAGUE_FORMATS } from "@/lib/fantasy/format";
import {
  asLeagueType,
  asVariant,
  detectLeagueType,
  effectiveFormat,
  LEAGUE_TYPES,
  LEAGUE_VARIANTS,
  typeSourceLabel,
} from "@/lib/fantasy/league-type";
import {
  asSettingsSource,
  markUserSettings,
  type DetectableSetting,
} from "@/lib/fantasy/league-settings";
import { normalizeName, playerKey } from "@/lib/fantasy/names";
import { LEAGUE_COLOR_KEYS } from "@/lib/league-colors";

const DEFAULT_PROJ: Record<string, number> = {
  QB: 16, RB: 9, WR: 9, TE: 6.5, K: 8, DEF: 7, DST: 7,
};

function projFor(position: string) {
  return DEFAULT_PROJ[position.toUpperCase()] ?? 6;
}

/** Sleeper marks keeper/dynasty with settings.type and best ball with a flag. */
function sleeperFormat(settings: Record<string, unknown> | undefined) {
  if (!settings) return "redraft";
  if (Number(settings["best_ball"] ?? 0) === 1) return "best_ball";
  const type = Number(settings["type"] ?? 0);
  if (type === 2) return "dynasty";
  if (type === 1) return "keeper";
  return "redraft";
}

/** Picks traded for a later season only exist in leagues that keep rosters. */
async function sleeperHasFuturePicks(leagueId: string, season: number) {
  try {
    const res = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/traded_picks`);
    if (!res.ok) return false;
    const picks = (await res.json()) as { season?: string }[];
    return (picks ?? []).some((p) => Number(p.season ?? 0) > season);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- leagues

export const listLeagues = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("leagues")
      .select("id, name, platform, season, current_week, team_count, last_synced_at, color")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const ids = (data ?? []).map((l) => l.id);
    if (!ids.length) return [];
    const { data: teams } = await context.supabase
      .from("teams")
      .select("league_id, name, wins, losses, ties, is_mine")
      .in("league_id", ids)
      .eq("is_mine", true);

    return (data ?? []).map((l) => {
      const mine = (teams ?? []).find((t) => t.league_id === l.id);
      return {
        ...l,
        myTeamName: mine?.name ?? null,
        myRecord: mine ? (mine.ties ? `${mine.wins}-${mine.losses}-${mine.ties}` : `${mine.wins}-${mine.losses}`) : null,
      };
    });
  });

export const getAnalysis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ leagueId: z.string().uuid(), force: z.boolean().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { buildAnalysis } = await import("./fantasy/analysis.server");
    const { syncLeagueRosters } = await import("./fantasy/rosters.server");
    const { syncPlayerNews } = await import("./fantasy/sleeper.server");
    const { refreshSleeperLeague, SLEEPER_STALE_MS } = await import("./fantasy/sleeper-sync.server");

    // Pull trades, adds and lineup changes back from Sleeper when the stored
    // copy has gone stale (or the user asked for a refresh).
    const { data: meta } = await context.supabase
      .from("leagues")
      .select("platform, last_synced_at")
      .eq("id", data.leagueId)
      .maybeSingle();
    const age = meta?.last_synced_at ? Date.now() - new Date(meta.last_synced_at).getTime() : Infinity;
    if (meta?.platform === "sleeper" && (data.force || age > SLEEPER_STALE_MS)) {
      await refreshSleeperLeague(context.supabase, context.userId, data.leagueId).catch(() => {});
    }

    // Backfill any team still missing a roster so availability stays accurate.
    await syncLeagueRosters(context.supabase, context.userId, data.leagueId);
    // Refresh injury/status data in the background.
    await syncPlayerNews(context.supabase).catch(() => {});
    return buildAnalysis(context.supabase, data.leagueId);
  });

export const deleteLeague = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ leagueId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("leagues").delete().eq("id", data.leagueId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Keeps guillotine FAAB balances current for leagues that don't report them. */
export const updateFaab = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        leagueId: z.string().uuid(),
        budget: z.number().int().min(1).max(100000).optional(),
        teamId: z.string().uuid().optional(),
        remaining: z.number().int().min(0).max(100000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    if (data.budget != null) {
      const { error } = await context.supabase
        .from("leagues")
        .update({ faab_budget: data.budget })
        .eq("id", data.leagueId);
      if (error) throw new Error(error.message);
    }
    if (data.teamId && data.remaining != null) {
      const { error } = await context.supabase
        .from("teams")
        .update({ faab_remaining: data.remaining })
        .eq("id", data.teamId)
        .eq("league_id", data.leagueId);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

// ---------------------------------------------------------------- sleeper

export const findSleeperLeagues = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ username: z.string().min(1).max(60) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { sleeperUserLeagues, sleeperCurrentWeek } = await import("./fantasy/sleeper.server");
    const state = await sleeperCurrentWeek();
    let res = await sleeperUserLeagues(data.username, state.season);
    if (!res.leagues.length) {
      const prior = String(Number(state.season) - 1);
      res = await sleeperUserLeagues(data.username, prior);
      return { season: prior, week: state.week, leagues: res.leagues, userId: res.userId };
    }
    return { season: state.season, week: state.week, leagues: res.leagues, userId: res.userId };
  });

export const importSleeperLeague = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        sleeperLeagueId: z.string().min(1),
        sleeperUserId: z.string().min(1).optional(),
        sleeperUsername: z.string().min(1).max(60).optional(),
        season: z.string().min(4).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const {
      sleeperLeagueBundle,
      sleeperPlayers,
      sleeperCurrentWeek,
      sleeperUserId: resolveSleeperUserId,
      normalizeSlots,
    } = await import("./fantasy/sleeper.server");
    const supabase = context.supabase;
    const userId = context.userId;

    const state = await sleeperCurrentWeek();
    const season = data.season ?? state.season;
    // "Add by ID" can pass a username instead of the numeric Sleeper id.
    const ownerId =
      data.sleeperUserId ??
      (data.sleeperUsername ? await resolveSleeperUserId(data.sleeperUsername) : null);
    const week = Number(season) === Number(state.season) ? state.week : 17;
    const [bundle, playerMap] = await Promise.all([
      sleeperLeagueBundle(data.sleeperLeagueId, week),
      sleeperPlayers(),
    ]);

    const slots = normalizeSlots(bundle.league.roster_positions ?? []);
    const playoffTeams = Number(bundle.league.settings?.["playoff_teams"] ?? 6);
    const regularWeeks = Number(bundle.league.settings?.["playoff_week_start"] ?? 15) - 1;

    // League type: Sleeper's own setting, plus future picks as a dynasty tell.
    const sleeperSettings = bundle.league.settings as Record<string, unknown> | undefined;
    const detectedType = detectLeagueType({
      sleeperType: sleeperSettings?.["type"] == null ? null : Number(sleeperSettings["type"]),
      hasFuturePicks: await sleeperHasFuturePicks(data.sleeperLeagueId, Number(season)),
      typeDescription: bundle.league.name,
    });
    const { data: priorLeague } = await supabase
      .from("leagues")
      .select("league_type, variant, type_source")
      .eq("platform", "sleeper")
      .eq("external_id", data.sleeperLeagueId)
      .maybeSingle();
    const keepUserType = priorLeague?.type_source === "user";
    const leagueType = keepUserType
      ? (priorLeague!.league_type as "redraft" | "keeper" | "dynasty")
      : detectedType.leagueType;
    const variant = keepUserType
      ? (priorLeague!.variant as "none" | "empire" | "guillotine")
      : detectedType.variant;
    const typeSource = keepUserType ? "user" : detectedType.typeSource;
    const storedFormat = sleeperFormat(sleeperSettings);

    // Replace any prior import of this league.
    await supabase
      .from("leagues")
      .delete()
      .eq("platform", "sleeper")
      .eq("external_id", data.sleeperLeagueId);

    // Give each league its own accent: pick the least-used color so far.
    const { data: existingLeagues } = await supabase.from("leagues").select("color");
    const used = new Map<string, number>(LEAGUE_COLOR_KEYS.map((key) => [key, 0]));
    for (const row of existingLeagues ?? []) {
      if (row.color && used.has(row.color)) used.set(row.color, used.get(row.color)! + 1);
    }
    const color = [...used.entries()].sort((a, b) => a[1] - b[1])[0]![0];

    const { data: league, error: leagueError } = await supabase
      .from("leagues")
      .insert({
        user_id: userId,
        platform: "sleeper",
        external_id: data.sleeperLeagueId,
        name: bundle.league.name,
        season: Number(season),
        color,
        current_week: week,
        team_count: bundle.league.total_rosters,
        playoff_teams: playoffTeams,
        regular_season_weeks: Math.max(regularWeeks, 8),
        scoring_type: (bundle.league.scoring_settings?.["rec"] ?? 0) >= 1 ? "ppr" : (bundle.league.scoring_settings?.["rec"] ?? 0) > 0 ? "half_ppr" : "standard",
        scoring_rules: bundle.league.scoring_settings ?? {},
        roster_slots: slots.length ? slots : ["QB","RB","RB","WR","WR","TE","FLEX","K","DEF"],
        format: effectiveFormat(leagueType, variant, storedFormat),
        league_type: leagueType,
        variant,
        type_source: typeSource,
        // Sleeper best-ball leagues are decided on total points, not matchups.
        contest_format:
          Number(
            (bundle.league.settings as Record<string, unknown> | undefined)?.["best_ball"] ?? 0,
          ) === 1
            ? "points"
            : "h2h",
        last_synced_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (leagueError || !league) throw new Error(leagueError?.message ?? "Could not save the league.");

    const { data: canonical } = await supabase.from("players").select("id, full_name, position, proj_points_week");
    const canonicalMap = new Map(
      (canonical ?? []).map((p) => [playerKey(p.full_name, p.position), p]),
    );

    const userById = new Map(bundle.users.map((u) => [u.user_id, u]));
    const teamInserts = bundle.rosters.map((r) => {
      const owner = r.owner_id ? userById.get(r.owner_id) : undefined;
      const s = r.settings ?? {};
      return {
        league_id: league.id,
        user_id: userId,
        external_id: String(r.roster_id),
        name: owner?.metadata?.team_name || owner?.display_name || `Team ${r.roster_id}`,
        owner_name: owner?.display_name ?? null,
        is_mine: !!ownerId && r.owner_id === ownerId,
        wins: s.wins ?? 0,
        losses: s.losses ?? 0,
        ties: s.ties ?? 0,
        points_for: Number(`${s.fpts ?? 0}.${s.fpts_decimal ?? 0}`),
        points_against: Number(`${s.fpts_against ?? 0}.${s.fpts_against_decimal ?? 0}`),
      };
    });

    const { data: insertedTeams, error: teamError } = await supabase
      .from("teams")
      .insert(teamInserts)
      .select("id, external_id");
    if (teamError) throw new Error(teamError.message);

    const teamByExternal = new Map((insertedTeams ?? []).map((t) => [t.external_id, t.id]));

    const spotInserts: Record<string, unknown>[] = [];
    for (const r of bundle.rosters) {
      const teamId = teamByExternal.get(String(r.roster_id));
      if (!teamId) continue;
      const starters = new Set((r.starters ?? []).filter((p) => p && p !== "0"));
      for (const pid of r.players ?? []) {
        const sp = playerMap[pid];
        if (!sp?.full_name || !sp.position) continue;
        const key = playerKey(sp.full_name, sp.position);
        const match = canonicalMap.get(key);
        spotInserts.push({
          team_id: teamId,
          league_id: league.id,
          user_id: userId,
          player_id: match?.id ?? null,
          player_name: sp.full_name,
          position: sp.position.toUpperCase(),
          nfl_team: sp.team ?? null,
          slot: starters.has(pid) ? "START" : "BN",
          is_starter: starters.has(pid),
          proj_points: match ? Number(match.proj_points_week) : projFor(sp.position),
        });
      }
    }
    if (spotInserts.length) {
      const { error } = await supabase.from("roster_spots").insert(spotInserts as never);
      if (error) throw new Error(error.message);
    }

    const matchupInserts: Record<string, unknown>[] = [];
    for (const wk of bundle.matchups) {
      const groups = new Map<number, typeof wk.entries>();
      for (const e of wk.entries) {
        if (e.matchup_id == null) continue;
        const list = groups.get(e.matchup_id) ?? [];
        list.push(e);
        groups.set(e.matchup_id, list);
      }
      for (const pair of groups.values()) {
        if (pair.length < 2) continue;
        const [a, b] = pair;
        matchupInserts.push({
          league_id: league.id,
          user_id: userId,
          week: wk.week,
          home_team_id: teamByExternal.get(String(a!.roster_id)) ?? null,
          away_team_id: teamByExternal.get(String(b!.roster_id)) ?? null,
          home_score: a!.points ?? 0,
          away_score: b!.points ?? 0,
          is_final: wk.week < week,
        });
      }
    }
    if (matchupInserts.length) {
      await supabase.from("matchups").insert(matchupInserts as never);
    }

    const { syncLeagueRosters } = await import("./fantasy/rosters.server");
    await syncLeagueRosters(supabase, userId, league.id);

    return { leagueId: league.id, name: league.name };
  });

// ---------------------------------------------------------------- manual

const manualSchema = z.object({
  name: z.string().min(1).max(80),
  platform: z.string().min(1).max(20),
  teamCount: z.number().int().min(2).max(20),
  playoffTeams: z.number().int().min(2).max(12),
  regularSeasonWeeks: z.number().int().min(4).max(18),
  currentWeek: z.number().int().min(1).max(18),
  scoringType: z.string().min(1).max(20),
  scoringRules: z.record(z.string(), z.number()).optional(),
  rosterSlots: z.array(z.string()).min(1).max(25),
  myTeamName: z.string().min(1).max(60),
  opponentNames: z.array(z.string()).optional(),
  format: z.enum(LEAGUE_FORMATS).optional(),
});

export const createManualLeague = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => manualSchema.parse(d))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;
    const { data: league, error } = await supabase
      .from("leagues")
      .insert({
        user_id: context.userId,
        platform: data.platform,
        name: data.name,
        season: new Date().getFullYear(),
        current_week: data.currentWeek,
        team_count: data.teamCount,
        playoff_teams: data.playoffTeams,
        regular_season_weeks: data.regularSeasonWeeks,
        scoring_type: data.scoringType,
        scoring_rules: data.scoringRules ?? {},
        roster_slots: data.rosterSlots,
        format: data.format ?? "redraft",
        league_type:
          data.format === "dynasty" || data.format === "keeper" ? data.format : "redraft",
        variant: data.format === "guillotine" ? "guillotine" : "none",
        type_source: "user",
        last_synced_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (error || !league) throw new Error(error?.message ?? "Could not create the league.");

    const names = [data.myTeamName, ...(data.opponentNames ?? [])];
    while (names.length < data.teamCount) names.push(`Team ${names.length + 1}`);

    const { data: teams, error: teamError } = await supabase
      .from("teams")
      .insert(
        names.slice(0, data.teamCount).map((n, i) => ({
          league_id: league.id,
          user_id: context.userId,
          name: n,
          is_mine: i === 0,
        })),
      )
      .select("id, is_mine");
    if (teamError) throw new Error(teamError.message);

    const { syncLeagueRosters } = await import("./fantasy/rosters.server");
    await syncLeagueRosters(supabase, context.userId, league.id);

    return { leagueId: league.id, myTeamId: (teams ?? []).find((t) => t.is_mine)?.id ?? null };
  });

const rosterPlayerSchema = z.object({
  name: z.string().min(1).max(60),
  position: z.string().min(1).max(6),
  nflTeam: z.string().max(6).nullable().optional(),
  slot: z.string().max(12).optional(),
  isStarter: z.boolean().optional(),
});

export const saveRoster = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        leagueId: z.string().uuid(),
        teamId: z.string().uuid(),
        players: z.array(rosterPlayerSchema).max(40),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;
    const { data: canonical } = await supabase
      .from("players")
      .select("id, full_name, position, proj_points_week, nfl_team");
    const byKey = new Map(
      (canonical ?? []).map((p) => [playerKey(p.full_name, p.position), p]),
    );
    const byName = new Map((canonical ?? []).map((p) => [normalizeName(p.full_name), p]));

    await supabase.from("roster_spots").delete().eq("team_id", data.teamId);

    if (data.players.length) {
      const rows = data.players.map((p) => {
        const match =
          byKey.get(playerKey(p.name, p.position)) ?? byName.get(normalizeName(p.name));
        return {
          team_id: data.teamId,
          league_id: data.leagueId,
          user_id: context.userId,
          player_id: match?.id ?? null,
          player_name: match?.full_name ?? p.name,
          position: (match?.position ?? p.position).toUpperCase(),
          nfl_team: p.nflTeam ?? match?.nfl_team ?? null,
          slot: p.slot ?? (p.isStarter ? "START" : "BN"),
          is_starter: p.isStarter ?? false,
          proj_points: match ? Number(match.proj_points_week) : projFor(p.position),
        };
      });
      const { error } = await supabase.from("roster_spots").insert(rows as never);
      if (error) throw new Error(error.message);
    }

    const { syncLeagueRosters } = await import("./fantasy/rosters.server");
    await syncLeagueRosters(supabase, context.userId, data.leagueId);

    return { saved: data.players.length };
  });

export const getWaiverWire = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        leagueId: z.string().uuid(),
        search: z.string().max(60).optional(),
        position: z.string().max(6).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { leagueWaiverWire } = await import("./fantasy/rosters.server");
    const players = await leagueWaiverWire(context.supabase, data.leagueId, {
      ...(data.search ? { search: data.search } : {}),
      ...(data.position ? { position: data.position } : {}),
      limit: 50,
    });
    const { count } = await context.supabase
      .from("roster_spots")
      .select("id", { count: "exact", head: true })
      .eq("league_id", data.leagueId)
      .eq("is_auto", true);
    return { players, estimatedRosterSpots: count ?? 0 };
  });

/** Just the league type fields, so the selects never wait on a full recompute. */
export const getLeagueMeta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ leagueId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("leagues")
      .select(
        "league_type, variant, type_source, format, platform, playoff_week_start, playoff_weeks, playoff_teams, playoff_byes, third_place_game, consolation, waiver_type, waiver_run_times, divisions, playoff_seed_type, rules_text, settings_source, all_play_weeks, regular_season_weeks",
      )
      .eq("id", data.leagueId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("League not found.");
    const leagueType = asLeagueType(row.league_type);
    const variant = asVariant(row.variant);
    const typeSource = (row.type_source ?? "inferred") as "detected" | "inferred" | "user";
    return {
      leagueType,
      variant,
      typeSource,
      typeSourceLabel: typeSourceLabel(typeSource, row.platform),
      format: String(row.format),
      playoff: {
        weekStart: row.playoff_week_start ?? null,
        weeks: (row.playoff_weeks ?? []) as number[],
        teams: row.playoff_teams ?? 0,
        byes: row.playoff_byes ?? 0,
        thirdPlaceGame: Boolean(row.third_place_game),
        consolation: (row.consolation ?? []) as { label: string; weeks: number[]; prize: string | null }[],
        seedType: row.playoff_seed_type ?? null,
        divisions: (row.divisions ?? []) as string[],
        allPlayWeeks: (row.all_play_weeks ?? []) as number[],
        regularSeasonWeeks: row.regular_season_weeks ?? 0,
        waiverType: row.waiver_type ?? null,
        waiverRunTimes: (row.waiver_run_times ?? []) as string[],
        rulesText: row.rules_text ?? null,
        source: asSettingsSource(row.settings_source),
      },
    };
  });

export const updateLeagueSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        leagueId: z.string().uuid(),
        currentWeek: z.number().int().min(1).max(18).optional(),
        scoringRules: z.record(z.string(), z.number()).optional(),
        rosterSlots: z.array(z.string()).optional(),
        scoringType: z.string().max(20).optional(),
        format: z.enum(LEAGUE_FORMATS).optional(),
        leagueType: z.enum(LEAGUE_TYPES).optional(),
        variant: z.enum(LEAGUE_VARIANTS).optional(),
        color: z.string().max(20).optional(),
        projectionSource: z.enum(["platform", "app", "user"]).optional(),
        sosAdjust: z.boolean().optional(),
        contestFormat: z.enum(["h2h", "points", "hybrid"]).optional(),
        pointsPlayoffTeams: z.number().int().min(0).max(32).nullable().optional(),
        pointsPlayoffWeek: z.number().int().min(1).max(18).nullable().optional(),
        weeklyHighBonus: z.boolean().optional(),
        weeklyHighLabel: z.string().max(40).nullable().optional(),
        playoffWeekStart: z.number().int().min(1).max(18).nullable().optional(),
        playoffTeams: z.number().int().min(0).max(32).optional(),
        playoffByes: z.number().int().min(0).max(8).optional(),
        thirdPlaceGame: z.boolean().optional(),
        allPlayWeeks: z.array(z.number().int().min(1).max(18)).max(18).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const patch: Record<string, unknown> = {};
    // Playoff rules the manager sets by hand are marked as theirs so a later
    // platform sync leaves them alone.
    const userSettings: DetectableSetting[] = [];
    if (data.playoffWeekStart !== undefined) {
      patch["playoff_week_start"] = data.playoffWeekStart;
      userSettings.push("playoff_week_start");
      if (data.playoffWeekStart) {
        patch["regular_season_weeks"] = data.playoffWeekStart - 1;
        userSettings.push("regular_season_weeks");
      }
    }
    if (data.playoffTeams !== undefined) {
      patch["playoff_teams"] = data.playoffTeams;
      userSettings.push("playoff_teams");
    }
    if (data.playoffByes !== undefined) {
      patch["playoff_byes"] = data.playoffByes;
      userSettings.push("playoff_byes");
    }
    if (data.thirdPlaceGame !== undefined) {
      patch["third_place_game"] = data.thirdPlaceGame;
      userSettings.push("third_place_game");
    }
    if (data.allPlayWeeks !== undefined) {
      patch["all_play_weeks"] = [...new Set(data.allPlayWeeks)].sort((a, b) => a - b);
      userSettings.push("all_play_weeks");
    }
    if (data.contestFormat !== undefined) userSettings.push("contest_format");
    if (userSettings.length) {
      const { data: currentSettings } = await context.supabase
        .from("leagues")
        .select("settings_source")
        .eq("id", data.leagueId)
        .maybeSingle();
      patch["settings_source"] = markUserSettings(currentSettings?.settings_source, userSettings);
    }
    if (data.contestFormat !== undefined) patch["contest_format"] = data.contestFormat;
    if (data.pointsPlayoffTeams !== undefined)
      patch["points_playoff_teams"] = data.pointsPlayoffTeams || null;
    if (data.pointsPlayoffWeek !== undefined) patch["points_playoff_week"] = data.pointsPlayoffWeek;
    if (data.weeklyHighBonus !== undefined) patch["weekly_high_bonus"] = data.weeklyHighBonus;
    if (data.weeklyHighLabel !== undefined)
      patch["weekly_high_label"] = data.weeklyHighLabel?.trim() || null;
    if (data.currentWeek !== undefined) patch["current_week"] = data.currentWeek;
    if (data.scoringRules !== undefined) patch["scoring_rules"] = data.scoringRules;
    if (data.rosterSlots !== undefined) patch["roster_slots"] = data.rosterSlots;
    if (data.scoringType !== undefined) patch["scoring_type"] = data.scoringType;
    if (data.format !== undefined) patch["format"] = data.format;
    if (data.color !== undefined) patch["color"] = data.color;
    if (data.projectionSource !== undefined) patch["projection_source"] = data.projectionSource;
    if (data.sosAdjust !== undefined) patch["sos_adjust"] = data.sosAdjust;

    // Any hand-set league type is final: later syncs must not overwrite it.
    if (data.leagueType !== undefined || data.variant !== undefined) {
      const { data: current } = await context.supabase
        .from("leagues")
        .select("league_type, variant, format")
        .eq("id", data.leagueId)
        .maybeSingle();
      const leagueType = asLeagueType(data.leagueType ?? current?.league_type);
      const variant = asVariant(data.variant ?? current?.variant);
      patch["league_type"] = leagueType;
      patch["variant"] = variant;
      patch["type_source"] = "user";
      patch["format"] = effectiveFormat(leagueType, variant, current?.format);
    }

    const { error } = await context.supabase
      .from("leagues")
      .update(patch as never)
      .eq("id", data.leagueId);
    if (error) throw new Error(error.message);

    // Fallback path: a dynasty/keeper switch needs market values too.
    if (data.leagueType !== undefined || data.variant !== undefined) {
      const { ensureTradeValuesInBackground } = await import("./fantasy/ktc.server");
      ensureTradeValuesInBackground({ scope: data.leagueId, userId: context.userId });
    }
    return { ok: true };
  });

export const getLeagueTeams = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ leagueId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: teams, error } = await context.supabase
      .from("teams")
      .select("id, name, is_mine, wins, losses, ties")
      .eq("league_id", data.leagueId)
      .order("is_mine", { ascending: false });
    if (error) throw new Error(error.message);
    const { data: spots } = await context.supabase
      .from("roster_spots")
      .select("team_id, player_name, position, nfl_team, is_starter, proj_points")
      .eq("league_id", data.leagueId);
    return (teams ?? []).map((t) => ({
      ...t,
      roster: (spots ?? []).filter((s) => s.team_id === t.id),
    }));
  });

// ---------------------------------------------------------------- trades

export const evaluateTradeFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        leagueId: z.string().uuid(),
        giveNames: z.array(z.string().min(1)).min(1).max(5),
        getNames: z.array(z.string().min(1)).min(1).max(5),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { evaluateTrade } = await import("./fantasy/analysis.server");

    // Resolve the incoming players against the league's rosters first, then
    // the canonical player list, so the simulation uses real projections.
    const [{ data: spots }, { data: canonical }] = await Promise.all([
      context.supabase
        .from("roster_spots")
        .select("player_name, position, proj_points, team_id")
        .eq("league_id", data.leagueId),
      context.supabase.from("players").select("full_name, position, proj_points_week"),
    ]);

    const incoming = data.getNames.map((raw) => {
      const key = normalizeName(raw);
      const spot = (spots ?? []).find((s) => normalizeName(s.player_name) === key);
      if (spot) {
        return { name: spot.player_name, position: spot.position.toUpperCase(), proj: Number(spot.proj_points) };
      }
      const player = (canonical ?? []).find((p) => normalizeName(p.full_name) === key);
      if (player) {
        return {
          name: player.full_name,
          position: player.position.toUpperCase(),
          proj: Number(player.proj_points_week),
        };
      }
      throw new Error(`We could not find a player called "${raw.trim()}".`);
    });

    const result = await evaluateTrade(context.supabase, data.leagueId, data.giveNames, incoming);
    return { ...result, incoming };
  });

// ---------------------------------------------------------------- screenshots

const SCREENSHOT_MODELS = "google/gemini-3.8-flash";

export const readScreenshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        mode: z.enum(["roster", "scoring", "text"]),
        images: z.array(z.string().min(20)).min(1).max(4),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) throw new Error("AI is not configured for this project yet.");

    const rosterPrompt = `You are reading a screenshot of a fantasy football roster.
Return ONLY minified JSON of this exact shape:
{"players":[{"name":"Full Name","position":"QB|RB|WR|TE|K|DEF","nflTeam":"KC","slot":"QB|RB|WR|TE|FLEX|K|DEF|BN","isStarter":true,"confidence":0.0}]}
Rules: use the player's real full NFL name; team defenses use the city+nickname as name and position DEF; slot BN means bench; confidence is 0-1 for how certain you are of the row. No commentary.`;

    const scoringPrompt = `You are reading a screenshot of fantasy football league scoring settings.
Return ONLY minified JSON of this exact shape:
{"scoringType":"ppr|half_ppr|standard","rules":{"pass_yd":0.04,"pass_td":4,"rec":1,"rush_yd":0.1,"rec_yd":0.1,"rush_td":6,"rec_td":6,"int":-2,"fum_lost":-2},"rosterSlots":["QB","RB","RB","WR","WR","TE","FLEX","K","DEF"],"confidence":0.0}
Include every scoring rule you can read using short snake_case keys and numeric values. Only include rosterSlots if the screenshot shows starting lineup slots. No commentary.`;

    const textPrompt = `You are reading a screenshot from a fantasy football site: a draft board, a schedule, a transaction log or a roster.
Return ONLY minified JSON of this exact shape: {"lines":["one row of the screenshot per entry"]}
Keep each row on its own line exactly as shown, including team names, dates, player names, positions and NFL teams. Keep team headings as their own line ending with a colon. No commentary.`;

    const prompt =
      data.mode === "roster" ? rosterPrompt : data.mode === "scoring" ? scoringPrompt : textPrompt;

    const body = {
      model: SCREENSHOT_MODELS,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            ...data.images.map((img) => ({ type: "image_url", image_url: { url: img } })),
          ],
        },
      ],
    };

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
        "X-Lovable-AIG-SDK": "fetch",
      },
      body: JSON.stringify(body),
    });

    if (res.status === 429) throw new Error("Too many requests right now — try again in a moment.");
    if (res.status === 402) throw new Error("AI credits are used up. Add credits to keep using screenshot import.");
    if (!res.ok) throw new Error(`Could not read the screenshot (${res.status}).`);

    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = json.choices?.[0]?.message?.content ?? "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Nothing readable was found in that screenshot.");

    let parsed: unknown;
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      throw new Error("Nothing readable was found in that screenshot.");
    }
    const rosterShape = z.object({
      players: z
        .array(
          z.object({
            name: z.string(),
            position: z.string(),
            nflTeam: z.string().nullish(),
            slot: z.string().nullish(),
            isStarter: z.boolean().nullish(),
            confidence: z.number().nullish(),
          }),
        )
        .default([]),
    });
    const scoringShape = z.object({
      scoringType: z.string().nullish(),
      rules: z.record(z.string(), z.number()).default({}),
      rosterSlots: z.array(z.string()).nullish(),
      confidence: z.number().nullish(),
    });

    if (data.mode === "text") {
      const out = z.object({ lines: z.array(z.string()).default([]) }).safeParse(parsed);
      if (!out.success || !out.data.lines.length) {
        throw new Error("Nothing readable was found in that screenshot.");
      }
      return {
        mode: "text" as const,
        players: null,
        scoring: null,
        text: out.data.lines.join("\n"),
      };
    }

    if (data.mode === "roster") {
      const out = rosterShape.safeParse(parsed);
      if (!out.success) throw new Error("That screenshot did not look like a roster.");
      return {
        mode: "roster" as const,
        players: out.data.players.map((p) => ({
          name: p.name,
          position: p.position.toUpperCase(),
          nflTeam: p.nflTeam ?? null,
          slot: p.slot ?? null,
          isStarter: p.isStarter ?? false,
          confidence: p.confidence ?? 1,
        })),
        scoring: null,
        text: null,
      };
    }

    const out = scoringShape.safeParse(parsed);
    if (!out.success) throw new Error("That screenshot did not look like league scoring settings.");
    return {
      mode: "scoring" as const,
      players: null,
      scoring: {
        scoringType: out.data.scoringType ?? "ppr",
        rules: out.data.rules,
        rosterSlots: out.data.rosterSlots ?? null,
        confidence: out.data.confidence ?? 1,
      },
      text: null,
    };
  });

export const getWaiverBoard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        leagueId: z.string().uuid(),
        search: z.string().max(60).optional(),
        position: z.string().max(6).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { buildWaiverBoard } = await import("./fantasy/waivers.server");
    return buildWaiverBoard(context.supabase, data.leagueId, {
      ...(data.search ? { search: data.search } : {}),
      ...(data.position ? { position: data.position } : {}),
      limit: 60,
    });
  });

// ---------------------------------------------------------------- playoff + trends

export const getPlayoffPictureFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ leagueId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { loadPlayoffPicture } = await import("./fantasy/playoff.server");
    return loadPlayoffPicture(context.supabase, data.leagueId);
  });

export const getTrendsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ leagueId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows } = await context.supabase
      .from("weekly_snapshots")
      .select("week, team_id, title_odds, playoff_odds, proj_wins, power_score, teams(name, is_mine)")
      .eq("league_id", data.leagueId)
      .order("week", { ascending: true });

    const snapshots = (rows ?? []).map((r) => ({
      week: r.week,
      teamId: r.team_id,
      name: (r.teams as { name: string; is_mine: boolean }).name,
      isMine: (r.teams as { name: string; is_mine: boolean }).is_mine,
      titleOdds: Number(r.title_odds),
      playoffOdds: Number(r.playoff_odds),
      projWins: Number(r.proj_wins),
      powerScore: Number(r.power_score),
    }));

    const byTeam = new Map<string, typeof snapshots>();
    for (const s of snapshots) {
      const list = byTeam.get(s.teamId) ?? [];
      list.push(s);
      byTeam.set(s.teamId, list);
    }

    return {
      weeks: [...new Set(snapshots.map((s) => s.week))].sort((a, b) => a - b),
      series: [...byTeam.values()].map((list) => ({
        teamId: list[0]!.teamId,
        name: list[0]!.name,
        isMine: list[0]!.isMine,
        points: list.map((s) => ({ week: s.week, titleOdds: s.titleOdds, playoffOdds: s.playoffOdds, projWins: s.projWins })),
      })),
    };
  });

export const syncPlayerNewsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { syncPlayerNews } = await import("./fantasy/sleeper.server");
    return syncPlayerNews(context.supabase);
  });

// ---------------------------------------------------------------- draft

export const importSleeperDraftFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ leagueId: z.string().uuid(), sleeperLeagueId: z.string().min(1) }).parse(d))
  .handler(async ({ data, context }) => {
    const { sleeperDraft, sleeperPlayers } = await import("./fantasy/sleeper.server");
    const supabase = context.supabase;

    const { data: league } = await supabase.from("leagues").select("id, user_id, team_count").eq("id", data.leagueId).single();
    if (!league) throw new Error("League not found.");

    const { data: teams } = await supabase.from("teams").select("id, external_id").eq("league_id", data.leagueId);
    const teamByExternal = new Map((teams ?? []).map((t) => [String(t.external_id), t.id]));

    const draft = await sleeperDraft(data.sleeperLeagueId);
    if (!draft) throw new Error("No draft found for this Sleeper league.");

    const playerMap = await sleeperPlayers();
    const { data: canonical } = await supabase.from("players").select("id, full_name, position, proj_points_season, sleeper_id");
    const bySleeperId = new Map((canonical ?? []).filter((p) => p.sleeper_id).map((p) => [p.sleeper_id, p]));
    const byName = new Map((canonical ?? []).map((p) => [normalizeName(p.full_name), p]));

    const picks = draft.picks.map((pick) => {
      const meta = pick.metadata ?? {};
      const name = [meta.first_name, meta.last_name].filter(Boolean).join(" ") || "Unknown";
      const position = (meta.position ?? "-").toUpperCase();
      const sleeperPlayer = playerMap[pick.player_id];
      const match = bySleeperId.get(pick.player_id) ?? byName.get(normalizeName(name)) ?? byName.get(normalizeName(sleeperPlayer?.full_name));
      return {
        user_id: league.user_id,
        league_id: data.leagueId,
        team_id: teamByExternal.get(String(pick.roster_id)) ?? null,
        pick_number: pick.pick_no,
        round: pick.round,
        player_name: match?.full_name ?? name,
        position: match?.position ?? position,
        nfl_team: meta.team ?? sleeperPlayer?.team ?? null,
        proj_points_season: match ? Number(match.proj_points_season) : 0,
        value_vs_adp: 0,
      };
    });

    // Simple value vs ADP: projected season points relative to pick expectation.
    const sorted = [...picks].sort((a, b) => b.proj_points_season - a.proj_points_season);
    const totalPicks = picks.length;
    for (let i = 0; i < picks.length; i++) {
      const rank = sorted.findIndex((p) => p.pick_number === picks[i]!.pick_number);
      const expectedRank = picks[i]!.pick_number;
      picks[i]!.value_vs_adp = totalPicks > 0 ? (expectedRank - (rank + 1)) / totalPicks : 0;
    }

    await supabase.from("draft_picks").delete().eq("league_id", data.leagueId);
    if (picks.length) {
      const { error } = await supabase.from("draft_picks").insert(picks as never);
      if (error) throw new Error(error.message);
    }

    return { picks: picks.length };
  });

export const getDraftRecapFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ leagueId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows } = await context.supabase
      .from("draft_picks")
      .select("*, teams(name, is_mine)")
      .eq("league_id", data.leagueId)
      .order("pick_number", { ascending: true });

    const picks = (rows ?? []).map((r) => ({
      ...r,
      teamName: (r.teams as { name: string; is_mine: boolean } | null)?.name ?? "Unknown",
      isMine: (r.teams as { name: string; is_mine: boolean } | null)?.is_mine ?? false,
    }));

    const byTeam = new Map<string, typeof picks>();
    for (const p of picks) {
      const list = byTeam.get(p.team_id) ?? [];
      list.push(p);
      byTeam.set(p.team_id, list);
    }

    const grades = [...byTeam.values()].map((list) => {
      const totalValue = list.reduce((s, p) => s + Number(p.value_vs_adp), 0);
      const best = list.reduce((max, p) => (Number(p.value_vs_adp) > Number(max.value_vs_adp) ? p : max), list[0]!);
      const worst = list.reduce((min, p) => (Number(p.value_vs_adp) < Number(min.value_vs_adp) ? p : min), list[0]!);
      const avgProj = list.reduce((s, p) => s + Number(p.proj_points_season), 0) / (list.length || 1);
      return {
        teamId: list[0]!.team_id,
        teamName: list[0]!.teamName,
        isMine: list[0]!.isMine,
        grade: totalValue > 0.3 ? "A" : totalValue > 0.1 ? "B" : totalValue > -0.1 ? "C" : totalValue > -0.3 ? "D" : "F",
        totalValue,
        avgProj,
        bestPick: best,
        worstPick: worst,
      };
    });

    return { picks, grades };
  });

// ---------------------------------------------------------------- one-tap actions

export const applyMoveFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        leagueId: z.string().uuid(),
        kind: z.enum(["start-sit", "waiver"]),
        addName: z.string().min(1),
        dropName: z.string().optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;

    const { data: myTeam } = await supabase
      .from("teams")
      .select("id")
      .eq("league_id", data.leagueId)
      .eq("is_mine", true)
      .single();
    if (!myTeam) throw new Error("Mark a team as yours first.");

    if (data.kind === "start-sit" && data.dropName) {
      // Swap starter slot with bench player.
      await supabase
        .from("roster_spots")
        .update({ slot: "BN", is_starter: false })
        .eq("team_id", myTeam.id)
        .ilike("player_name", data.dropName);
      await supabase
        .from("roster_spots")
        .update({ slot: "START", is_starter: true })
        .eq("team_id", myTeam.id)
        .ilike("player_name", data.addName);
    } else if (data.kind === "waiver") {
      // Add the free agent and drop the lowest-value same-position player if requested.
      const { data: canonical } = await supabase
        .from("players")
        .select("id, full_name, position, proj_points_week, nfl_team, status")
        .ilike("full_name", data.addName)
        .limit(1)
        .single();
      if (!canonical) throw new Error(`Could not find ${data.addName} in the player pool.`);

      if (data.dropName) {
        await supabase.from("roster_spots").delete().eq("team_id", myTeam.id).ilike("player_name", data.dropName);
      }

      await supabase.from("roster_spots").insert({
        team_id: myTeam.id,
        league_id: data.leagueId,
        user_id: context.userId,
        player_id: canonical.id,
        player_name: canonical.full_name,
        position: canonical.position,
        nfl_team: canonical.nfl_team,
        slot: "BN",
        is_starter: false,
        proj_points: Number(canonical.proj_points_week),
      });
    }

    return { ok: true };
  });

export const setBestLineupFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ leagueId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;
    const { buildAnalysis } = await import("./fantasy/analysis.server");
    const analysis = await buildAnalysis(supabase, data.leagueId);
    if (!analysis.myTeam) throw new Error("Mark a team as yours first.");

    const { data: myTeam } = await supabase
      .from("teams")
      .select("id")
      .eq("league_id", data.leagueId)
      .eq("is_mine", true)
      .single();
    if (!myTeam) throw new Error("Team not found.");

    const starterNames = new Set(analysis.lineup.map((p) => normalizeName(p.name)));

    const { data: spots } = await supabase.from("roster_spots").select("id, player_name").eq("team_id", myTeam.id);
    for (const s of spots ?? []) {
      const isStarter = starterNames.has(normalizeName(s.player_name));
      await supabase
        .from("roster_spots")
        .update({ slot: isStarter ? "START" : "BN", is_starter: isStarter })
        .eq("id", s.id);
    }

    return { ok: true };
  });

// ---------------------------------------------------------------- game day

export const getGameDayFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        leagueId: z.string().uuid().optional(),
        refresh: z.boolean().optional(),
        games: z.boolean().optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { buildGameDay, refreshLiveScoring } = await import("./fantasy/live.server");

    if (data.refresh) {
      try {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        await refreshLiveScoring(supabaseAdmin);
      } catch {
        // A provider hiccup should never blank the page; serve the last snapshot.
      }
    }

    return buildGameDay(context.supabase, {
      ...(data.leagueId ? { leagueId: data.leagueId } : {}),
      ...(data.games ? { includeGames: true } : {}),
    });
  });

export const getManagerHubFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { buildManagerHub } = await import("./fantasy/manager.server");
    return buildManagerHub(context.supabase);
  });

export const getThisWeekFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { buildThisWeek } = await import("./fantasy/this-week.server");
    return buildThisWeek(context.supabase);
  });

export const getLineupCheckFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { buildLineupCheck } = await import("./fantasy/lineup-check.server");
    return buildLineupCheck(context.supabase);
  });

export const getWaiverHubFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { buildWaiverHub } = await import("./fantasy/waiver-hub.server");
    return buildWaiverHub(context.supabase);
  });

export const getTradeFinderFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ leagueId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { buildTradeFinder } = await import("./fantasy/trade-finder.server");
    return buildTradeFinder(context.supabase, data.leagueId);
  });

// ------------------------------------------------- recommendation tracking

const recSchema = z.object({
  leagueId: z.string().uuid(),
  teamId: z.string().uuid().nullish(),
  week: z.number().int(),
  surface: z.string(),
  kind: z.string(),
  recKey: z.string(),
  headline: z.string(),
  detail: z.string().nullish(),
  addName: z.string().nullish(),
  dropName: z.string().nullish(),
  pointsDelta: z.number().default(0),
  titleDelta: z.number().default(0),
  playoffDelta: z.number().default(0),
  dynastyValueDelta: z.number().default(0),
  dynastyRankDelta: z.number().default(0),
  teamClass: z.string().nullish(),
  impactLabel: z.string().nullish(),
});

const rowFor = (userId: string, r: z.infer<typeof recSchema>, action: string) => ({
  user_id: userId,
  league_id: r.leagueId,
  team_id: r.teamId ?? null,
  week: r.week,
  surface: r.surface,
  kind: r.kind,
  rec_key: r.recKey,
  headline: r.headline,
  detail: r.detail ?? null,
  add_name: r.addName ?? null,
  drop_name: r.dropName ?? null,
  points_delta: r.pointsDelta,
  title_delta: r.titleDelta,
  playoff_delta: r.playoffDelta,
  dynasty_value_delta: r.dynastyValueDelta,
  dynasty_rank_delta: r.dynastyRankDelta,
  team_class: r.teamClass ?? null,
  impact_label: r.impactLabel ?? null,
  action,
});

/** Records every suggestion the manager was actually shown. */
export const logRecommendationsShownFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ items: z.array(recSchema).max(50) }).parse(d))
  .handler(async ({ data, context }) => {
    if (!data.items.length) return { saved: 0 };
    const rows = data.items.map((r) => rowFor(context.userId, r, "shown"));
    const { error } = await context.supabase
      .from("recommendation_log")
      .upsert(rows, { onConflict: "user_id,league_id,week,rec_key", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
    return { saved: rows.length };
  });

/** Records what the manager did with a suggestion. */
export const logRecommendationActionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        item: recSchema,
        action: z.enum(["taken", "ignored", "dismissed"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const row = {
      ...rowFor(context.userId, data.item, data.action),
      acted_at: new Date().toISOString(),
    };
    const { error } = await context.supabase
      .from("recommendation_log")
      .upsert(row, { onConflict: "user_id,league_id,week,rec_key" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
