/**
 * Keeps a stored FFPC league up to date. Server-only.
 *
 * FFPC is read by scraping its own pages, so a failed read is treated as "the
 * site changed or is down", never as "the league is empty": the last-good copy
 * stays exactly as it is, the failure is logged for the admin Errors tab, and
 * the league is marked paused so the app can say "sync paused — update
 * manually" instead of silently showing stale numbers as if they were live.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

import { FfpcParseError, ffpcLeagueBundle, type FfpcLeagueBundle } from "./ffpc.server";
import { playerIndex } from "./names";

type DB = SupabaseClient<Database>;

const DEFAULT_PROJ: Record<string, number> = {
  QB: 16, RB: 9, WR: 9, TE: 6.5, K: 8, DEF: 7, DST: 7,
};

export const FFPC_SYNC_PAUSED_NOTE = "sync paused — update manually";

/** Reads the manager's FFPC token. Returns null when they haven't connected. */
export async function ffpcToken(supabase: DB, userId?: string): Promise<string | null> {
  const { decryptToken } = await import("./token-crypto.server");
  let query = supabase.from("platform_credentials").select("payload").eq("platform", "ffpc");
  if (userId) query = query.eq("user_id", userId);
  const { data } = await query.maybeSingle();
  const payload = (data?.payload ?? {}) as Record<string, string>;
  return decryptToken(payload["ltuid"] ?? null);
}

export async function saveFfpcToken(supabase: DB, userId: string, ltuid: string) {
  const { encryptToken } = await import("./token-crypto.server");
  const { error } = await supabase.from("platform_credentials").upsert(
    {
      user_id: userId,
      platform: "ffpc",
      payload: { ltuid: await encryptToken(ltuid) },
    },
    { onConflict: "user_id,platform" },
  );
  if (error) throw new Error(error.message);
}

/** Records a sync failure without ever repeating the private token. */
export async function recordFfpcFailure(
  supabase: DB,
  userId: string,
  leagueId: string | null,
  error: unknown,
) {
  const message =
    error instanceof FfpcParseError
      ? `${error.page}: ${error.message}`
      : error instanceof Error
        ? error.message
        : "FFPC sync failed.";
  const safe = message.replace(/ltuid=[^\s&]+/gi, "ltuid=***").slice(0, 400);

  await supabase.from("job_errors").insert({
    user_id: userId,
    platform: "ffpc",
    source: "ffpc-sync",
    message: safe,
    scope: leagueId,
    detail: {},
  });
  if (leagueId) {
    await supabase
      .from("leagues")
      .update({ sync_paused: true, last_sync_error: safe })
      .eq("id", leagueId);
  }
  return safe;
}

