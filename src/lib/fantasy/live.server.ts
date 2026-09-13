/**
 * Live game-day scoring. Server-only.
 *
 * Sleeper's public stats endpoint gives cumulative per-player stat lines for
 * the current week; ESPN's public scoreboard tells us which games are pre,
 * in progress, or final. We snapshot the stat lines, diff each refresh to
 * build a scoring-event log, and score both the log and the live totals with
 * each league's own rules so the same touchdown can be worth different points
 * in two of your leagues.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

import { leagueScoring, scoreStats, type StatLine } from "./scoring";
import { slotAccepts } from "./engine";
import type {
  GameDayPayload,
  LiveEventRow,
  LiveMatchup,
  LivePlayerRow,
} from "./live-types";

export type { GameDayPayload, LiveEventRow, LiveMatchup, LivePlayerRow };

type DB = SupabaseClient<Database>;

const SLEEPER = "https://api.sleeper.app/v1";
const ESPN_SCOREBOARD =
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";

/** Stats we track for the log; everything else still counts toward totals. */
const TRACKED = [
  "pass_yd",
  "pass_td",
  "pass_int",
  "pass_2pt",
  "rush_yd",
  "rush_td",
  "rush_2pt",
  "rec",
  "rec_yd",
  "rec_td",
  "rec_2pt",
  "fum_lost",
  "fgm",
  "xpm",
  "def_td",
  "def_st_td",
  "sack",
  "int",
  "ff",
  "fum_rec",
  "safe",
  "pts_allow",
] as const;

const LABELS: Record<string, (n: number) => string> = {
  pass_yd: (n) => `${n} pass yds`,
  pass_td: (n) => `${n} pass TD`,
  pass_int: (n) => `${n} INT thrown`,
  pass_2pt: (n) => `${n} 2-pt pass`,
  rush_yd: (n) => `${n} rush yds`,
  rush_td: (n) => `${n} rush TD`,
  rush_2pt: (n) => `${n} 2-pt run`,
  rec: (n) => `${n} rec`,
  rec_yd: (n) => `${n} rec yds`,
  rec_td: (n) => `${n} rec TD`,
  rec_2pt: (n) => `${n} 2-pt catch`,
  fum_lost: (n) => `${n} fumble lost`,
  fgm: (n) => `${n} FG made`,
  xpm: (n) => `${n} XP made`,
  def_td: (n) => `${n} defensive TD`,
  def_st_td: (n) => `${n} return TD`,
  sack: (n) => `${n} sack`,
  int: (n) => `${n} INT`,
  ff: (n) => `${n} forced fumble`,
  fum_rec: (n) => `${n} fumble rec`,
  safe: (n) => `${n} safety`,
};

const round1 = (n: number) => Math.round(n * 10) / 10;

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export interface LiveWeek {
  season: number;
  week: number;
}

export async function currentLiveWeek(): Promise<LiveWeek> {
  const state = await getJson<{ season: string; week: number; display_week?: number }>(
    `${SLEEPER}/state/nfl`,
  );
  return {
    season: Number(state?.season ?? new Date().getFullYear()),
    week: Math.max(1, state?.display_week ?? state?.week ?? 1),
  };
}

interface GameInfo {
  state: "pre" | "in" | "post";
  clock: string | null;
  opponent: string | null;
  /** Rough share of the game still to be played, 0-1. */
  remaining: number;
}

/** Map of NFL team abbreviation -> live game state. */
export async function gameStates(week: number): Promise<Map<string, GameInfo>> {
  const data = await getJson<{
    events?: {
      status?: { type?: { state?: string }; displayClock?: string; period?: number };
      competitions?: { competitors?: { team?: { abbreviation?: string } }[] }[];
    }[];
  }>(`${ESPN_SCOREBOARD}?week=${week}`);

  const out = new Map<string, GameInfo>();
  for (const ev of data?.events ?? []) {
    const state = (ev.status?.type?.state ?? "pre") as GameInfo["state"];
    const period = ev.status?.period ?? 0;
    const clock = ev.status?.displayClock ?? null;
    const teams = (ev.competitions?.[0]?.competitors ?? [])
      .map((c) => c.team?.abbreviation)
      .filter((a): a is string => !!a);

    let remaining = 1;
    if (state === "post") remaining = 0;
    else if (state === "in") {
      const [min = "0", sec = "0"] = (clock ?? "0:00").split(":");
      const secsLeftInPeriod = Number(min) * 60 + Number(sec);
      const periodsLeft = Math.max(0, 4 - Math.min(4, period));
      remaining = Math.max(0, Math.min(1, (periodsLeft * 900 + secsLeftInPeriod) / 3600));
    }

    for (const abbr of teams) {
      const opponent = teams.find((t) => t !== abbr) ?? null;
      out.set(abbr.toUpperCase(), { state, clock, opponent, remaining });
    }
  }
  return out;
}

const ESPN_ALIAS: Record<string, string> = { WSH: "WAS", JAX: "JAX", LAR: "LAR", LV: "LV" };
const teamKey = (t: string | null | undefined) =>
  t ? (ESPN_ALIAS[t.toUpperCase()] ?? t.toUpperCase()) : "";

