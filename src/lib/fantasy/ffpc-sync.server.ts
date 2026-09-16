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
import { normalizeName, playerIndex } from "./names";
import { queueUnmatched } from "./manual.server";
import type { ManualPlayerRow } from "./manual-types";

import { eligiblePositions } from "./eligibility";
type DB = SupabaseClient<Database>;

const DEFAULT_PROJ: Record<string, number> = {
  QB: 16, RB: 9, WR: 9, TE: 6.5, K: 8, DEF: 7, DST: 7,
};

export const FFPC_SYNC_PAUSED_NOTE = "sync paused — update manually";

/**
 * Reads the manager's FFPC token. FFPC issues one token per league, so the
 * league's own token is preferred and the most recent one is the fallback.
 * Returns null when they haven't connected.
 */
export async function ffpcToken(
  supabase: DB,
  userId?: string,
  leagueExternalId?: string | null,
): Promise<string | null> {
  const { decryptToken } = await import("./token-crypto.server");
  let query = supabase.from("platform_credentials").select("payload").eq("platform", "ffpc");
  if (userId) query = query.eq("user_id", userId);
  const { data } = await query.maybeSingle();
  const payload = (data?.payload ?? {}) as Record<string, unknown>;
  const byLeague = (payload["byLeague"] ?? {}) as Record<string, string>;
  const stored =
    (leagueExternalId ? byLeague[leagueExternalId] : null) ?? (payload["ltuid"] as string) ?? null;
  return decryptToken(stored);
}

