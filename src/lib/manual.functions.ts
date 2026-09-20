/** Server functions for manually tracked leagues. */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { LEAGUE_FORMATS } from "@/lib/fantasy/format";
import {
  asLeagueType,
  asVariant,
  effectiveFormat,
  LEAGUE_TYPES,
  LEAGUE_VARIANTS,
} from "@/lib/fantasy/league-type";
import { normalizeName } from "@/lib/fantasy/names";
import { LEAGUE_COLOR_KEYS } from "@/lib/league-colors";

import { eligiblePositions } from "@/lib/fantasy/eligibility";
import { loadSlotPlan, syncLeagueSlots } from "@/lib/fantasy/slots.server";
const DEFAULT_PROJ: Record<string, number> = {
  QB: 16, RB: 9, WR: 9, TE: 6.5, K: 8, DEF: 7, DST: 7,
};
const projFor = (position: string) => DEFAULT_PROJ[position.toUpperCase()] ?? 6;

// ------------------------------------------------------------ step 1: setup

export const createManualLeagueWizard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        name: z.string().min(1).max(80),
        teamCount: z.number().int().min(2).max(20),
        playoffTeams: z.number().int().min(0).max(20),
        regularSeasonWeeks: z.number().int().min(4).max(18),
        currentWeek: z.number().int().min(1).max(18),
        scoringType: z.string().min(1).max(20),
        scoringRules: z.record(z.string(), z.number()).optional(),
        rosterSlots: z.array(z.string()).min(1).max(30),
        format: z.enum(LEAGUE_FORMATS).optional(),
        leagueType: z.enum(LEAGUE_TYPES).optional(),
        variant: z.enum(LEAGUE_VARIANTS).optional(),
        contestFormat: z.enum(["h2h", "points", "hybrid"]).optional(),
        pointsPlayoffTeams: z.number().int().min(0).max(32).nullable().optional(),
        pointsPlayoffWeek: z.number().int().min(1).max(18).nullable().optional(),
        weeklyHighBonus: z.boolean().optional(),
        weeklyHighLabel: z.string().max(40).optional(),
        teamNames: z.array(z.string().max(60)).min(2).max(20),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;
    const { count } = await supabase
      .from("leagues")
      .select("id", { count: "exact", head: true })
      .eq("user_id", context.userId);
    const color = LEAGUE_COLOR_KEYS[(count ?? 0) % LEAGUE_COLOR_KEYS.length]!;

    const { data: league, error } = await supabase
      .from("leagues")
      .insert({
        user_id: context.userId,
        platform: "manual",
        name: data.name,
        season: new Date().getFullYear(),
        current_week: data.currentWeek,
        team_count: data.teamCount,
        playoff_teams: data.playoffTeams,
        regular_season_weeks: data.regularSeasonWeeks,
        scoring_type: data.scoringType,
        scoring_rules: data.scoringRules ?? {},
        roster_slots: data.rosterSlots,
        eligible_positions: eligiblePositions(data.rosterSlots),
        format: effectiveFormat(
          asLeagueType(data.leagueType),
          asVariant(data.variant),
          data.format,
        ),
        league_type: asLeagueType(data.leagueType),
        variant: asVariant(data.variant),
        type_source: "user",
        contest_format: data.contestFormat ?? "h2h",
        points_playoff_teams: data.pointsPlayoffTeams || null,
        points_playoff_week: data.pointsPlayoffWeek ?? null,
        weekly_high_bonus: data.weeklyHighBonus ?? false,
        weekly_high_label: data.weeklyHighLabel?.trim() || null,
        projection_source: "app",
        color,
        last_synced_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error || !league) throw new Error(error?.message ?? "Could not create the league.");

    await syncLeagueSlots(context.supabase, context.userId, league.id, data.rosterSlots);

    const names = [...data.teamNames];
    while (names.length < data.teamCount) names.push(`Team ${names.length + 1}`);

    const { data: teams, error: teamError } = await supabase
      .from("teams")
      .insert(
        names.slice(0, data.teamCount).map((n) => ({
          league_id: league.id,
          user_id: context.userId,
          name: n.trim() || "Team",
          is_mine: false,
        })),
      )
      .select("id, name");
    if (teamError) throw new Error(teamError.message);

    const { ensureTradeValuesInBackground } = await import("./fantasy/ktc.server");
    ensureTradeValuesInBackground({ scope: league.id, userId: context.userId, platform: "manual" });

    return { leagueId: league.id, teams: teams ?? [] };
  });