function describe(delta: StatLine): string {
  const parts: string[] = [];
  for (const stat of TRACKED) {
    const v = delta[stat];
    if (!v) continue;
    const label = LABELS[stat];
    if (label) parts.push(label(round1(v)));
  }
  return parts.join(", ");
}

/**
 * Pulls the newest stat lines, records what changed since the last snapshot,
 * and returns how much moved. Requires a privileged client (writes).
 */
export async function refreshLiveScoring(admin: DB): Promise<{
  season: number;
  week: number;
  players: number;
  events: number;
}> {
  const { season, week } = await currentLiveWeek();

  const [stats, games, { data: playerRows }, { data: snapshotRows }] = await Promise.all([
    getJson<Record<string, Record<string, number>>>(`${SLEEPER}/stats/nfl/regular/${season}/${week}`),
    gameStates(week),
    admin.from("players").select("id, full_name, position, nfl_team, sleeper_id"),
    admin.from("live_player_stats").select("player_id, stats").eq("season", season).eq("week", week),
  ]);

  if (!stats) return { season, week, players: 0, events: 0 };

  const previous = new Map(
    (snapshotRows ?? []).map((r) => [r.player_id, (r.stats ?? {}) as StatLine]),
  );

  const snapshots: Record<string, unknown>[] = [];
  const events: Record<string, unknown>[] = [];
  const now = new Date().toISOString();

  for (const player of playerRows ?? []) {
    if (!player.sleeper_id) continue;
    const line = stats[player.sleeper_id];
    if (!line) continue;

    const current: StatLine = {};
    for (const [k, v] of Object.entries(line)) {
      if (typeof v === "number" && Number.isFinite(v)) current[k] = v;
    }

    const game = games.get(teamKey(player.nfl_team));
    snapshots.push({
      player_id: player.id,
      sleeper_id: player.sleeper_id,
      season,
      week,
      stats: current,
      game_state: game?.state ?? "pre",
      game_clock: game?.clock ?? null,
      opponent: game?.opponent ?? null,
      updated_at: now,
    });

    const before = previous.get(player.id);
    if (!before) continue; // first snapshot of the week is the baseline

    const delta: StatLine = {};
    for (const stat of TRACKED) {
      const diff = round1((current[stat] ?? 0) - (before[stat] ?? 0));
      if (Math.abs(diff) >= 0.1) delta[stat] = diff;
    }
    const description = describe(delta);
    if (!description) continue;

    events.push({
      player_id: player.id,
      player_name: player.full_name,
      position: player.position.toUpperCase(),
      nfl_team: player.nfl_team,
      season,
      week,
      delta,
      description,
      dedupe_key: `${player.id}:${season}:${week}:${JSON.stringify(current)}`.slice(0, 400),
      occurred_at: now,
    });
  }

  if (snapshots.length) {
    await admin
      .from("live_player_stats")
      .upsert(snapshots as never, { onConflict: "player_id,season,week" });
  }
  if (events.length) {
    await admin
      .from("scoring_events")
      .upsert(events as never, { onConflict: "dedupe_key", ignoreDuplicates: true });
  }

  return { season, week, players: snapshots.length, events: events.length };
}

// ---------------------------------------------------------------- game day

type SpotRow = Database["public"]["Tables"]["roster_spots"]["Row"];