export async function saveFfpcToken(
  supabase: DB,
  userId: string,
  ltuid: string,
  leagueExternalId?: string | null,
) {
  const { encryptToken } = await import("./token-crypto.server");
  const { data: existing } = await supabase
    .from("platform_credentials")
    .select("payload")
    .eq("platform", "ffpc")
    .eq("user_id", userId)
    .maybeSingle();
  const previous = (existing?.payload ?? {}) as Record<string, unknown>;
  const byLeague = { ...((previous["byLeague"] ?? {}) as Record<string, string>) };
  const encrypted = await encryptToken(ltuid);
  if (leagueExternalId) byLeague[leagueExternalId] = encrypted;

  const { error } = await supabase.from("platform_credentials").upsert(
    {
      user_id: userId,
      platform: "ffpc",
      payload: { ltuid: encrypted, byLeague },
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
  // Re-detect the league type, but never over a manager's own choice.
  const { detectLeagueType, effectiveFormat } = await import("./league-type");
  const { data: stored } = await supabase
    .from("leagues")
    .select("type_source, format, settings_source")
    .eq("id", leagueId)
    .maybeSingle();
  const detected =
    options.live || stored?.type_source === "user"
      ? null
      : detectLeagueType({
          typeDescription: `${bundle.leagueType} ${bundle.name}`,
          hasEmpirePanel: bundle.hasEmpirePanel,
          hasFuturePicks: bundle.futurePicks.length > 0,
        });

  // Detected playoff / waiver / division settings, minus anything the manager
  // has set by hand — those are theirs and a sync must leave them alone.
  const { mergeDetectedSettings } = await import("./league-settings");
  const detectedSettings = options.live
    ? { patch: {}, settingsSource: null }
    : mergeDetectedSettings(stored?.settings_source, {
        playoff_week_start: bundle.settings.playoffWeekStart,
        playoff_weeks: bundle.settings.playoffWeeks,
        playoff_teams: bundle.settings.playoffTeams,
        playoff_byes: bundle.settings.playoffByes,
        third_place_game: bundle.settings.thirdPlaceGame,
        consolation: bundle.settings.consolation,
        waiver_type: bundle.settings.waiverType,
        waiver_run_times: bundle.settings.waiverRunTimes,
        divisions: bundle.settings.divisions,
        playoff_seed_type: bundle.settings.playoffSeedType,
        rules_text: bundle.settings.rulesText,
        all_play_weeks: bundle.allPlayWeeks,
        regular_season_weeks: bundle.regularSeasonWeeks,
        contest_format: bundle.contestFormat,
      });

  // Non-fatal read problems still belong in the admin Errors tab.
  for (const warning of options.live ? [] : bundle.parseWarnings) {
    await supabase.from("job_errors").insert({
      user_id: userId,
      platform: "ffpc",
      source: "ffpc-sync",
      message: warning.slice(0, 400),
      scope: leagueId,
      detail: {},
    });
  }

  await supabase
    .from("leagues")
    .update({
      ...(detected
        ? {
            league_type: detected.leagueType,
            variant: detected.variant,
            type_source: detected.typeSource,
            format: effectiveFormat(detected.leagueType, detected.variant, stored?.format),
          }
        : {}),
      name: bundle.name,
      current_week: bundle.currentWeek,
      faab_budget: bundle.faabBudget,
      ...detectedSettings.patch,
      ...(detectedSettings.settingsSource
        ? { settings_source: detectedSettings.settingsSource }
        : {}),
      ...(options.live
        ? {}
        : {
            scoring_rules: bundle.scoringRules,
            scoring_type: bundle.scoringType,
            roster_slots: bundle.rosterSlots,
            eligible_positions: eligiblePositions(bundle.rosterSlots),
            team_count: bundle.teamCount,
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
      division: t.division,
      playoff_seed: t.playoffSeed,
      eliminated_week: t.eliminatedWeek,

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
      .select("id, full_name, position, nfl_team, proj_points_week");
    const index = playerIndex(canonical ?? []);
    const byId = new Map((canonical ?? []).map((p) => [p.id as string, p]));

    // Second pass for anything the name index missed: the market table keyed
    // on last name + NFL team + position. FFPC spells some names differently.
    const { data: marketRows } = await supabase
      .from("player_trade_values")
      .select("player_id, display_name, position, nfl_team")
      .not("player_id", "is", null);
    const lastNameKey = (name: string, team: string | null, position: string) => {
      const parts = normalizeName(name).split(" ");
      const last = parts[parts.length - 1] ?? "";
      return `${last}|${(team ?? "").toUpperCase()}|${position.toUpperCase()}`;
    };
    const marketByKey = new Map<string, string>();
    for (const row of marketRows ?? []) {
      const key = lastNameKey(
        row.display_name as string,
        row.nfl_team as string | null,
        row.position as string,
      );
      if (!marketByKey.has(key)) marketByKey.set(key, row.player_id as string);
    }

    const missed: ManualPlayerRow[] = [];
    const spots: Record<string, unknown>[] = [];
    for (const t of bundle.teams) {
      const teamId = teamByExternal.get(t.externalId);
      if (!teamId || !t.roster.length) continue;
      for (const p of t.roster) {
        let match = index.find(p.name, p.position, p.nflTeam);
        if (!match) {
          const viaMarket = marketByKey.get(lastNameKey(p.name, p.nflTeam, p.position));
          if (viaMarket) match = byId.get(viaMarket) ?? null;
        }
        if (!match) {
          missed.push({
            name: p.name,
            position: p.position,
            nflTeam: p.nflTeam,
            matched: false,
          } as ManualPlayerRow);
        }
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
    if (missed.length) {
      // Unmatched names are why a player has no age, so they go to the queue.
      const seen = new Set<string>();
      const unique = missed.filter((r) => {
        const key = `${normalizeName(r.name)}|${r.position}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      await queueUnmatched(supabase, unique, "ffpc");
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

  const ltuid = await ffpcToken(supabase, userId, league.external_id);
  if (!ltuid) return { refreshed: false, reason: "FFPC is not connected." };

  try {
    const bundle = await ffpcLeagueBundle(league.external_id, ltuid, {
      shallow: options.live === true,
    });
    await applyFfpcBundle(supabase, userId, leagueId, bundle, options);
    // A link that worked for this league is pinned to it, so a later league's
    // link can never be used against it.
    await saveFfpcToken(supabase, userId, ltuid, league.external_id);
    return { refreshed: true };
  } catch (error) {
    const reason = await recordFfpcFailure(supabase, userId, leagueId, error);
    return { refreshed: false, reason };
  }
}