/** Scoring and slots from an already-connected league, for "copy scoring". */
export const copyableLeagues = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("leagues")
      .select("id, name, platform, scoring_type, scoring_rules, roster_slots")
      .order("created_at");
    return (data ?? []).map((l) => ({
      id: l.id,
      name: l.name,
      platform: l.platform,
      scoringType: l.scoring_type,
      scoringRules: (l.scoring_rules ?? {}) as Record<string, number>,
      rosterSlots: Array.isArray(l.roster_slots) ? (l.roster_slots as string[]).map(String) : [],
    }));
  });

// ------------------------------------------------------- step 2: draft board

export const previewDraftBoard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ leagueId: z.string().uuid(), text: z.string().min(3).max(60000) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { parseDraftBoard } = await import("./fantasy/manual.server");
    const { data: teams } = await context.supabase
      .from("teams")
      .select("name")
      .eq("league_id", data.leagueId)
      .order("created_at");
    return parseDraftBoard(context.supabase, data.text, (teams ?? []).map((t) => t.name));
  });

const playerRow = z.object({
  name: z.string().min(1).max(60),
  position: z.string().min(1).max(6),
  nflTeam: z.string().max(6).nullable().optional(),
  matched: z.boolean().optional(),
});

export const applyDraftBoard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        leagueId: z.string().uuid(),
        teams: z
          .array(z.object({ name: z.string().max(60), players: z.array(playerRow).max(40) }))
          .min(1)
          .max(20),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;
    const { queueUnmatched, touchConfirmed } = await import("./fantasy/manual.server");
    const { data: teamRows } = await supabase
      .from("teams")
      .select("id, name")
      .eq("league_id", data.leagueId);
    const idByName = new Map((teamRows ?? []).map((t) => [normalizeName(t.name), t.id]));

    const { data: canonical } = await supabase
      .from("players")
      .select("id, full_name, position, nfl_team, proj_points_week");
    const { playerIndex } = await import("./fantasy/names");
    const index = playerIndex(canonical ?? []);

    const { data: league } = await supabase
      .from("leagues")
      .select("roster_slots")
      .eq("id", data.leagueId)
      .maybeSingle();
    const slots = (await loadSlotPlan(supabase, data.leagueId)).keys;

    await supabase.from("roster_spots").delete().eq("league_id", data.leagueId);

    const rows: Record<string, unknown>[] = [];
    for (const team of data.teams) {
      const teamId = idByName.get(normalizeName(team.name));
      if (!teamId) continue;
      team.players.forEach((p, i) => {
        const match = index.find(p.name, p.position);
        rows.push({
          team_id: teamId,
          league_id: data.leagueId,
          user_id: context.userId,
          player_id: match?.id ?? null,
          player_name: match?.full_name ?? p.name,
          position: (match?.position ?? p.position).toUpperCase(),
          nfl_team: p.nflTeam ?? match?.nfl_team ?? null,
          slot: i < slots.length ? slots[i]! : "BN",
          is_starter: i < slots.length,
          proj_points: match ? Number(match.proj_points_week) : projFor(p.position),
          is_auto: false,
        });
      });
    }

    if (rows.length) {
      const { error } = await supabase.from("roster_spots").insert(rows as never);
      if (error) throw new Error(error.message);
    }

    await queueUnmatched(
      supabase,
      data.teams.flatMap((t) => t.players.map((p) => ({ ...p, nflTeam: p.nflTeam ?? null, matched: p.matched ?? true }))),
      "manual-draft",
    );
    await touchConfirmed(supabase, data.leagueId);

    const { syncLeagueRosters } = await import("./fantasy/rosters.server");
    await syncLeagueRosters(supabase, context.userId, data.leagueId);

    return { saved: rows.length };
  });

// ---------------------------------------------------------- step 3: schedule

