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
import {
  optimalLineup,
  simulatePointsRace,
  simulateSeason,
  simulateWeeklyHigh,
  slotAccepts,
  teamDistribution,
  type EnginePlayer,
  type ScheduleGame,
} from "./engine";
import { bestBallWeekProbability, headToHeadWinProbability, type ProbabilityPlayer } from "./game-probability";
import { asFormat, bestBallDistribution } from "./format";
import { asContestFormat, hasPointsRace } from "./contest";
import { loadProjections } from "./projections.server";
import { resolveProjectionSource } from "./projection-source";
import type {
  GameDayPayload,
  LiveEventRow,
  LiveGame,
  LiveMatchup,
  LivePlayerRow,
  LivePointsRace,
  LiveWeeklyHigh,
} from "./live-types";

export type { GameDayPayload, LiveEventRow, LiveGame, LiveMatchup, LivePlayerRow };

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

/**
 * ESPN's edge rejects the default server user agent (403) and also blocks
 * browser-looking ones; a plain client agent is what it lets through. Try the
 * header set first and fall back to a bare request if it is ever refused.
 */
export const FEED_HEADERS = {
  accept: "application/json, text/plain, */*",
  "user-agent": "curl/8.6.0",
};

async function getJson<T>(url: string): Promise<T | null> {
  for (const init of [{ headers: FEED_HEADERS }, {}]) {
    try {
      const res = await fetch(url, init);
      if (!res.ok) continue;
      return (await res.json()) as T;
    } catch {
      // try the next header set
    }
  }
  return null;
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
  /** ISO kickoff time when the scoreboard reports it. */
  kickoff: string | null;
}


/**
 * Map of NFL team abbreviation -> live game state. Returns an empty map only
 * when the scoreboard could not be read; callers must not treat that as
 * "nothing has kicked off".
 */
export async function gameStates(week: number, season?: number): Promise<Map<string, GameInfo>> {
  type Board = {
    events?: {
      date?: string;
      status?: { type?: { state?: string }; displayClock?: string; period?: number };
      competitions?: { competitors?: { team?: { abbreviation?: string } }[] }[];
    }[];
  };

  const year = season ?? new Date().getFullYear();
  let data = await getJson<Board>(`${ESPN_SCOREBOARD}?week=${week}`);
  if (!data?.events?.length) {
    data = await getJson<Board>(
      `${ESPN_SCOREBOARD}?dates=${year}&seasontype=2&week=${week}`,
    );
  }

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
      out.set(teamKey(abbr), {
        state,
        clock,
        opponent: opponent ? teamKey(opponent) : null,
        remaining,
        kickoff: ev.date ?? null,
      });
    }
  }
  return out;
}

/** Earliest kickoff still ahead of us this week, from the live scoreboard. */
export function nextKickoffFrom(board: Map<string, GameInfo>): string | null {
  const now = Date.now();
  const upcoming = [...board.values()]
    .filter((g) => g.state === "pre" && g.kickoff && Date.parse(g.kickoff) > now)
    .map((g) => g.kickoff!)
    .sort();
  return upcoming[0] ?? null;
}




interface ScoreboardGame {
  home: string;
  away: string;
  homeScore: number | null;
  awayScore: number | null;
  state: "pre" | "in" | "post";
  clock: string | null;
  kickoff: string | null;
}

/** Kickoffs, scores and clocks for a week, keyed by both team abbreviations. */
async function scoreboardGames(week: number): Promise<Map<string, ScoreboardGame>> {
  const data = await getJson<{
    events?: {
      date?: string;
      status?: { type?: { state?: string }; displayClock?: string };
      competitions?: {
        competitors?: {
          homeAway?: string;
          score?: string | number;
          team?: { abbreviation?: string };
        }[];
      }[];
    }[];
  }>(`${ESPN_SCOREBOARD}?week=${week}`);

  const out = new Map<string, ScoreboardGame>();
  for (const ev of data?.events ?? []) {
    const competitors = ev.competitions?.[0]?.competitors ?? [];
    const home = competitors.find((c) => c.homeAway === "home");
    const away = competitors.find((c) => c.homeAway === "away");
    const homeAbbr = home?.team?.abbreviation;
    const awayAbbr = away?.team?.abbreviation;
    if (!homeAbbr || !awayAbbr) continue;
    const score = (value: string | number | undefined) =>
      value === undefined || value === null || value === "" ? null : Number(value);
    const game: ScoreboardGame = {
      home: teamKey(homeAbbr),
      away: teamKey(awayAbbr),
      homeScore: score(home?.score),
      awayScore: score(away?.score),
      state: (ev.status?.type?.state ?? "pre") as ScoreboardGame["state"],
      clock: ev.status?.displayClock ?? null,
      kickoff: ev.date ?? null,
    };
    out.set(game.home, game);
    out.set(game.away, game);
  }
  return out;
}

