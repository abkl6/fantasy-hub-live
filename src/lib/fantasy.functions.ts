import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const DEFAULT_PROJ: Record<string, number> = {
  QB: 16, RB: 9, WR: 9, TE: 6.5, K: 8, DEF: 7, DST: 7,
};

function projFor(position: string) {
  return DEFAULT_PROJ[position.toUpperCase()] ?? 6;
}

// ---------------------------------------------------------------- leagues

export const listLeagues = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("leagues")
      .select("id, name, platform, season, current_week, team_count, last_synced_at")
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
  .inputValidator((d: unknown) => z.object({ leagueId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { buildAnalysis } = await import("./fantasy/analysis.server");
    const { syncLeagueRosters } = await import("./fantasy/rosters.server");
    // Backfill any team still missing a roster so availability stays accurate.
    await syncLeagueRosters(context.supabase, context.userId, data.leagueId);
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
        sleeperUserId: z.string().min(1),
        season: z.string().min(4),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { sleeperLeagueBundle, sleeperPlayers, sleeperCurrentWeek, normalizeSlots } = await import(
      "./fantasy/sleeper.server"
    );
    const supabase = context.supabase;
    const userId = context.userId;

    const state = await sleeperCurrentWeek();
    const week = Number(data.season) === Number(state.season) ? state.week : 17;
    const [bundle, playerMap] = await Promise.all([
      sleeperLeagueBundle(data.sleeperLeagueId, week),
      sleeperPlayers(),
    ]);

    const slots = normalizeSlots(bundle.league.roster_positions ?? []);
    const playoffTeams = Number(bundle.league.settings?.["playoff_teams"] ?? 6);
    const regularWeeks = Number(bundle.league.settings?.["playoff_week_start"] ?? 15) - 1;

    // Replace any prior import of this league.
    await supabase
      .from("leagues")
      .delete()
      .eq("platform", "sleeper")
      .eq("external_id", data.sleeperLeagueId);

    const { data: league, error: leagueError } = await supabase
      .from("leagues")
      .insert({
        user_id: userId,
        platform: "sleeper",
        external_id: data.sleeperLeagueId,
        name: bundle.league.name,
        season: Number(data.season),
        current_week: week,
        team_count: bundle.league.total_rosters,
        playoff_teams: playoffTeams,
        regular_season_weeks: Math.max(regularWeeks, 8),
        scoring_type: (bundle.league.scoring_settings?.["rec"] ?? 0) >= 1 ? "ppr" : (bundle.league.scoring_settings?.["rec"] ?? 0) > 0 ? "half_ppr" : "standard",
        scoring_rules: bundle.league.scoring_settings ?? {},
        roster_slots: slots.length ? slots : ["QB","RB","RB","WR","WR","TE","FLEX","K","DEF"],
        last_synced_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (leagueError || !league) throw new Error(leagueError?.message ?? "Could not save the league.");

    const { data: canonical } = await supabase.from("players").select("id, full_name, position, proj_points_week");
    const canonicalMap = new Map(
      (canonical ?? []).map((p) => [`${p.full_name.toLowerCase()}|${p.position.toUpperCase()}`, p]),
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
        is_mine: r.owner_id === data.sleeperUserId,
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
        const key = `${sp.full_name.toLowerCase()}|${sp.position.toUpperCase()}`;
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
      (canonical ?? []).map((p) => [`${p.full_name.toLowerCase()}|${p.position.toUpperCase()}`, p]),
    );
    const byName = new Map((canonical ?? []).map((p) => [p.full_name.toLowerCase(), p]));

    await supabase.from("roster_spots").delete().eq("team_id", data.teamId);

    if (data.players.length) {
      const rows = data.players.map((p) => {
        const match =
          byKey.get(`${p.name.toLowerCase()}|${p.position.toUpperCase()}`) ?? byName.get(p.name.toLowerCase());
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
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const patch: Record<string, unknown> = {};
    if (data.currentWeek !== undefined) patch["current_week"] = data.currentWeek;
    if (data.scoringRules !== undefined) patch["scoring_rules"] = data.scoringRules;
    if (data.rosterSlots !== undefined) patch["roster_slots"] = data.rosterSlots;
    if (data.scoringType !== undefined) patch["scoring_type"] = data.scoringType;
    const { error } = await context.supabase
      .from("leagues")
      .update(patch as never)
      .eq("id", data.leagueId);
    if (error) throw new Error(error.message);
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
      const key = raw.trim().toLowerCase();
      const spot = (spots ?? []).find((s) => s.player_name.toLowerCase() === key);
      if (spot) {
        return { name: spot.player_name, position: spot.position.toUpperCase(), proj: Number(spot.proj_points) };
      }
      const player = (canonical ?? []).find((p) => p.full_name.toLowerCase() === key);
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
        mode: z.enum(["roster", "scoring"]),
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

    const body = {
      model: SCREENSHOT_MODELS,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: data.mode === "roster" ? rosterPrompt : scoringPrompt },
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
    };
  });