export const saveManualSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        leagueId: z.string().uuid(),
        text: z.string().max(20000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;
    const { generateSchedule, parseSchedule } = await import("./fantasy/manual.server");

    const [{ data: league }, { data: teams }] = await Promise.all([
      supabase.from("leagues").select("regular_season_weeks").eq("id", data.leagueId).maybeSingle(),
      supabase.from("teams").select("id, name").eq("league_id", data.leagueId).order("created_at"),
    ]);
    const list = teams ?? [];
    if (list.length < 2) throw new Error("Add teams before building a schedule.");
    const weeks = league?.regular_season_weeks ?? 14;

    const idByName = new Map(list.map((t) => [normalizeName(t.name), t.id]));
    const pairs = data.text?.trim()
      ? parseSchedule(data.text, list.map((t) => t.name)).map((g) => ({
          week: g.week,
          home: idByName.get(normalizeName(g.home)),
          away: idByName.get(normalizeName(g.away)),
        }))
      : generateSchedule(list.map((t) => t.id), weeks).map((g) => ({
          week: g.week,
          home: g.home,
          away: g.away,
        }));

    const games = pairs.filter((g) => g.home && g.away && g.week >= 1 && g.week <= 18);
    await supabase.from("matchups").delete().eq("league_id", data.leagueId);
    if (games.length) {
      const { error } = await supabase.from("matchups").insert(
        games.map((g) => ({
          league_id: data.leagueId,
          user_id: context.userId,
          week: g.week,
          home_team_id: g.home!,
          away_team_id: g.away!,
          home_score: 0,
          away_score: 0,
          is_final: false,
        })) as never,
      );
      if (error) throw new Error(error.message);
    }
    return { games: games.length };
  });

// --------------------------------------------------------- step 4: my team

export const setMyManualTeam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ leagueId: z.string().uuid(), teamId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;
    await supabase.from("teams").update({ is_mine: false }).eq("league_id", data.leagueId);
    const { error } = await supabase.from("teams").update({ is_mine: true }).eq("id", data.teamId);
    if (error) throw new Error(error.message);
    const { touchConfirmed } = await import("./fantasy/manual.server");
    await touchConfirmed(supabase, data.leagueId);
    return { ok: true };
  });

// ------------------------------------------------------- weekly maintenance

export const importTransactionLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ leagueId: z.string().uuid(), text: z.string().min(3).max(40000) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;
    const { parseTransactionLog, touchConfirmed } = await import("./fantasy/manual.server");
    const { playerIndex } = await import("./fantasy/names");

    const { data: teams } = await supabase
      .from("teams")
      .select("id, name")
      .eq("league_id", data.leagueId);
    const list = teams ?? [];
    const idByName = new Map(list.map((t) => [normalizeName(t.name), t.id]));

    const parsed = parseTransactionLog(data.text, list.map((t) => t.name));
    if (!parsed.length) return { applied: 0, skipped: 0, found: 0 };

    const { data: existing } = await supabase
      .from("manual_transactions")
      .select("dedupe_key")
      .eq("league_id", data.leagueId);
    const seen = new Set((existing ?? []).map((r) => r.dedupe_key));

    const fresh = parsed.filter((t) => !seen.has(t.dedupeKey));
    if (!fresh.length) return { applied: 0, skipped: parsed.length, found: parsed.length };

    await supabase.from("manual_transactions").insert(
      fresh.map((t) => ({
        user_id: context.userId,
        league_id: data.leagueId,
        occurred_on: t.occurredOn,
        kind: t.kind,
        player_name: t.playerName,
        norm_name: normalizeName(t.playerName),
        position: t.position,
        from_team_id: t.fromTeam ? (idByName.get(normalizeName(t.fromTeam)) ?? null) : null,
        to_team_id: t.toTeam ? (idByName.get(normalizeName(t.toTeam)) ?? null) : null,
        dedupe_key: t.dedupeKey,
        raw_line: t.raw.slice(0, 400),
      })) as never,
    );

    // Apply each change to the tracked rosters, oldest first.
    const { data: canonical } = await supabase
      .from("players")
      .select("id, full_name, position, nfl_team, proj_points_week");
    const index = playerIndex(canonical ?? []);
    let applied = 0;

    for (const t of [...fresh].sort((a, b) => a.occurredOn.localeCompare(b.occurredOn))) {
      const norm = normalizeName(t.playerName);
      const fromId = t.fromTeam ? idByName.get(normalizeName(t.fromTeam)) : undefined;
      const toId = t.toTeam ? idByName.get(normalizeName(t.toTeam)) : undefined;

      if (t.kind !== "add") {
        const { data: spots } = await supabase
          .from("roster_spots")
          .select("id, player_name, team_id")
          .eq("league_id", data.leagueId);
        const hit = (spots ?? []).find(
          (s) => normalizeName(s.player_name) === norm && (!fromId || s.team_id === fromId),
        );
        if (hit) {
          await supabase.from("roster_spots").delete().eq("id", hit.id);
          applied++;
        }
      }

      if (t.kind !== "drop" && toId) {
        const match = index.find(t.playerName, t.position);
        const { error } = await supabase.from("roster_spots").insert({
          team_id: toId,
          league_id: data.leagueId,
          user_id: context.userId,
          player_id: match?.id ?? null,
          player_name: match?.full_name ?? t.playerName,
          position: (match?.position ?? t.position ?? "FLEX").toUpperCase(),
          nfl_team: match?.nfl_team ?? null,
          slot: "BN",
          is_starter: false,
          proj_points: match ? Number(match.proj_points_week) : projFor(t.position ?? "FLEX"),
          is_auto: false,
        } as never);
        if (!error) applied++;
      }
    }

    await touchConfirmed(supabase, data.leagueId);
    return { applied, skipped: parsed.length - fresh.length, found: parsed.length };
  });

