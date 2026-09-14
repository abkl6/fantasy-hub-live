/**
 * Inactive-starter sweep. Finds every starter on a member's teams who is out,
 * inactive or doubtful and sends one push per league with the best bench
 * replacement already picked out. Server-only.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

import { slotAccepts } from "@/lib/fantasy/engine";
import { playerKey } from "@/lib/fantasy/names";
import { loadPrefs, notifyUser } from "./notify.server";

type DB = SupabaseClient<Database>;

const BAD_STATUS = /^(out|inactive|doubtful|ir|suspended)$/i;

function statusLabel(status: string): string {
  const s = status.toLowerCase();
  if (s === "doubtful") return "DOUBTFUL";
  if (s === "ir") return "on IR";
  if (s === "suspended") return "SUSPENDED";
  return "OUT";
}

export async function runInactiveSweep(admin: DB): Promise<{ sent: number; checked: number }> {
  const [{ data: leagueRows }, { data: spotRows }, { data: newsRows }, { data: playerRows }] =
    await Promise.all([
      admin.from("leagues").select("id, name, user_id, current_week, season"),
      admin.from("roster_spots").select("*"),
      admin
        .from("player_news")
        .select("player_id, player_name, position, status, published_at")
        .gte("published_at", new Date(Date.now() - 7 * 86400_000).toISOString())
        .order("published_at", { ascending: false }),
      admin.from("players").select("id, full_name, position, status, proj_points_week"),
    ]);

  const leagues = leagueRows ?? [];
  if (!leagues.length) return { sent: 0, checked: 0 };

  const players = new Map((playerRows ?? []).map((p) => [p.id, p]));

  // Newest news per player wins; fall back to the player table status.
  const newsById = new Map<string, string>();
  const newsByKey = new Map<string, string>();
  for (const row of newsRows ?? []) {
    if (row.player_id && !newsById.has(row.player_id)) newsById.set(row.player_id, row.status);
    const key = playerKey(row.player_name, row.position);
    if (!newsByKey.has(key)) newsByKey.set(key, row.status);
  }

  const statusFor = (spot: { player_id: string | null; player_name: string; position: string }) => {
    if (spot.player_id && newsById.has(spot.player_id)) return newsById.get(spot.player_id)!;
    const key = playerKey(spot.player_name, spot.position);
    if (newsByKey.has(key)) return newsByKey.get(key)!;
    const player = spot.player_id ? players.get(spot.player_id) : undefined;
    return player?.status ?? "Active";
  };

  const prefs = await loadPrefs(admin, [...new Set(leagues.map((l) => l.user_id))]);
  const spotsByLeague = new Map<string, typeof spotRows>();
  for (const spot of spotRows ?? []) {
    const list = spotsByLeague.get(spot.league_id) ?? [];
    list.push(spot);
    spotsByLeague.set(spot.league_id, list);
  }

  // Only alert on players whose NFL team is actually scheduled this week.
  const { data: scheduleRows } = await admin
    .from("nfl_schedule")
    .select("season, week, nfl_team, opponent");
  const scheduled = new Set(
    (scheduleRows ?? [])
      .filter((r) => r.opponent)
      .map((r) => `${r.season}:${r.week}:${r.nfl_team.toUpperCase()}`),
  );
  const playsThisWeek = (
    league: { season: number; current_week: number },
    team: string | null,
  ) => {
    if (!scheduled.size) return true;
    if (!team) return true;
    return scheduled.has(`${league.season}:${league.current_week}:${team.toUpperCase()}`);
  };

  let sent = 0;
  let checked = 0;

  for (const league of leagues) {
    const spots = (spotsByLeague.get(league.id) ?? []).filter((s) => s.user_id === league.user_id);
    const mine = spots.filter((s) => s.is_starter);
    const bench = spots.filter((s) => !s.is_starter);
    checked += mine.length;

    for (const starter of mine) {
      const status = statusFor(starter);
      if (!BAD_STATUS.test(status.trim())) continue;
      if (!playsThisWeek(league, starter.nfl_team)) continue;

      const replacement = bench
        .filter((b) => slotAccepts(starter.slot as never, b.position))
        .filter((b) => !BAD_STATUS.test(statusFor(b).trim()))
        .sort((a, b) => Number(b.proj_points) - Number(a.proj_points))[0];

      const params = new URLSearchParams({ tab: "lineup", swap: starter.player_name });
      if (replacement) params.set("with", replacement.player_name);

      const ok = await notifyUser(admin, league.user_id, prefs.get(league.user_id)!, {
        kind: "inactives",
        title: league.name,
        body: replacement
          ? `${starter.player_name} is ${statusLabel(status)} — tap to swap in ${replacement.player_name}`
          : `${starter.player_name} is ${statusLabel(status)} — tap to swap`,
        url: `/league/${league.id}?${params.toString()}`,
        tag: `inactive-${league.id}`,
        dedupeKey: `inactive:${league.id}:${league.current_week}:${starter.player_name}:${status.toLowerCase()}`,
        ref: league.id,
        detail: starter.player_name,
      });
      if (ok) sent += 1;
    }
  }

  return { sent, checked };
}

/** One nudge per league in the hour before kickoff when a starter is unplayable. */
export async function runLineupLockReminder(admin: DB): Promise<{ sent: number }> {
  const [{ data: leagueRows }, { data: spotRows }, { data: playerRows }] = await Promise.all([
    admin.from("leagues").select("id, name, user_id, current_week"),
    admin.from("roster_spots").select("league_id, user_id, player_name, position, is_starter, player_id"),
    admin.from("players").select("id, status, bye_week"),
  ]);

  const leagues = leagueRows ?? [];
  if (!leagues.length) return { sent: 0 };
  const players = new Map((playerRows ?? []).map((p) => [p.id, p]));
  const prefs = await loadPrefs(admin, [...new Set(leagues.map((l) => l.user_id))]);

  let sent = 0;
  for (const league of leagues) {
    const starters = (spotRows ?? []).filter(
      (s) => s.league_id === league.id && s.user_id === league.user_id && s.is_starter,
    );
    const problems = starters.filter((s) => {
      const player = s.player_id ? players.get(s.player_id) : undefined;
      if (!player) return false;
      if (player.bye_week === league.current_week) return true;
      return BAD_STATUS.test((player.status ?? "").trim());
    });

    const ok = await notifyUser(admin, league.user_id, prefs.get(league.user_id)!, {
      kind: "lineup_lock",
      title: league.name,
      body: problems.length
        ? `Lineups lock soon — ${problems.length} starter${problems.length > 1 ? "s" : ""} can't play`
        : "Lineups lock soon — last chance to set yours",
      url: `/league/${league.id}?tab=lineup`,
      tag: `lock-${league.id}`,
      dedupeKey: `lock:${league.id}:${league.current_week}`,
      ref: league.id,
    });
    if (ok) sent += 1;
  }
  return { sent };
}
