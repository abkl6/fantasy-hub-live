/** Shared writer that stores a normalized league bundle from any platform. Server-only. */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

import {
  asLeagueType,
  asVariant,
  effectiveFormat,
  type LeagueType,
  type LeagueVariant,
} from "./league-type";
import { playerIndex } from "./names";

type DB = SupabaseClient<Database>;

const DEFAULT_PROJ: Record<string, number> = {
  QB: 16, RB: 9, WR: 9, TE: 6.5, K: 8, DEF: 7, DST: 7,
};

export interface NormalizedTeam {
  externalId: string;
  name: string;
  ownerName: string | null;
  isMine?: boolean;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  division?: string | null;
  playoffSeed?: number | null;
  roster: { name: string; position: string; nflTeam: string | null; slot: string; isStarter: boolean }[];
}

export interface NormalizedBundle {
  platform: string;
  externalId: string;
  name: string;
  season: number;
  currentWeek: number;
  teamCount: number;
  playoffTeams: number;
  regularSeasonWeeks: number;
  scoringType: string;
  scoringRules?: Record<string, number>;
  rosterSlots: string[];
  /** How the platform says the league is won, when it exposes it. */
  contestFormat?: "h2h" | "points" | "hybrid" | "vp";
  /** Engine format the platform reports directly, e.g. "best_ball". */
  format?: string | null;
  /** Redraft / keeper / dynasty, and how confident we are about it. */
  leagueType?: LeagueType;
  variant?: LeagueVariant;
  typeSource?: "detected" | "inferred";
  teams: NormalizedTeam[];
  schedule: {
    week: number;
    homeExternalId: string | null;
    awayExternalId: string | null;
    homeScore: number;
    awayScore: number;
    isFinal: boolean;
  }[];
}

/**
 * Replaces any previous import of the same league and writes teams, every
 * team's roster, and the full real-season schedule (played and upcoming).
 */
export async function persistBundle(
  supabase: DB,
  userId: string,
  bundle: NormalizedBundle,
  myTeamExternalId: string | null,
) {
  // A manager's own league-type choice outlives a re-import of the league.
  const { data: previous } = await supabase
    .from("leagues")
    .select("league_type, variant, type_source")
    .eq("platform", bundle.platform)
    .eq("external_id", bundle.externalId)
    .maybeSingle();

  await supabase
    .from("leagues")
    .delete()
    .eq("platform", bundle.platform)
    .eq("external_id", bundle.externalId);

  const keepUser = previous?.type_source === "user";
  const leagueType = keepUser ? asLeagueType(previous?.league_type) : asLeagueType(bundle.leagueType);
  const variant = keepUser ? asVariant(previous?.variant) : asVariant(bundle.variant);
  const typeSource = keepUser ? "user" : (bundle.typeSource ?? "inferred");


  const { data: league, error: leagueError } = await supabase
    .from("leagues")
    .insert({
      user_id: userId,
      platform: bundle.platform,
      external_id: bundle.externalId,
      name: bundle.name,
      season: bundle.season,
      current_week: bundle.currentWeek,
      team_count: bundle.teamCount,
      playoff_teams: bundle.playoffTeams,
      regular_season_weeks: bundle.regularSeasonWeeks,
      scoring_type: bundle.scoringType,
      scoring_rules: bundle.scoringRules ?? {},
      roster_slots: bundle.rosterSlots,
      contest_format: bundle.contestFormat ?? "h2h",
      league_type: leagueType,
      variant,
      type_source: typeSource,
      format: effectiveFormat(leagueType, variant, bundle.format ?? null),
      last_synced_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (leagueError || !league) throw new Error(leagueError?.message ?? "Could not save the league.");

  const { data: canonical } = await supabase
    .from("players")
    .select("id, full_name, position, nfl_team, proj_points_week");
  const index = playerIndex(canonical ?? []);

  const { data: insertedTeams, error: teamError } = await supabase
    .from("teams")
    .insert(
      bundle.teams.map((t) => ({
        league_id: league.id,
        user_id: userId,
        external_id: t.externalId,
        name: t.name,
        owner_name: t.ownerName,
        is_mine: t.isMine ?? t.externalId === myTeamExternalId,
        wins: t.wins,
        losses: t.losses,
        ties: t.ties,
        points_for: t.pointsFor,
        points_against: t.pointsAgainst,
        division: t.division ?? null,
        playoff_seed: t.playoffSeed ?? null,
      })),
    )
    .select("id, external_id");
  if (teamError) throw new Error(teamError.message);

  const teamId = new Map((insertedTeams ?? []).map((t) => [t.external_id, t.id]));

  const spots = bundle.teams.flatMap((t) => {
    const id = teamId.get(t.externalId);
    if (!id) return [];
    return t.roster.map((p) => {
      const match = index.find(p.name, p.position, p.nflTeam);
      return {
        team_id: id,
        league_id: league.id,
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
      };
    });
  });
  if (spots.length) {
    const { error } = await supabase.from("roster_spots").insert(spots);
    if (error) throw new Error(error.message);
  }

  const games = bundle.schedule
    .filter((g) => g.homeExternalId && g.awayExternalId)
    .map((g) => ({
      league_id: league.id,
      user_id: userId,
      week: g.week,
      home_team_id: teamId.get(g.homeExternalId!) ?? null,
      away_team_id: teamId.get(g.awayExternalId!) ?? null,
      home_score: g.homeScore,
      away_score: g.awayScore,
      is_final: g.isFinal,
    }))
    .filter((g) => g.home_team_id && g.away_team_id);
  if (games.length) {
    const { error } = await supabase.from("matchups").insert(games);
    if (error) throw new Error(error.message);
  }

  // Any team the platform returned without a roster gets an estimated one so
  // the league's available-player list stays accurate.
  const { syncLeagueRosters } = await import("./rosters.server");
  await syncLeagueRosters(supabase, userId, league.id);

  // Dynasty/trade values should be there right after an import. Never awaited.
  const { ensureTradeValuesInBackground } = await import("./ktc.server");
  ensureTradeValuesInBackground({ scope: league.id, userId, platform: bundle.platform });

  return { leagueId: league.id, name: league.name, teams: insertedTeams ?? [] };
}