/** Saturday one-tap: set the best lineup and record it as confirmed. */
export const confirmManualLineup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ leagueId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;
    const { buildAnalysis } = await import("./fantasy/analysis.server");
    const { touchConfirmed } = await import("./fantasy/manual.server");

    const analysis = await buildAnalysis(supabase, data.leagueId);
    if (!analysis.myTeam) throw new Error("Pick which team is yours first.");

    const { data: myTeam } = await supabase
      .from("teams")
      .select("id")
      .eq("league_id", data.leagueId)
      .eq("is_mine", true)
      .maybeSingle();
    if (!myTeam) throw new Error("Pick which team is yours first.");

    const starters = new Set(analysis.lineup.map((p) => normalizeName(p.name)));
    const { data: spots } = await supabase
      .from("roster_spots")
      .select("id, player_name")
      .eq("team_id", myTeam.id);
    for (const s of spots ?? []) {
      const isStarter = starters.has(normalizeName(s.player_name));
      await supabase
        .from("roster_spots")
        .update({ slot: isStarter ? "START" : "BN", is_starter: isStarter })
        .eq("id", s.id);
    }

    const { data: league } = await supabase
      .from("leagues")
      .select("current_week")
      .eq("id", data.leagueId)
      .maybeSingle();

    await supabase.from("manual_lineups").upsert(
      {
        user_id: context.userId,
        league_id: data.leagueId,
        team_id: myTeam.id,
        week: league?.current_week ?? 1,
        confirmed: true,
        slots: analysis.lineup.map((p) => ({ slot: p.slot, name: p.name })),
      } as never,
      { onConflict: "team_id,week" },
    );

    await touchConfirmed(supabase, data.leagueId);
    return { starters: analysis.lineup.length };
  });

/** Replaces an opponent's estimated lineup with their real one. */
export const setOpponentLineup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        leagueId: z.string().uuid(),
        teamId: z.string().uuid(),
        text: z.string().min(3).max(20000),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;
    const { parseRosterPaste } = await import("./fantasy/manual.server");
    const rows = await parseRosterPaste(supabase, data.text);
    const starters = new Set(rows.map((r) => normalizeName(r.name)));

    const { data: spots } = await supabase
      .from("roster_spots")
      .select("id, player_name")
      .eq("team_id", data.teamId);
    for (const s of spots ?? []) {
      const isStarter = starters.has(normalizeName(s.player_name));
      await supabase
        .from("roster_spots")
        .update({ slot: isStarter ? "START" : "BN", is_starter: isStarter, is_auto: false })
        .eq("id", s.id);
    }

    const { data: league } = await supabase
      .from("leagues")
      .select("current_week")
      .eq("id", data.leagueId)
      .maybeSingle();
    await supabase.from("manual_lineups").upsert(
      {
        user_id: context.userId,
        league_id: data.leagueId,
        team_id: data.teamId,
        week: league?.current_week ?? 1,
        confirmed: true,
        slots: rows.map((r) => ({ slot: r.position, name: r.name })),
      } as never,
      { onConflict: "team_id,week" },
    );
    return { starters: starters.size };
  });