function easternDayHour(iso: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    weekday: get("weekday"),
    hour: Number(get("hour") || "0") % 24,
    date: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

function windowLabel(kickoff: string | null): string {
  if (!kickoff) return "Kickoff time to come";
  const { weekday, hour } = easternDayHour(kickoff);
  if (weekday === "Thu") return "Thursday night";
  if (weekday === "Fri") return "Friday";
  if (weekday === "Sat") return "Saturday";
  if (weekday === "Mon") return "Monday night";
  if (weekday === "Tue") return "Tuesday";
  if (weekday === "Wed") return "Wednesday";
  if (hour < 15) return "Sunday early";
  if (hour < 19) return "Sunday afternoon";
  return "Sunday night";
}

/**
 * This week's NFL slate: every scheduled pairing, enriched with the live score
 * and clock from the same ESPN scoreboard the rest of game day uses.
 */
export async function weekGames(
  supabase: DB,
  season: number,
  week: number,
): Promise<LiveGame[]> {
  const [{ data: scheduleRows }, board] = await Promise.all([
    supabase
      .from("nfl_schedule")
      .select("nfl_team, opponent")
      .eq("season", season)
      .eq("week", week),
    scoreboardGames(week).catch(() => new Map<string, ScoreboardGame>()),
  ]);

  const pairs = new Map<string, { home: string; away: string }>();
  for (const row of scheduleRows ?? []) {
    if (!row.opponent) continue;
    const a = teamKey(row.nfl_team);
    const b = teamKey(row.opponent);
    if (!a || !b) continue;
    const known = board.get(a) ?? board.get(b);
    const home = known ? known.home : [a, b].sort()[1]!;
    const away = known ? known.away : [a, b].sort()[0]!;
    pairs.set([home, away].sort().join("@"), { home, away });
  }
  // Fall back to the scoreboard when the schedule table is empty.
  if (!pairs.size) {
    for (const game of new Set(board.values())) {
      pairs.set([game.home, game.away].sort().join("@"), { home: game.home, away: game.away });
    }
  }

  const todayEt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
  }).format(new Date());

  const games: LiveGame[] = [...pairs.values()].map(({ home, away }) => {
    const info = board.get(home) ?? board.get(away);
    const kickoff = info?.kickoff ?? null;
    return {
      id: `${away}@${home}`,
      home,
      away,
      homeScore: info?.homeScore ?? null,
      awayScore: info?.awayScore ?? null,
      gameState: info?.state ?? "pre",
      gameClock: info?.clock ?? null,
      kickoff,
      window: windowLabel(kickoff),
      today: kickoff ? easternDayHour(kickoff).date === todayEt : false,
    };
  });

  games.sort((a, b) => {
    if (!a.kickoff) return 1;
    if (!b.kickoff) return -1;
    return a.kickoff.localeCompare(b.kickoff) || a.id.localeCompare(b.id);
  });
  return games;
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
    gameStates(week, season),
    admin.from("players").select("id, full_name, position, nfl_team, sleeper_id"),
    admin
      .from("live_player_stats")
      .select("player_id, stats, game_state, game_clock, opponent")
      .eq("season", season)
      .eq("week", week),
  ]);

  if (!stats) return { season, week, players: 0, events: 0 };

  const previous = new Map(
    (snapshotRows ?? []).map((r) => [r.player_id, (r.stats ?? {}) as StatLine]),
  );
  // Keep the last known game status when the scoreboard could not be read, so a
  // failed fetch never rewinds finished games back to "not started".
  const previousGame = new Map(
    (snapshotRows ?? []).map((r) => [
      r.player_id,
      { state: r.game_state ?? "pre", clock: r.game_clock ?? null, opponent: r.opponent ?? null },
    ]),
  );
  const boardOk = games.size > 0;

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

    const board = games.get(teamKey(player.nfl_team));
    const kept = previousGame.get(player.id);
    const game = boardOk
      ? { state: board?.state ?? "pre", clock: board?.clock ?? null, opponent: board?.opponent ?? null }
      : (kept ?? { state: "pre", clock: null, opponent: null });
    snapshots.push({
      player_id: player.id,
      sleeper_id: player.sleeper_id,
      season,
      week,
      stats: current,
      game_state: game.state,
      game_clock: game.clock,
      opponent: game.opponent,
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

  // During a game window, rebuild the cached league payloads in the
  // background so page loads stay plain reads.
  await warmActiveLeagues(admin).catch(() => {});

  return { season, week, players: snapshots.length, events: events.length };
}

/** Recomputes cached payloads for recently synced leagues after a live poll. */
async function warmActiveLeagues(admin: DB): Promise<void> {
  const { gameWindow } = await import("./gamewindow");
  if (!gameWindow().live) return;
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await admin
    .from("leagues")
    .select("id, user_id, last_synced_at")
    .gte("last_synced_at", since)
    .limit(50);
  const { enqueueLeagueJobs } = await import("./jobs.server");
  const { runComputeJobs } = await import("./jobs.server");
  for (const row of data ?? []) {
    await enqueueLeagueJobs(admin, row.user_id, row.id).catch(() => {});
  }
  // Live windows poll every couple of minutes, so drain a slice right away.
  await runComputeJobs(admin, { limit: 4 }).catch(() => {});
}



// ---------------------------------------------------------------- game day

type SpotRow = Database["public"]["Tables"]["roster_spots"]["Row"];

/**
 * "What you need" read for a live or upcoming matchup: the gap to the lead,
 * who is still to finish on each side and what they still project to add.
 */
function needLine(
  starters: LivePlayerRow[],
  oppStarters: LivePlayerRow[],
  myScore: number,
  oppScore: number,
  gameState: "pre" | "in" | "post",
): string | null {
  if (gameState === "post") return null;

  const left = (rows: LivePlayerRow[]) => rows.filter((r) => r.gameState !== "post");
  const toGo = (rows: LivePlayerRow[]) =>
    round1(rows.reduce((acc, r) => acc + Math.max(0, r.projectedFinal - r.livePoints), 0));
  const nameList = (rows: LivePlayerRow[]) => {
    const sorted = [...rows].sort(
      (a, b) => b.projectedFinal - b.livePoints - (a.projectedFinal - a.livePoints),
    );
    const shown = sorted.slice(0, 2).map((r) => r.name);
    const extra = sorted.length - shown.length;
    const names = shown.join(" + ");
    return extra > 0 ? `${names} +${extra} more` : names;
  };

  const mineLeft = left(starters);
  const theirsLeft = left(oppStarters);
  const gap = round1(oppScore - myScore);

  const head =
    gap > 0 ? `Need ${gap.toFixed(1)}` : gap < 0 ? `Up ${Math.abs(gap).toFixed(1)}` : "Dead even";
  const minePart = mineLeft.length
    ? `you have ${nameList(mineLeft)} left (proj ${toGo(mineLeft).toFixed(1)})`
    : "you have nobody left";
  const theirsPart = oppStarters.length
    ? theirsLeft.length
      ? `they have ${nameList(theirsLeft)} left (proj ${toGo(theirsLeft).toFixed(1)})`
      : "they have nobody left"
    : null;

  return [head, minePart, theirsPart].filter(Boolean).join(" · ");
}

export async function buildGameDay(
  supabase: DB,
  opts: { leagueId?: string; includeGames?: boolean } = {},
): Promise<GameDayPayload> {
  const { season, week } = await currentLiveWeek();
  // The live scoreboard is the source of truth for game status; stored rows can
  // be stale or written while the scoreboard was unreachable.
  const board = await gameStates(week, season);
  const games = opts.includeGames ? await weekGames(supabase, season, week) : [];


  let leagueQuery = supabase.from("leagues").select("*");
  if (opts.leagueId) leagueQuery = leagueQuery.eq("id", opts.leagueId);
  const { data: leagueRows } = await leagueQuery;
  const leagues = leagueRows ?? [];
  if (!leagues.length) {
    return {
      season,
      week,
      updatedAt: null,
      matchups: [],
      events: [],
      games,
      nextKickoff: nextKickoffFrom(board),
    };

  }
  const leagueIds = leagues.map((l) => l.id);

  const [{ data: teamRows }, { data: spotRows }, { data: matchupRows }, { data: liveRows }, { data: eventRows }, { data: snapshotRows }] =
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
      supabase
        .from("weekly_snapshots")
        .select("league_id, team_id, title_odds, playoff_odds, week, created_at")
        .in("league_id", leagueIds)
        .order("created_at", { ascending: false }),
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
    const format = asFormat(league.format);
    const isBestBall = format === "best_ball";
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

    // Projections come from the shared player database plus this member's own
    // adjustments, not the value frozen into the roster at import time.
    const projections = await loadProjections(supabase, {
      scoring,
      week: league.current_week ?? liveWeek,
      source: resolveProjectionSource(league),
      sos: (league as { sos_adjust?: boolean }).sos_adjust,
    });

    const toRow = (s: SpotRow): LivePlayerRow => {
      const snap = s.player_id ? live.get(s.player_id) : undefined;
      const livePoints = snap ? round1(scoreStats(snap.stats, scoring.rules, s.position)) : 0;
      const proj = projections.week(
        s.player_id,
        s.player_name,
        s.position.toUpperCase(),
        Number(s.proj_points),
      );
      const game = board.get(teamKey(s.nfl_team));
      const state = game?.state ?? snap?.state ?? "pre";
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
        gameClock: game?.clock ?? snap?.clock ?? null,
        opponent: game?.opponent ?? snap?.opponent ?? null,
        matchup: projections.matchupRating(s.player_id, s.position.toUpperCase()),


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

    const bestBallRows = (rows: LivePlayerRow[], field: "livePoints" | "projectedFinal") => {
      const selected = optimalLineup(
        rows.map((row) => ({ ...row, id: null, proj: row[field], volatility: 0.35 })),
        slots,
      ).starters.flatMap((entry) => (entry.player ? [entry.player as unknown as LivePlayerRow] : []));
      return selected;
    };
    const starters = isBestBall ? bestBallRows(mySpots, "livePoints") : startersOf(mySpots);
    const projectedStarters = isBestBall ? bestBallRows(mySpots, "projectedFinal") : starters;
    let oppStarters = startersOf(oppSpots);
    const sum = (rows: LivePlayerRow[], field: "livePoints" | "projectedFinal") =>
      round1(rows.reduce((acc, r) => acc + r[field], 0));

    let comparisonTeam = opp;
    let comparisonSpots = oppSpots;
    let leagueRank: number | null = null;
    let winProbability: number | null = null;

    if (isBestBall) {
      const teamLive = teams
        .filter((team) => team.league_id === league.id)
        .map((team) => {
          const rows = spots.filter((spot) => spot.team_id === team.id).map(toRow);
          const liveLineup = bestBallRows(rows, "livePoints");
          const projectedLineup = bestBallRows(rows, "projectedFinal");
          return {
            team,
            rows,
            liveLineup,
            projectedLineup,
            liveScore: sum(liveLineup, "livePoints"),
            projected: sum(projectedLineup, "projectedFinal"),
          };
        })
        .sort((a, b) => b.liveScore - a.liveScore || b.projected - a.projected);
      leagueRank = Math.max(1, teamLive.findIndex((entry) => entry.team.id === mine.id) + 1);
      const leader = teamLive.find((entry) => entry.team.id !== mine.id) ?? teamLive[0];
      if (leader) {
        comparisonTeam = leader.team;
        comparisonSpots = leader.rows;
        oppStarters = leader.liveLineup;
      }
      const probabilityTeams = teamLive.map((entry) => ({
        id: entry.team.id,
        players: entry.rows.map((row) => ({
          ...row,
          id: null,
          proj: row.projectedFinal,
          volatility: 0.35,
        })) as ProbabilityPlayer[],
      }));
      winProbability = probabilityTeams.length > 1
        ? bestBallWeekProbability(probabilityTeams, mine.id, slots)
        : 1;
    } else if (opp) {
      winProbability = headToHeadWinProbability(
        starters.map((row) => ({ ...row, id: null, proj: row.projectedFinal, volatility: 0.35 })),
        oppStarters.map((row) => ({ ...row, id: null, proj: row.projectedFinal, volatility: 0.35 })),
      );
    }

    const allPlayers = [...starters, ...oppStarters];
    const gameState = allPlayers.some((row) => row.gameState === "in")
      ? "in"
      : allPlayers.length > 0 && allPlayers.every((row) => row.gameState === "post")
        ? "post"
        : "pre";
    const latestSnapshot = (snapshotRows ?? []).find(
      (row) => row.league_id === league.id && row.team_id === mine.id,
    );

    // Season chances, recomputed from the same full-database projections.
    const leagueTeams = teams.filter((team) => team.league_id === league.id);
    const rosterOf = (teamId: string): EnginePlayer[] =>
      spots
        .filter((s) => s.team_id === teamId)
        .map((s) => ({
          id: s.player_id,
          name: s.player_name,
          position: s.position.toUpperCase(),
          nflTeam: s.nfl_team,
          proj: projections.week(s.player_id, s.player_name, s.position.toUpperCase(), Number(s.proj_points)),
          volatility: 0.35,
        }));
    const schedule: ScheduleGame[] = (matchupRows ?? [])
      .filter((m) => m.league_id === league.id && m.home_team_id && m.away_team_id)
      .map((m) => ({ week: m.week, homeTeamId: m.home_team_id!, awayTeamId: m.away_team_id! }));

    let titleOdds = latestSnapshot ? Number(latestSnapshot.title_odds) : null;
    let playoffOdds = latestSnapshot ? Number(latestSnapshot.playoff_odds) : null;

    if (schedule.length && leagueTeams.length > 1) {
      const simInputs = leagueTeams.map((team) => {
        const roster = rosterOf(team.id);
        const games = team.wins + team.losses + team.ties;
        const dist = roster.length
          ? (isBestBall ? bestBallDistribution(roster, slots) : teamDistribution(roster, slots))
          : { mean: games > 0 ? Number(team.points_for) / games : 100, sd: 22 };
        return {
          id: team.id,
          name: team.name,
          isMine: team.is_mine,
          wins: team.wins,
          losses: team.losses,
          ties: team.ties,
          pointsFor: Number(team.points_for),
          mean: dist.mean,
          sd: dist.sd,
        };
      });
      const simulated = simulateSeason(
        simInputs,
        {
          playoffTeams: league.playoff_teams,
      byes: Number((league as { playoff_byes?: number | null }).playoff_byes ?? 0),
          regularSeasonWeeks: league.regular_season_weeks,
          currentWeek: league.current_week,
        },
        schedule,
        1500,
        7,
      );
      const mineResult = simulated.find((r) => r.id === mine.id);
      if (mineResult) {
        titleOdds = mineResult.titleOdds;
        playoffOdds = mineResult.playoffOdds;
        await supabase.from("weekly_snapshots").upsert(
          simulated.map((r) => ({
            user_id: league.user_id,
            league_id: league.id,
            team_id: r.id,
            week: league.current_week,
            title_odds: r.titleOdds,
            playoff_odds: r.playoffOdds,
            proj_wins: r.projWins,
            proj_losses: r.projLosses,
            power_score: r.projPointsPerWeek,
          })),
          { onConflict: "league_id,team_id,week" },
        );
      }
    }

    const historyMap = new Map<number, { week: number; titleOdds: number; playoffOdds: number }>();
    for (const row of snapshotRows ?? []) {
      if (row.league_id !== league.id || row.team_id !== mine.id) continue;
      if (historyMap.has(row.week)) continue;
      historyMap.set(row.week, {
        week: row.week,
        titleOdds: Number(row.title_odds),
        playoffOdds: Number(row.playoff_odds),
      });
    }
    if (titleOdds !== null && playoffOdds !== null) {
      historyMap.set(league.current_week, { week: league.current_week, titleOdds, playoffOdds });
    }
    const oddsHistory = [...historyMap.values()].sort((a, b) => a.week - b.week);

    // --- total points race and weekly high bonus ---------------------------
    const contestFormat = asContestFormat((league as { contest_format?: string }).contest_format);
    const weeklyHighOn = Boolean((league as { weekly_high_bonus?: boolean }).weekly_high_bonus);

    // Every team's live lineup this week, using the same scoring and source.
    const liveByTeam = leagueTeams.map((team) => {
      const rows = spots.filter((s) => s.team_id === team.id).map(toRow);
      const lineup = isBestBall ? bestBallRows(rows, "livePoints") : startersOf(rows);
      const projectedLineup = isBestBall ? bestBallRows(rows, "projectedFinal") : lineup;
      const livePoints = sum(lineup, "livePoints");
      const unfinished = projectedLineup.filter((r) => r.gameState !== "post");
      const projectedRemaining = round1(
        unfinished.reduce((acc, r) => acc + Math.max(0, r.projectedFinal - r.livePoints), 0),
      );
      const variance = unfinished.reduce((acc, r) => {
        const sd = Math.max(0, r.projectedFinal - r.livePoints) * 0.35;
        return acc + sd * sd;
      }, 0);
      return {
        team,
        livePoints,
        projectedRemaining,
        playersLeft: unfinished.length,
        sd: Math.max(Math.sqrt(variance), unfinished.length ? 4 : 0.01),
      };
    });

    let pointsRace: LivePointsRace | null = null;
    if (hasPointsRace(contestFormat) && leagueTeams.length > 1) {
      const byWeek = [...liveByTeam].sort((a, b) => b.livePoints - a.livePoints);
      const rankThisWeek = Math.max(1, byWeek.findIndex((e) => e.team.id === mine.id) + 1);

      const season = leagueTeams
        .map((team) => ({ team, total: round1(Number(team.points_for)) }))
        .sort((a, b) => b.total - a.total);
      const seasonIndex = season.findIndex((e) => e.team.id === mine.id);
      const above = seasonIndex > 0 ? season[seasonIndex - 1]! : null;
      const below = seasonIndex >= 0 && seasonIndex < season.length - 1 ? season[seasonIndex + 1]! : null;
      const myTotal = season[seasonIndex]?.total ?? 0;

      const topN = (league as { points_playoff_teams?: number | null }).points_playoff_teams ?? null;
      const raceWeeksLeft = Math.max(0, league.regular_season_weeks - (league.current_week - 1));
      const race = simulatePointsRace(
        leagueTeams.map((team) => {
          const roster = rosterOf(team.id);
          const games = team.wins + team.losses + team.ties;
          const dist = roster.length
            ? (isBestBall ? bestBallDistribution(roster, slots) : teamDistribution(roster, slots))
            : { mean: games > 0 ? Number(team.points_for) / games : 100, sd: 22 };
          return {
            id: team.id,
            name: team.name,
            isMine: team.is_mine,
            pointsFor: Number(team.points_for),
            mean: dist.mean,
            sd: dist.sd,
          };
        }),
        { weeksLeft: raceWeeksLeft, topN },
        1500,
        31,
      );
      const myRace = race.find((r) => r.id === mine.id);
      const myLive = liveByTeam.find((e) => e.team.id === mine.id);

      pointsRace = {
        rankThisWeek,
        seasonRank: seasonIndex >= 0 ? seasonIndex + 1 : leagueTeams.length,
        seasonTotal: myTotal,
        teamCount: leagueTeams.length,
        gapAbove: above ? { name: above.team.name, points: round1(above.total - myTotal) } : null,
        gapBelow: below ? { name: below.team.name, points: round1(myTotal - below.total) } : null,
        firstOdds: myRace?.firstOdds ?? 0,
        topThreeOdds: myRace?.topThreeOdds ?? 0,
        topNOdds: myRace?.topNOdds ?? null,
        topN,
        playersLeft: myLive?.playersLeft ?? 0,
        projectedRemaining: myLive?.projectedRemaining ?? 0,
      };
    }

    let weeklyHigh: LiveWeeklyHigh | null = null;
    if (weeklyHighOn && liveByTeam.length > 1) {
      const highs = simulateWeeklyHigh(
        liveByTeam.map((e) => ({
          id: e.team.id,
          name: e.team.name,
          isMine: e.team.is_mine,
          livePoints: e.livePoints,
          projectedRemaining: e.projectedRemaining,
          sd: e.sd,
        })),
        2000,
        53,
      );
      const myHigh = highs.find((h) => h.id === mine.id);
      const leaderEntry = [...liveByTeam].sort((a, b) => b.livePoints - a.livePoints)[0]!;
      const leading = leaderEntry.team.id === mine.id;
      const rival = leading
        ? [...liveByTeam].sort((a, b) => b.livePoints - a.livePoints)[1] ?? leaderEntry
        : leaderEntry;
      const myLivePoints = liveByTeam.find((e) => e.team.id === mine.id)?.livePoints ?? 0;
      weeklyHigh = {
        probability: myHigh?.probability ?? 0,
        leaderName: rival.team.name,
        gap: round1(rival.livePoints - myLivePoints),
        leading,
        label: (league as { weekly_high_label?: string | null }).weekly_high_label ?? null,
      };
    }

    matchups.push({
      contestFormat,
      pointsRace,
      weeklyHigh,
      leagueId: league.id,
      leagueName: league.name,
      color: (league as { color?: string | null }).color ?? null,
      scoringLabel: scoring.label,
      format,
      week: liveWeek,
      myTeam: mine.name,
      oppTeam: comparisonTeam?.name ?? null,
      myScore: sum(starters, "livePoints"),
      oppScore: sum(oppStarters, "livePoints"),
      myProjected: sum(projectedStarters, "projectedFinal"),
      oppProjected: sum(isBestBall ? bestBallRows(comparisonSpots, "projectedFinal") : oppStarters, "projectedFinal"),
      yetToPlay: starters.filter((r) => r.gameState === "pre").length,
      oppYetToPlay: oppStarters.filter((r) => r.gameState === "pre").length,
      winProbability,
      titleOdds,
      playoffOdds,
      oddsHistory,
      gameState,
      needLine: needLine(
        starters,
        oppStarters,
        sum(starters, "livePoints"),
        sum(oppStarters, "livePoints"),
        gameState,
      ),
      isBestBall,
      leagueRank,
      teamCount: teams.filter((team) => team.league_id === league.id).length,
      starters: starters.sort((a, b) => b.livePoints - a.livePoints),
      bench: mySpots.filter((r) => !starters.includes(r)),
      oppStarters: oppStarters.sort((a, b) => b.livePoints - a.livePoints),
      oppBench: comparisonSpots.filter((r) => !oppStarters.includes(r)),
    });

    // Score the event log with this league's rules, for players in this matchup.
    const sideOf = new Map<string, "mine" | "opponent">();
    for (const s of spots) {
      if (!s.player_id) continue;
      if (s.team_id === mine.id) sideOf.set(s.player_id, "mine");
       else if (comparisonTeam && s.team_id === comparisonTeam.id) sideOf.set(s.player_id, "opponent");
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

  events.sort((a, b) => {
    if (a.occurredAt < b.occurredAt) return 1;
    if (a.occurredAt > b.occurredAt) return -1;
    return b.id.localeCompare(a.id);
  });

  matchups.sort((a, b) => ({ in: 0, pre: 1, post: 2 })[a.gameState] - ({ in: 0, pre: 1, post: 2 })[b.gameState]);

  return {
    season,
    week,
    updatedAt,
    // Summary mode ships the scoreboard only; player rows arrive when a card
    // is opened, which keeps the cross-league payload small.
    matchups: opts.summariesOnly
      ? matchups.map((m) => ({ ...m, starters: [], bench: [], oppStarters: [], oppBench: [] }))
      : matchups,
    events: events.slice(0, 120),
    games,
    nextKickoff: nextKickoffFrom(board),
  };


}