/** Writes a freshly read bundle over the stored league, keeping team rows. */
export async function applyFfpcBundle(
  supabase: DB,
  userId: string,
  leagueId: string,
  bundle: FfpcLeagueBundle,
  options: { live?: boolean } = {},
) {
  await supabase
    .from("leagues")
    .update({
      name: bundle.name,
      current_week: bundle.currentWeek,
      contest_format: bundle.contestFormat,
      all_play_weeks: bundle.allPlayWeeks,
      faab_budget: bundle.faabBudget,
      ...(options.live
        ? {}
        : {
            scoring_rules: bundle.scoringRules,
            scoring_type: bundle.scoringType,
            roster_slots: bundle.rosterSlots,
            team_count: bundle.teamCount,
            playoff_teams: bundle.playoffTeams,
            regular_season_weeks: bundle.regularSeasonWeeks,
          }),
      sync_paused: false,
      last_sync_error: null,
      last_synced_at: new Date().toISOString(),
    })
    .eq("id", leagueId);

  const { data: existingTeams } = await supabase
    .from("teams")
    .select("id, external_id")
    .eq("league_id", leagueId);
  const teamByExternal = new Map((existingTeams ?? []).map((t) => [t.external_id, t.id]));

  for (const t of bundle.teams) {
    const fields = {
      name: t.name,
      owner_name: t.ownerName,
      wins: t.wins,
      losses: t.losses,
      ties: t.ties,
      points_for: t.pointsFor,
      points_against: t.pointsAgainst,
      vp: t.vp,
      ...(t.faabRemaining == null
        ? {}
        : {
            faab_remaining: t.faabRemaining,
            faab_spent: Math.max(0, bundle.faabBudget - t.faabRemaining),
          }),
    };
    const existing = teamByExternal.get(t.externalId);
    if (existing) {
      await supabase.from("teams").update(fields).eq("id", existing);
    } else {
      const { data: inserted } = await supabase
        .from("teams")
        .insert({
          ...fields,
          league_id: leagueId,
          user_id: userId,
          external_id: t.externalId,
          is_mine: t.isMine,
        })
        .select("id, external_id")
        .single();
      if (inserted) teamByExternal.set(inserted.external_id, inserted.id);
    }
  }

  // Rosters and the schedule are only rebuilt on a full read: the live pass
  // touches scores alone, so an unreadable roster page can't blank a lineup.
  if (!options.live) {
    const { data: canonical } = await supabase
      .from("players")
      .select("id, full_name, position, proj_points_week");
    const index = playerIndex(canonical ?? []);

    const spots: Record<string, unknown>[] = [];
    for (const t of bundle.teams) {
      const teamId = teamByExternal.get(t.externalId);
      if (!teamId || !t.roster.length) continue;
      for (const p of t.roster) {
        const match = index.find(p.name, p.position);
        spots.push({
          team_id: teamId,
          league_id: leagueId,
          user_id: userId,
          player_id: match?.id ?? null,
          player_name: match?.full_name ?? p.name,
          position: (match?.position ?? p.position).toUpperCase(),
          nfl_team: p.nflTeam,
          slot: p.slot,
          is_starter: p.isStarter,
          proj_points: match
            ? Number(match.proj_points_week)
            : (DEFAULT_PROJ[p.position.toUpperCase()] ?? 6),
          is_auto: false,
        });
      }
    }
    if (spots.length) {
      await supabase.from("roster_spots").delete().eq("league_id", leagueId);
      for (let i = 0; i < spots.length; i += 500) {
        await supabase.from("roster_spots").insert(spots.slice(i, i + 500) as never);
      }
    }

    const games = bundle.schedule
      .filter((g) => g.homeExternalId && g.awayExternalId)
      .map((g) => ({
        league_id: leagueId,
        user_id: userId,
        week: g.week,
        home_team_id: teamByExternal.get(g.homeExternalId!) ?? null,
        away_team_id: teamByExternal.get(g.awayExternalId!) ?? null,
        home_score: g.homeScore,
        away_score: g.awayScore,
        is_final: g.isFinal,
      }))
      .filter((g) => g.home_team_id && g.away_team_id);
    if (games.length) {
      await supabase.from("matchups").delete().eq("league_id", leagueId);
      for (let i = 0; i < games.length; i += 500) {
        await supabase.from("matchups").insert(games.slice(i, i + 500) as never);
      }
    }

    // Dynasty pick portfolio, when the league has one.
    if (bundle.futurePicks.length) {
      const nameToId = new Map(
        bundle.teams.map((t) => [t.name.toLowerCase(), teamByExternal.get(t.externalId) ?? null]),
      );
      const rows = bundle.futurePicks
        .map((p) => ({
          league_id: leagueId,
          user_id: userId,
          team_id: p.ownedByExternalId ? (teamByExternal.get(p.ownedByExternalId) ?? null) : null,
          original_team_id: p.originalTeamName
            ? (nameToId.get(p.originalTeamName.toLowerCase()) ?? null)
            : null,
          season: p.season,
          round: p.round,
          count: 1,
        }))
        .filter((r) => r.team_id);
      if (rows.length) {
        await supabase.from("team_draft_picks").delete().eq("league_id", leagueId);
        await supabase.from("team_draft_picks").insert(rows as never);
      }
    }

    const { syncLeagueRosters } = await import("./rosters.server");
    await syncLeagueRosters(supabase, userId, leagueId);
  } else {
    // Live pass: only the current week's scores move.
    for (const row of bundle.scoreboard) {
      const teamId = row.externalId
        ? teamByExternal.get(row.externalId)
        : teamByExternal.get(
            bundle.teams.find((t) => t.name === row.name)?.externalId ?? "",
          );
      if (!teamId) continue;
      await supabase
        .from("matchups")
        .update({ home_score: row.score })
        .eq("league_id", leagueId)
        .eq("week", bundle.currentWeek)
        .eq("home_team_id", teamId);
      await supabase
        .from("matchups")
        .update({ away_score: row.score })
        .eq("league_id", leagueId)
        .eq("week", bundle.currentWeek)
        .eq("away_team_id", teamId);
    }
  }
}

/**
 * Re-reads one stored FFPC league. `live` does the fast scoreboard-only pass
 * used during game windows; the full pass reads rosters, rules and history.
 */
export async function refreshFfpcLeague(
  supabase: DB,
  userId: string,
  leagueId: string,
  options: { live?: boolean } = {},
): Promise<{ refreshed: boolean; reason?: string }> {
  const { data: league } = await supabase
    .from("leagues")
    .select("id, platform, external_id, current_week")
    .eq("id", leagueId)
    .maybeSingle();
  if (!league || league.platform !== "ffpc" || !league.external_id) {
    return { refreshed: false, reason: "not an FFPC league" };
  }

  const ltuid = await ffpcToken(supabase, userId);
  if (!ltuid) return { refreshed: false, reason: "FFPC is not connected." };

  try {
    const bundle = await ffpcLeagueBundle(league.external_id, ltuid, {
      shallow: options.live === true,
    });
    await applyFfpcBundle(supabase, userId, leagueId, bundle, options);
    return { refreshed: true };
  } catch (error) {
    const reason = await recordFfpcFailure(supabase, userId, leagueId, error);
    return { refreshed: false, reason };
  }
}