// ----------------------------------------------------------------- reconcile

export const previewReconcile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        leagueId: z.string().uuid(),
        teamId: z.string().uuid(),
        text: z.string().min(3).max(20000),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { reconcileRoster } = await import("./fantasy/manual.server");
    return reconcileRoster(context.supabase, data.leagueId, data.teamId, data.text);
  });

export const applyReconcile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        leagueId: z.string().uuid(),
        teamId: z.string().uuid(),
        add: z.array(playerRow).max(40),
        drop: z.array(playerRow).max(40),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;
    const { touchConfirmed } = await import("./fantasy/manual.server");
    const { playerIndex } = await import("./fantasy/names");

    const dropKeys = new Set(data.drop.map((p) => normalizeName(p.name)));
    if (dropKeys.size) {
      const { data: spots } = await supabase
        .from("roster_spots")
        .select("id, player_name")
        .eq("team_id", data.teamId);
      const ids = (spots ?? [])
        .filter((s) => dropKeys.has(normalizeName(s.player_name)))
        .map((s) => s.id);
      if (ids.length) await supabase.from("roster_spots").delete().in("id", ids);
    }

    if (data.add.length) {
      const { data: canonical } = await supabase
        .from("players")
        .select("id, full_name, position, nfl_team, proj_points_week");
      const index = playerIndex(canonical ?? []);
      const { error } = await supabase.from("roster_spots").insert(
        data.add.map((p) => {
          const match = index.find(p.name, p.position);
          return {
            team_id: data.teamId,
            league_id: data.leagueId,
            user_id: context.userId,
            player_id: match?.id ?? null,
            player_name: match?.full_name ?? p.name,
            position: (match?.position ?? p.position).toUpperCase(),
            nfl_team: p.nflTeam ?? match?.nfl_team ?? null,
            slot: "BN",
            is_starter: false,
            proj_points: match ? Number(match.proj_points_week) : projFor(p.position),
            is_auto: false,
          };
        }) as never,
      );
      if (error) throw new Error(error.message);
    }

    await touchConfirmed(supabase, data.leagueId);
    return { added: data.add.length, dropped: data.drop.length };
  });

// -------------------------------------------- standings + per-team rosters

const standingsRow = z.object({
  name: z.string().min(1).max(60),
  owner: z.string().max(60).nullable().optional(),
  wins: z.number().int().min(0).max(30).optional(),
  losses: z.number().int().min(0).max(30).optional(),
  ties: z.number().int().min(0).max(30).optional(),
  pointsFor: z.number().min(0).max(10000).optional(),
  pointsAgainst: z.number().min(0).max(10000).optional(),
  faabRemaining: z.number().int().min(0).max(100000).nullable().optional(),
  faabSpent: z.number().int().min(0).max(100000).nullable().optional(),
});