export async function buildGameDay(
  supabase: DB,
  opts: { leagueId?: string } = {},
): Promise<GameDayPayload> {
  const { season, week } = await currentLiveWeek();

  let leagueQuery = supabase.from("leagues").select("*");
  if (opts.leagueId) leagueQuery = leagueQuery.eq("id", opts.leagueId);
  const { data: leagueRows } = await leagueQuery;
  const leagues = leagueRows ?? [];
  if (!leagues.length) {
    return { season, week, updatedAt: null, matchups: [], events: [] };
  }
  const leagueIds = leagues.map((l) => l.id);

  const [{ data: teamRows }, { data: spotRows }, { data: matchupRows }, { data: liveRows }, { data: eventRows }] =
    await Promise.all([
      supabase.from("teams").select("*").in("league_id", leagueIds),
      supabase.from("roster_spots").select("*").in("league_id", leagueIds),
      supabase.from("matchups").select("*").in("league_id", leagueIds),
      supabase.from("live_player_stats").select("*").eq("season", season).eq("week", week),
      supabase
        .from("scoring_events")
        .select("*")
        .eq("season", season)
        .eq("week", week)
        .order("occurred_at", { ascending: false })
        .limit(300),
    ]);

  const teams = teamRows ?? [];
  const spots = spotRows ?? [];
  const live = new Map(
    (liveRows ?? []).map((r) => [
      r.player_id,
      {
        stats: (r.stats ?? {}) as StatLine,
        state: (r.game_state as LivePlayerRow["gameState"]) ?? "pre",
        clock: r.game_clock,
        opponent: r.opponent,
      },
    ]),
  );

  const updatedAt =
    (liveRows ?? []).reduce<string | null>(
      (acc, r) => (!acc || r.updated_at > acc ? r.updated_at : acc),
      null,
    ) ?? null;

  const matchups: LiveMatchup[] = [];
  const events: LiveEventRow[] = [];

  for (const league of leagues) {
    const scoring = leagueScoring(league.scoring_type, (league.scoring_rules ?? {}) as Record<string, number>);
    const mine = teams.find((t) => t.league_id === league.id && t.is_mine);
    if (!mine) continue;

    const liveWeek = Math.max(1, Math.min(week, league.regular_season_weeks + 4));
    const game = (matchupRows ?? []).find(
      (m) =>
        m.league_id === league.id &&
        m.week === liveWeek &&
        (m.home_team_id === mine.id || m.away_team_id === mine.id),
    );
    const oppId = game ? (game.home_team_id === mine.id ? game.away_team_id : game.home_team_id) : null;
    const opp = oppId ? teams.find((t) => t.id === oppId) ?? null : null;

    const slots = Array.isArray(league.roster_slots)
      ? (league.roster_slots as unknown[]).map(String).filter((s) => s.toUpperCase() !== "BN")
      : [];
    const startable = (position: string) => slots.some((s) => slotAccepts(s, position.toUpperCase()));

    const toRow = (s: SpotRow): LivePlayerRow => {
      const snap = s.player_id ? live.get(s.player_id) : undefined;
      const livePoints = snap ? round1(scoreStats(snap.stats, scoring.rules, s.position)) : 0;
      const proj = scoring.scale(s.position, Number(s.proj_points));
      const state = snap?.state ?? "pre";
      const projectedFinal =
        state === "post" ? livePoints : state === "in" ? round1(livePoints + proj * 0.4) : round1(proj);
      return {
        name: s.player_name,
        position: s.position.toUpperCase(),
        nflTeam: s.nfl_team,
        slot: s.slot,
        isStarter: s.is_starter,
        livePoints,
        projPoints: proj,
        projectedFinal,
        gameState: state,
        gameClock: snap?.clock ?? null,
        opponent: snap?.opponent ?? null,
      };
    };

    const mySpots = spots.filter((s) => s.team_id === mine.id).map(toRow);
    const oppSpots = opp ? spots.filter((s) => s.team_id === opp.id).map(toRow) : [];

    const benched = (slot: string) => ["BN", "IR", "TAXI"].includes(slot.toUpperCase());
    const startersOf = (rows: LivePlayerRow[]) => {
      const flagged = rows.filter((r) => r.isStarter && !benched(r.slot));
      if (flagged.length) return flagged;
      // Estimated rosters may not flag starters; fall back to the best eligible.
      return rows
        .filter((r) => !benched(r.slot) && startable(r.position))
        .slice(0, Math.max(1, slots.length));
    };

    const starters = startersOf(mySpots);
    const oppStarters = startersOf(oppSpots);
    const sum = (rows: LivePlayerRow[], field: "livePoints" | "projectedFinal") =>
      round1(rows.reduce((acc, r) => acc + r[field], 0));

    matchups.push({
      leagueId: league.id,
      leagueName: league.name,
      scoringLabel: scoring.label,
      week: liveWeek,
      myTeam: mine.name,
      oppTeam: opp?.name ?? null,
      myScore: sum(starters, "livePoints"),
      oppScore: sum(oppStarters, "livePoints"),
      myProjected: sum(starters, "projectedFinal"),
      oppProjected: sum(oppStarters, "projectedFinal"),
      yetToPlay: starters.filter((r) => r.gameState === "pre").length,
      oppYetToPlay: oppStarters.filter((r) => r.gameState === "pre").length,
      starters: starters.sort((a, b) => b.livePoints - a.livePoints),
      bench: mySpots.filter((r) => !starters.includes(r)),
      oppStarters: oppStarters.sort((a, b) => b.livePoints - a.livePoints),
    });

    // Score the event log with this league's rules, for players in this matchup.
    const sideOf = new Map<string, "mine" | "opponent">();
    for (const s of spots) {
      if (!s.player_id) continue;
      if (s.team_id === mine.id) sideOf.set(s.player_id, "mine");
      else if (opp && s.team_id === opp.id) sideOf.set(s.player_id, "opponent");
    }

    const card = matchups[matchups.length - 1]!;
    for (const ev of eventRows ?? []) {
      const side = sideOf.get(ev.player_id);
      if (!side) continue;
      const points = round1(scoreStats((ev.delta ?? {}) as StatLine, scoring.rules, ev.position));
      // Skip the yard-by-yard noise; keep plays worth half a point or more.
      if (Math.abs(points) < 0.5) continue;
      events.push({
        id: `${league.id}:${ev.id}`,
        leagueId: league.id,
        leagueName: league.name,
        playerName: ev.player_name,
        position: ev.position,
        nflTeam: ev.nfl_team,
        description: ev.description,
        points,
        side,
        occurredAt: ev.occurred_at,
        myScore: card.myScore,
        oppScore: card.oppScore,
      });
    }
  }

  events.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0));

  return { season, week, updatedAt, matchups, events: events.slice(0, 120) };
}
