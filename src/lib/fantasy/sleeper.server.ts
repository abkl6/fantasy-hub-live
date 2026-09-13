/** Sleeper public API adapter. Server-only. */

const BASE = "https://api.sleeper.app/v1";

type SleeperPlayer = {
  full_name?: string | undefined;
  first_name?: string | undefined;
  last_name?: string | undefined;
  position?: string | undefined;
  team?: string | null | undefined;
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
    slim[id] = { full_name: name, position: p.position, team: p.team ?? null };
  }
  playerCache = slim;
  playerCacheAt = Date.now();
  return slim;
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

  const weeks = Array.from({ length: Math.min(Math.max(throughWeek, 1), 18) }, (_, i) => i + 1);
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