/** Creates or updates every team from a standings table. */
export const applyStandings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        leagueId: z.string().uuid(),
        teams: z.array(standingsRow).min(1).max(32),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;
    const [{ data: league }, { data: existing }] = await Promise.all([
      supabase.from("leagues").select("faab_budget").eq("id", data.leagueId).maybeSingle(),
      supabase.from("teams").select("id, name").eq("league_id", data.leagueId),
    ]);
    const budget = league?.faab_budget ?? 0;
    const idByName = new Map((existing ?? []).map((t) => [normalizeName(t.name), t.id]));

    let created = 0;
    let updated = 0;

    for (const row of data.teams) {
      const remaining =
        row.faabRemaining ?? (row.faabSpent != null && budget ? Math.max(0, budget - row.faabSpent) : null);
      const spent = row.faabSpent ?? (row.faabRemaining != null && budget ? Math.max(0, budget - row.faabRemaining) : null);
      const values = {
        name: row.name.trim(),
        owner_name: row.owner?.trim() || null,
        wins: row.wins ?? 0,
        losses: row.losses ?? 0,
        ties: row.ties ?? 0,
        points_for: row.pointsFor ?? 0,
        points_against: row.pointsAgainst ?? 0,
        ...(remaining != null ? { faab_remaining: remaining } : {}),
        ...(spent != null ? { faab_spent: spent } : {}),
      };

      const id = idByName.get(normalizeName(row.name));
      if (id) {
        const { error } = await supabase.from("teams").update(values).eq("id", id);
        if (error) throw new Error(error.message);
        updated += 1;
      } else {
        const { error } = await supabase
          .from("teams")
          .insert({
            league_id: data.leagueId,
            user_id: context.userId,
            is_mine: false,
            ...values,
          } as never);
        if (error) throw new Error(error.message);
        created += 1;
      }
    }

    // Remove auto-generated placeholder teams ("Team 2", "Team 3", …) that the
    // standings did not match — but only while they still have no roster.
    const { data: allTeams } = await supabase
      .from("teams")
      .select("id, name, is_mine")
      .eq("league_id", data.leagueId);
    const standingsNames = new Set(data.teams.map((t) => normalizeName(t.name)));
    const placeholders = (allTeams ?? []).filter(
      (t) => !t.is_mine && /^team\s+\d+$/i.test(t.name.trim()) && !standingsNames.has(normalizeName(t.name)),
    );
    if (placeholders.length) {
      const { data: spots } = await supabase
        .from("roster_spots")
        .select("team_id")
        .in("team_id", placeholders.map((t) => t.id));
      const withRoster = new Set((spots ?? []).map((s) => s.team_id));
      const removable = placeholders.filter((t) => !withRoster.has(t.id)).map((t) => t.id);
      if (removable.length) await supabase.from("teams").delete().in("id", removable);
    }

    const { count } = await supabase
      .from("teams")
      .select("id", { count: "exact", head: true })
      .eq("league_id", data.leagueId);
    if (count) await supabase.from("leagues").update({ team_count: count }).eq("id", data.leagueId);

    const { touchConfirmed } = await import("./fantasy/manual.server");
    await touchConfirmed(supabase, data.leagueId);

    const { data: teams } = await supabase
      .from("teams")
      .select("id, name")
      .eq("league_id", data.leagueId)
      .order("created_at");
    return { created, updated, teams: teams ?? [] };
  });

/** Replaces one team's roster, leaving every other team untouched. */
export const applyTeamRoster = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        leagueId: z.string().uuid(),
        teamId: z.string().uuid(),
        players: z
          .array(
            playerRow.extend({
              slot: z.string().max(12).nullable().optional(),
              isStarter: z.boolean().optional(),
            }),
          )
          .min(1)
          .max(40),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;
    const { queueUnmatched, touchConfirmed } = await import("./fantasy/manual.server");
    const { playerIndex } = await import("./fantasy/names");

    const { data: canonical } = await supabase
      .from("players")
      .select("id, full_name, position, nfl_team, proj_points_week");
    const index = playerIndex(canonical ?? []);
    const slots = (await loadSlotPlan(supabase, data.leagueId)).keys;

    await supabase.from("roster_spots").delete().eq("team_id", data.teamId);

    let starters = 0;
    const rows = data.players.map((p) => {
      const match = index.find(p.name, p.position);
      const explicit = p.slot?.toUpperCase();
      const bench = explicit === "BN" || p.isStarter === false;
      const slot = bench ? "BN" : (explicit && explicit !== "BN" ? explicit : slots[starters] ?? "BN");
      if (slot !== "BN") starters += 1;
      return {
        team_id: data.teamId,
        league_id: data.leagueId,
        user_id: context.userId,
        player_id: match?.id ?? null,
        player_name: match?.full_name ?? p.name,
        position: (match?.position ?? p.position).toUpperCase(),
        nfl_team: p.nflTeam ?? match?.nfl_team ?? null,
        slot,
        is_starter: slot !== "BN",
        proj_points: match ? Number(match.proj_points_week) : projFor(p.position),
        is_auto: false,
      };
    });

    const { error } = await supabase.from("roster_spots").insert(rows as never);
    if (error) throw new Error(error.message);

    await queueUnmatched(
      supabase,
      data.players.map((p) => ({
        name: p.name,
        position: p.position,
        nflTeam: p.nflTeam ?? null,
        matched: p.matched ?? true,
      })),
      "manual-roster",
    );
    await touchConfirmed(supabase, data.leagueId);

    const { syncLeagueRosters } = await import("./fantasy/rosters.server");
    await syncLeagueRosters(supabase, context.userId, data.leagueId);

    return { saved: rows.length };
  });

