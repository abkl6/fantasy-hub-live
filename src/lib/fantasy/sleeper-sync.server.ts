/**
 * Re-reads a Sleeper league and updates the stored copy in place, so trades,
 * waiver adds and lineup changes made on Sleeper show up here. Server-only.
 *
 * Teams are updated (never deleted) so anything pointing at them — matchup
 * history, saved moves, weekly snapshots — survives. Rosters and the schedule
 * are rebuilt from the platform each time.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

import { playerIndex } from "./names";

type DB = SupabaseClient<Database>;

const DEFAULT_PROJ: Record<string, number> = {
  QB: 16, RB: 9, WR: 9, TE: 6.5, K: 8, DEF: 7, DST: 7,
};

/** How old a stored Sleeper league may be before a page view refreshes it. */
export const SLEEPER_STALE_MS = 10 * 60 * 1000;

export async function refreshSleeperLeague(
  supabase: DB,
  userId: string,
  leagueId: string,
): Promise<{ refreshed: boolean; reason?: string }> {
  const { data: league } = await supabase
    .from("leagues")
    .select("id, platform, external_id, season, current_week")
    .eq("id", leagueId)
    .maybeSingle();
  if (!league || league.platform !== "sleeper" || !league.external_id) {
    return { refreshed: false, reason: "not a Sleeper league" };
  }

  const { sleeperLeagueBundle, sleeperPlayers, sleeperCurrentWeek } = await import("./sleeper.server");
  const state = await sleeperCurrentWeek();
  const week = Number(league.season) === Number(state.season) ? state.week : league.current_week;

  const [bundle, playerMap] = await Promise.all([
    sleeperLeagueBundle(league.external_id, week),
    sleeperPlayers(),
  ]);

  // Sleeper reports the league's FAAB budget and each roster's spend, so
  // guillotine bidding advice stays accurate without any manual entry.
  const faabBudget = Number(
    (bundle.league as { settings?: { waiver_budget?: number } }).settings?.waiver_budget ?? 0,
  );

  await supabase
    .from("leagues")
    .update({
      name: bundle.league.name,
      current_week: week,
      scoring_rules: bundle.league.scoring_settings ?? {},
      ...(faabBudget ? { faab_budget: faabBudget } : {}),
      last_synced_at: new Date().toISOString(),
    })
    .eq("id", league.id);

  // --- teams: update records in place, add any new ones --------------------
  const { data: existingTeams } = await supabase
    .from("teams")
    .select("id, external_id")
    .eq("league_id", league.id);
  const teamByExternal = new Map((existingTeams ?? []).map((t) => [t.external_id, t.id]));

  const userById = new Map(bundle.users.map((u) => [u.user_id, u]));
  for (const r of bundle.rosters) {
    const owner = r.owner_id ? userById.get(r.owner_id) : undefined;
    const s = r.settings ?? {};
    const fields = {
      name: owner?.metadata?.team_name || owner?.display_name || `Team ${r.roster_id}`,
      owner_name: owner?.display_name ?? null,
      wins: s.wins ?? 0,
      losses: s.losses ?? 0,
      ties: s.ties ?? 0,
      points_for: Number(`${s.fpts ?? 0}.${s.fpts_decimal ?? 0}`),
      points_against: Number(`${s.fpts_against ?? 0}.${s.fpts_against_decimal ?? 0}`),
      ...(faabBudget
        ? {
            faab_spent: Number((s as { waiver_budget_used?: number }).waiver_budget_used ?? 0),
            faab_remaining:
              faabBudget - Number((s as { waiver_budget_used?: number }).waiver_budget_used ?? 0),
          }
        : {}),
    };
    const existing = teamByExternal.get(String(r.roster_id));
    if (existing) {
      await supabase.from("teams").update(fields).eq("id", existing);
    } else {
      const { data: inserted } = await supabase
        .from("teams")
        .insert({
          ...fields,
          league_id: league.id,
          user_id: userId,
          external_id: String(r.roster_id),
          is_mine: false,
        })
        .select("id, external_id")
        .single();
      if (inserted) teamByExternal.set(inserted.external_id, inserted.id);
    }
  }

  // --- rosters: rebuild from the platform ---------------------------------
  const { data: canonical } = await supabase
    .from("players")
    .select("id, full_name, position, proj_points_week");
  const index = playerIndex(canonical ?? []);

  const spots: Record<string, unknown>[] = [];
  for (const r of bundle.rosters) {
    const teamId = teamByExternal.get(String(r.roster_id));
    if (!teamId) continue;
    const starters = new Set((r.starters ?? []).filter((p) => p && p !== "0"));
    for (const pid of r.players ?? []) {
      const sp = playerMap[pid];
      if (!sp?.full_name || !sp.position) continue;
      const match = index.find(sp.full_name, sp.position);
      spots.push({
        team_id: teamId,
        league_id: league.id,
        user_id: userId,
        player_id: match?.id ?? null,
        player_name: match?.full_name ?? sp.full_name,
        position: (match?.position ?? sp.position).toUpperCase(),
        nfl_team: sp.team ?? null,
        slot: starters.has(pid) ? "START" : "BN",
        is_starter: starters.has(pid),
        proj_points: match
          ? Number(match.proj_points_week)
          : (DEFAULT_PROJ[sp.position.toUpperCase()] ?? 6),
        is_auto: false,
      });
    }
  }

  if (spots.length) {
    await supabase.from("roster_spots").delete().eq("league_id", league.id);
    for (let i = 0; i < spots.length; i += 500) {
      const { error } = await supabase
        .from("roster_spots")
        .insert(spots.slice(i, i + 500) as never);
      if (error) throw new Error(error.message);
    }
  }

  // --- schedule and scores -------------------------------------------------
  const games: Record<string, unknown>[] = [];
  for (const wk of bundle.matchups) {
    const groups = new Map<number, typeof wk.entries>();
    for (const e of wk.entries) {
      if (e.matchup_id == null) continue;
      groups.set(e.matchup_id, [...(groups.get(e.matchup_id) ?? []), e]);
    }
    for (const pair of groups.values()) {
      if (pair.length < 2) continue;
      const [a, b] = pair;
      const home = teamByExternal.get(String(a!.roster_id));
      const away = teamByExternal.get(String(b!.roster_id));
      if (!home || !away) continue;
      games.push({
        league_id: league.id,
        user_id: userId,
        week: wk.week,
        home_team_id: home,
        away_team_id: away,
        home_score: a!.points ?? 0,
        away_score: b!.points ?? 0,
        is_final: wk.week < week,
      });
    }
  }
  if (games.length) {
    await supabase.from("matchups").delete().eq("league_id", league.id);
    for (let i = 0; i < games.length; i += 500) {
      await supabase.from("matchups").insert(games.slice(i, i + 500) as never);
    }
  }

  const { syncLeagueRosters } = await import("./rosters.server");
  await syncLeagueRosters(supabase, userId, league.id);

  return { refreshed: true };
}
