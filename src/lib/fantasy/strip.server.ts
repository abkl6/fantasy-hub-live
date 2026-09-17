/**
 * The persistent league strip: one small tile per league, cheap enough to
 * refresh alongside the live scoreboard. Server-only.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { leagueInitials } from "@/lib/league-colors";
import { gameWindow } from "./gamewindow";
import type { LeagueStripPayload, LeagueStripTile, StripTab } from "./strip-types";
import type { ThisWeekPayload } from "./this-week-types";

type DB = SupabaseClient<Database>;

/** My place in the table: wins first, then points scored. */
function standingOf(
  rows: { id: string; wins: number; losses: number; ties: number; points_for: number }[],
  myId: string,
): number | null {
  const sorted = [...rows].sort((a, b) => {
    const aw = a.wins + a.ties * 0.5;
    const bw = b.wins + b.ties * 0.5;
    if (aw !== bw) return bw - aw;
    return Number(b.points_for) - Number(a.points_for);
  });
  const index = sorted.findIndex((t) => t.id === myId);
  return index < 0 ? null : index + 1;
}

export async function buildLeagueStrip(supabase: DB): Promise<LeagueStripPayload> {
  const gameDay = gameWindow().live;

  const { data: leagueRows, error } = await supabase
    .from("leagues")
    .select("id, name, color, abbrev, strip_order, open_count, current_week")
    .order("created_at");
  if (error) throw new Error(error.message);
  const leagues = leagueRows ?? [];
  if (!leagues.length) return { gameDay, tiles: [] };

  const ids = leagues.map((l) => l.id);
  const { data: teamRows } = await supabase
    .from("teams")
    .select("id, league_id, name, wins, losses, ties, points_for, is_mine")
    .in("league_id", ids);
  const teams = teamRows ?? [];

  // "This week" is already cached for the whole account, so reading it here
  // costs nothing extra in the common case.
  let todos: ThisWeekPayload | null = null;
  try {
    const { cached, allLeaguesInputsHash } = await import("./cache.server");
    const { buildThisWeek } = await import("./this-week.server");
    const { data: me } = await supabase.auth.getUser();
    const userId = me.user?.id;
    const hash = await allLeaguesInputsHash(supabase);
    todos = userId
      ? await cached<ThisWeekPayload>(supabase, { userId, kind: "this-week" }, hash, () =>
          buildThisWeek(supabase),
        )
      : null;
  } catch {
    // A to-do badge is a nicety; never let it take the strip down.
    todos = null;
  }

  // Scores only matter while games are running.
  let live: Awaited<ReturnType<typeof import("./live.server").buildGameDay>> | null = null;
  if (gameDay) {
    try {
      const { buildGameDay } = await import("./live.server");
      live = await buildGameDay(supabase, { summariesOnly: true });
    } catch {
      live = null;
    }
  }

  const tiles: LeagueStripTile[] = leagues.map((l) => {
    const mine = teams.filter((t) => t.league_id === l.id);
    const myTeam = mine.find((t) => t.is_mine) ?? null;
    const matchup = live?.matchups.find((m) => m.leagueId === l.id) ?? null;
    const items = (todos?.items ?? []).filter((i) => i.leagueId === l.id);

    const record = myTeam
      ? myTeam.ties
        ? `${myTeam.wins}-${myTeam.losses}-${myTeam.ties}`
        : `${myTeam.wins}-${myTeam.losses}`
      : null;

    const tileLive = matchup
      ? {
          myScore: Math.round(matchup.myScore * 10) / 10,
          oppScore: Math.round(matchup.oppScore * 10) / 10,
          oppName: matchup.oppTeam,
          winProbability: matchup.winProbability,
          state: matchup.gameState,
        }
      : null;

    const peek = matchup
      ? `${matchup.myTeam} ${tileLive?.myScore ?? 0} — ${matchup.oppTeam ?? "the field"} ${tileLive?.oppScore ?? 0}`
      : items[0]
        ? items[0].title
        : record
          ? `${record}, nothing waiting`
          : "No team on file yet";

    const defaultTab: StripTab = matchup && matchup.gameState !== "pre" ? "live" : items[0] ? "moves" : "league";

    return {
      id: l.id,
      name: l.name,
      abbrev: (l.abbrev ?? "").trim() || leagueInitials(l.name),
      color: l.color,
      record,
      standing: myTeam ? standingOf(mine as never, myTeam.id) : null,
      teamCount: mine.length,
      todoCount: items.length,
      live: tileLive,
      peek,
      defaultTab,
    };
  });

  const orderIndex = new Map(leagues.map((l) => [l.id, l.strip_order]));
  const opens = new Map(leagues.map((l) => [l.id, l.open_count ?? 0]));
  const pinned = leagues.some((l) => l.strip_order !== null);

  tiles.sort((a, b) => {
    if (pinned) {
      const ao = orderIndex.get(a.id) ?? 9999;
      const bo = orderIndex.get(b.id) ?? 9999;
      if (ao !== bo) return ao - bo;
    }
    const aLive = a.live?.state === "in" ? 1 : 0;
    const bLive = b.live?.state === "in" ? 1 : 0;
    if (aLive !== bLive) return bLive - aLive;
    const aTodo = a.todoCount > 0 ? 1 : 0;
    const bTodo = b.todoCount > 0 ? 1 : 0;
    if (aTodo !== bTodo) return bTodo - aTodo;
    return (opens.get(b.id) ?? 0) - (opens.get(a.id) ?? 0);
  });

  return { gameDay, tiles };
}