/** How many teams still have no players. */
export const manualRosterProgress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ leagueId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;
    const [{ data: teams }, { data: spots }] = await Promise.all([
      supabase.from("teams").select("id, name").eq("league_id", data.leagueId).order("created_at"),
      supabase.from("roster_spots").select("team_id").eq("league_id", data.leagueId),
    ]);
    const counts = new Map<string, number>();
    for (const s of spots ?? []) counts.set(s.team_id, (counts.get(s.team_id) ?? 0) + 1);
    const rows = (teams ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      players: counts.get(t.id) ?? 0,
    }));
    return {
      teams: rows,
      filled: rows.filter((t) => t.players > 0).length,
      total: rows.length,
    };
  });

/** Removes a team from a hand-tracked league (no platform sync). */
export const deleteManualTeam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ leagueId: z.string().uuid(), teamId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;

    const { data: league } = await supabase
      .from("leagues")
      .select("id, external_id, team_count")
      .eq("id", data.leagueId)
      .maybeSingle();
    if (!league) throw new Error("League not found.");
    if (league.external_id) {
      throw new Error("This league syncs from its platform, so teams can't be removed by hand.");
    }

    const { data: team } = await supabase
      .from("teams")
      .select("id, name, is_mine")
      .eq("id", data.teamId)
      .eq("league_id", data.leagueId)
      .maybeSingle();
    if (!team) throw new Error("Team not found.");
    if (team.is_mine) throw new Error("That's your own team — pick a different one.");

    await Promise.all([
      supabase.from("roster_spots").delete().eq("team_id", data.teamId),
      supabase.from("draft_picks").delete().eq("team_id", data.teamId),
      supabase.from("manual_lineups").delete().eq("team_id", data.teamId),
      supabase.from("faab_bids").delete().eq("team_id", data.teamId),
      supabase.from("team_draft_picks").delete().eq("team_id", data.teamId),
      supabase.from("team_draft_picks").delete().eq("original_team_id", data.teamId),
      supabase.from("weekly_snapshots").delete().eq("team_id", data.teamId),
      supabase.from("saved_moves").delete().eq("team_id", data.teamId),
      supabase.from("recommendation_log").delete().eq("team_id", data.teamId),
      supabase.from("score_reconciliation").delete().eq("team_id", data.teamId),
      supabase.from("calibration_log").delete().eq("team_id", data.teamId),
      supabase.from("trade_history").delete().eq("team_id", data.teamId),
      supabase.from("matchups").delete().eq("home_team_id", data.teamId),
      supabase.from("matchups").delete().eq("away_team_id", data.teamId),
      supabase.from("manual_transactions").delete().eq("from_team_id", data.teamId),
      supabase.from("manual_transactions").delete().eq("to_team_id", data.teamId),
    ]);

    const { error } = await supabase
      .from("teams")
      .delete()
      .eq("id", data.teamId)
      .eq("league_id", data.leagueId);
    if (error) throw new Error(error.message);

    const { count } = await supabase
      .from("teams")
      .select("id", { count: "exact", head: true })
      .eq("league_id", data.leagueId);
    const remaining = count ?? 0;
    await supabase.from("leagues").update({ team_count: remaining }).eq("id", data.leagueId);
    await supabase.from("analysis_cache").delete().eq("league_id", data.leagueId);

    return { removed: team.name, teams: remaining };
  });


// -------------------------------------------------------------- upkeep list

export const manualLeagueStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("leagues")
      .select("id, name, color, current_week, last_confirmed_at")
      .eq("platform", "manual")
      .order("created_at");
    return (data ?? []).map((l) => ({
      id: l.id,
      name: l.name,
      color: l.color,
      week: l.current_week,
      lastConfirmedAt: l.last_confirmed_at,
    }));
  });
