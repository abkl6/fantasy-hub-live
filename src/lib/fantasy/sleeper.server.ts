/** Sleeper public API adapter. Server-only. */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type DB = SupabaseClient<Database>;

const BASE = "https://api.sleeper.app/v1";

type SleeperPlayer = {
  full_name?: string | undefined;
  first_name?: string | undefined;
  last_name?: string | undefined;
  position?: string | undefined;
  team?: string | null | undefined;
  injury_status?: string | null | undefined;
  injury_body_part?: string | null | undefined;
  injury_notes?: string | null | undefined;
  injury_start_date?: string | null | undefined;
  active?: boolean | undefined;
  practice_description?: string | null | undefined;
};

let playerCache: Record<string, SleeperPlayer> | null = null;
let playerCacheAt = 0;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Sleeper request failed (${res.status})`);
  return (await res.json()) as T;
}

export async function sleeperPlayers(): Promise<Record<string, SleeperPlayer>> {
  if (playerCache && Date.now() - playerCacheAt < 6 * 60 * 60 * 1000) return playerCache;
  const raw = await getJson<Record<string, SleeperPlayer>>(`${BASE}/players/nfl`);
  const slim: Record<string, SleeperPlayer> = {};
  for (const [id, p] of Object.entries(raw)) {
    const name = p.full_name ?? [p.first_name, p.last_name].filter(Boolean).join(" ");
    if (!name || !p.position) continue;
    slim[id] = {
      full_name: name,
      position: p.position,
      team: p.team ?? null,
      injury_status: p.injury_status,
      injury_body_part: p.injury_body_part,
      injury_notes: p.injury_notes,
      active: p.active,
      practice_description: p.practice_description,
    };
  }
  playerCache = slim;
  playerCacheAt = Date.now();
  return slim;
}

/** Sync live injury/status data from Sleeper into the local player pool. */
export async function syncPlayerNews(supabase: DB): Promise<{ updated: number }> {
  const players = await sleeperPlayers();
  const statusOrder: Record<string, number> = {
    Active: 0,
    Questionable: 1,
    Doubtful: 2,
    Out: 3,
    IR: 4,
  };

  const { data: canonicalRows } = await supabase.from("players").select("id, full_name, position, sleeper_id, status");
  const bySleeperId = new Map((canonicalRows ?? []).filter((p) => p.sleeper_id).map((p) => [p.sleeper_id, p]));
  const byName = new Map((canonicalRows ?? []).map((p) => [p.full_name.toLowerCase(), p]));

  let updated = 0;
  const now = new Date().toISOString();

  for (const [sleeperId, p] of Object.entries(players)) {
    if (!p.injury_status && p.active !== false) continue;
    const match = bySleeperId.get(sleeperId) ?? byName.get(p.full_name?.toLowerCase() ?? "");
    if (!match) continue;

    const status = p.injury_status || (p.active === false ? "Out" : "Active");
    const bodyPart = p.injury_body_part ?? null;
    const note = p.injury_notes || p.practice_description || null;

    // Only insert a news row if status changed or there is a meaningful note.
    const { data: latest } = await supabase
      .from("player_news")
      .select("status, news_text")
      .eq("player_id", match.id)
      .order("published_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const changed = !latest || latest.status !== status || latest.news_text !== note;
    if (changed) {
      await supabase.from("player_news").insert({
        player_id: match.id,
        player_name: match.full_name,
        position: match.position,
        status,
        injury_body_part: bodyPart,
        news_text: note,
        source: "sleeper",
        published_at: now,
      });
      updated++;
    }

    // Always keep the players table status current.
    const currentRank = statusOrder[match.status] ?? -1;
    const newRank = statusOrder[status] ?? -1;
    if (newRank > currentRank || status !== match.status) {
      await supabase.from("players").update({ status }).eq("id", match.id);
    }
  }

  return { updated };
}

/** Fetch a Sleeper league's draft results. */
export async function sleeperDraft(leagueId: string) {
  const drafts = await getJson<{ draft_id: string; league_id: string; season: string; status: string }[]>(
    `${BASE}/league/${leagueId}/drafts`,
  );
  const draft = (drafts ?? []).find((d) => d.league_id === leagueId);
  if (!draft) return null;
  const picks = await getJson<
    { round: number; pick_no: number; roster_id: number; player_id: string; metadata?: { first_name?: string; last_name?: string; position?: string; team?: string } }[]
  >(`${BASE}/draft/${draft.draft_id}/picks`);
  return { draft, picks: picks ?? [] };
}

export async function sleeperCurrentWeek(): Promise<{ week: number; season: string }> {
  const state = await getJson<{ week: number; season: string; display_week?: number }>(`${BASE}/state/nfl`);
  return { week: Math.max(1, state.display_week ?? state.week ?? 1), season: state.season };
}

export async function sleeperUserLeagues(username: string, season: string) {
  const user = await getJson<{ user_id: string } | null>(`${BASE}/user/${encodeURIComponent(username)}`);
  if (!user?.user_id) throw new Error("That Sleeper username was not found.");
  const leagues = await getJson<
    { league_id: string; name: string; season: string; total_rosters: number; avatar: string | null }[]
  >(`${BASE}/user/${user.user_id}/leagues/nfl/${season}`);
  return { userId: user.user_id, leagues: leagues ?? [] };
}

export interface SleeperLeagueBundle {
  league: {
    league_id: string;
    name: string;
    season: string;
    total_rosters: number;
    roster_positions: string[];
    scoring_settings: Record<string, number>;
    settings: Record<string, number>;
  };
  rosters: {
    roster_id: number;
    owner_id: string | null;
    players: string[] | null;
    starters: string[] | null;
    settings: { wins?: number; losses?: number; ties?: number; fpts?: number; fpts_decimal?: number; fpts_against?: number; fpts_against_decimal?: number };
  }[];
  users: { user_id: string; display_name: string; metadata?: { team_name?: string } }[];
  matchups: { week: number; entries: { roster_id: number; matchup_id: number | null; points: number }[] }[];
}

export async function sleeperLeagueBundle(leagueId: string, throughWeek: number): Promise<SleeperLeagueBundle> {
  const [league, rosters, users] = await Promise.all([
    getJson<SleeperLeagueBundle["league"]>(`${BASE}/league/${leagueId}`),
    getJson<SleeperLeagueBundle["rosters"]>(`${BASE}/league/${leagueId}/rosters`),
    getJson<SleeperLeagueBundle["users"]>(`${BASE}/league/${leagueId}/users`),
  ]);

  // Pull the whole regular season, not just weeks already played, so the
  // simulation knows who each team still has to face.
  const lastWeek = Math.min(
    18,
    Math.max(throughWeek, Number(league.settings?.["playoff_week_start"] ?? 15) - 1, 14),
  );
  const weeks = Array.from({ length: lastWeek }, (_, i) => i + 1);
  const matchups = await Promise.all(
    weeks.map(async (week) => {
      try {
        const entries = await getJson<SleeperLeagueBundle["matchups"][number]["entries"]>(
          `${BASE}/league/${leagueId}/matchups/${week}`,
        );
        return { week, entries: entries ?? [] };
      } catch {
        return { week, entries: [] };
      }
    }),
  );

  return { league, rosters: rosters ?? [], users: users ?? [], matchups };
}

/** Sleeper roster slot names -> our internal slot names. */
export function normalizeSlots(positions: string[]): string[] {
  return positions
    .filter((p) => p !== "BN" && p !== "IR" && p !== "TAXI")
    .map((p) => (p === "DEF" ? "DEF" : p === "WRRB_FLEX" ? "WRRB_FLEX" : p));
}
