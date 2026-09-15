/**
 * Weekly projections published by the host platforms.
 *
 * Sleeper and ESPN both publish a projected stat line per player per week.
 * We store those lines in `player_week_stats` under `source = 'sleeper'` or
 * `'espn'`, so a league set to "platform" is scored from its own host's
 * numbers with its own scoring rules. Server-only.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

import { playerIndex } from "./names";
import { fetchAllRows } from "./paginate";
import { BASELINE_RULES, scoreStats, type StatLine } from "./scoring";

type DB = SupabaseClient<Database>;

export interface ImportResult {
  source: string;
  week: number;
  matched: number;
  unmatched: string[];
}

/** Platform stat keys we do not carry are dropped; the rest are renamed. */
const STAT_ALIASES: Record<string, string> = {
  fgm: "fg_made",
  fgmiss: "fg_miss",
  xpm: "xp_made",
  xpmiss: "xp_miss",
  fgm_40_49: "fg_40_49",
  fgm_50p: "fg_50p",
  fgm_0_19: "fg_0_29",
  fgm_20_29: "fg_0_29",
  fgm_30_39: "fg_30_39",
  sack: "def_sack",
  int: "def_int",
  ff: "def_ff",
  fum_rec: "def_fr",
  def_st_td: "def_td",
  st_td: "def_td",
  safe: "def_saf",
  pts_allow_0: "pa_0",
  pts_allow_1_6: "pa_1_6",
  pts_allow_7_13: "pa_7_13",
  pts_allow_14_20: "pa_14_20",
  pts_allow_21_27: "pa_21_27",
  pts_allow_28_34: "pa_28_34",
  pts_allow_35p: "pa_35p",
  idp_tkl_solo: "idp_solo",
  idp_tkl_ast: "idp_ast",
  idp_sack: "idp_sack",
  idp_int: "idp_int",
  idp_fum_rec: "idp_fr",
  idp_ff: "idp_ff",
  idp_def_td: "idp_td",
};

const KEEP = new Set(Object.keys(BASELINE_RULES));

function cleanStats(raw: Record<string, unknown>): StatLine {
  const out: StatLine = {};
  for (const [rawKey, rawValue] of Object.entries(raw)) {
    const key = STAT_ALIASES[rawKey] ?? rawKey;
    if (!KEEP.has(key)) continue;
    const n = Number(rawValue);
    if (!Number.isFinite(n) || n === 0) continue;
    out[key] = (out[key] ?? 0) + n;
  }
  return out;
}

async function playerLookup(supabase: DB) {
  const rows = await fetchAllRows<{
    id: string;
    full_name: string;
    position: string;
    sleeper_id: string | null;
  }>((from, to) =>
    supabase.from("players").select("id, full_name, position, sleeper_id").order("id").range(from, to),
  );
  const bySleeper = new Map<string, (typeof rows)[number]>();
  for (const row of rows) if (row.sleeper_id) bySleeper.set(row.sleeper_id, row);
  return { rows, bySleeper, index: playerIndex(rows) };
}

interface StatRow {
  player_id: string;
  season: number;
  week: number;
  opponent: string | null;
  stats: StatLine;
  src_points: number;
  source: string;
}

async function writeRows(supabase: DB, rows: StatRow[]) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase
      .from("player_week_stats")
      .upsert(rows.slice(i, i + 500) as never, { onConflict: "player_id,season,week,source" });
    if (error) throw new Error(error.message);
  }
}

async function opponentMap(supabase: DB, season: number, week: number) {
  const { data } = await supabase
    .from("nfl_schedule")
    .select("nfl_team, opponent")
    .eq("season", season)
    .eq("week", week);
  const map = new Map<string, string | null>();
  for (const row of data ?? []) map.set(row.nfl_team.toUpperCase(), row.opponent);
  return map;
}

// --------------------------------------------------------------- Sleeper

interface SleeperProjection {
  player_id?: string;
  stats?: Record<string, unknown>;
  opponent?: string | null;
  player?: {
    first_name?: string;
    last_name?: string;
    full_name?: string;
    position?: string;
    team?: string | null;
  };
  team?: string | null;
}

const SLEEPER_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF", "DL", "LB", "DB"];

export async function importSleeperProjections(
  supabase: DB,
  season: number,
  week: number,
): Promise<ImportResult> {
  const query = [
    "season_type=regular",
    ...SLEEPER_POSITIONS.map((p) => `position[]=${p}`),
    "order_by=ppr",
  ].join("&");
  const res = await fetch(`https://api.sleeper.com/projections/nfl/${season}/${week}?${query}`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Sleeper projections request failed (${res.status}).`);
  const raw = (await res.json()) as SleeperProjection[];

  const { bySleeper, index } = await playerLookup(supabase);
  const opponents = await opponentMap(supabase, season, week);

  const rows: StatRow[] = [];
  const unmatched: string[] = [];
  const seen = new Set<string>();

  for (const entry of raw ?? []) {
    const name =
      entry.player?.full_name ??
      [entry.player?.first_name, entry.player?.last_name].filter(Boolean).join(" ");
    const position = entry.player?.position ?? "";
    const hit =
      (entry.player_id ? bySleeper.get(entry.player_id) : undefined) ?? index.find(name, position);
    if (!hit) {
      if (name) unmatched.push(name);
      continue;
    }
    if (seen.has(hit.id)) continue;
    const stats = cleanStats(entry.stats ?? {});
    if (!Object.keys(stats).length) continue; // no projected usage this week
    seen.add(hit.id);
    const team = (entry.player?.team ?? entry.team ?? "").toUpperCase();
    rows.push({
      player_id: hit.id,
      season,
      week,
      opponent: entry.opponent ?? (team ? (opponents.get(team) ?? null) : null),
      stats,
      src_points: Math.round(scoreStats(stats, BASELINE_RULES, hit.position) * 100) / 100,
      source: "sleeper",
    });
  }

  await writeRows(supabase, rows);
  return { source: "sleeper", week, matched: rows.length, unmatched: unmatched.slice(0, 50) };
}

// ------------------------------------------------------------------ ESPN

/** ESPN stat ids we can map onto our own stat keys. */
const ESPN_STAT_IDS: Record<string, string> = {
  "3": "pass_yd",
  "4": "pass_td",
  "20": "pass_int",
  "24": "rush_yd",
  "25": "rush_td",
  "42": "rec_yd",
  "43": "rec_td",
  "53": "rec",
  "72": "fum_lost",
  "74": "fg_0_29",
  "77": "fg_30_39",
  "80": "fg_40_49",
  "83": "fg_50p",
  "85": "fg_miss",
  "86": "xp_made",
  "88": "xp_miss",
  "99": "def_sack",
  "95": "def_int",
  "96": "def_fr",
  "101": "def_td",
  "98": "def_saf",
  "106": "def_ff",
};

interface EspnPlayerEntry {
  player?: {
    fullName?: string;
    defaultPositionId?: number;
    proTeamId?: number;
    stats?: {
      statSourceId?: number;
      statSplitTypeId?: number;
      scoringPeriodId?: number;
      stats?: Record<string, number>;
    }[];
  };
}

const ESPN_POSITION: Record<number, string> = { 1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "DEF" };

const ESPN_PRO_TEAM: Record<number, string> = {
  1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL", 7: "DEN",
  8: "DET", 9: "GB", 10: "TEN", 11: "IND", 12: "KC", 13: "LV", 14: "LAR", 15: "MIA",
  16: "MIN", 17: "NE", 18: "NO", 19: "NYG", 20: "NYJ", 21: "PHI", 22: "ARI",
  23: "PIT", 24: "LAC", 25: "SF", 26: "SEA", 27: "TB", 28: "WAS", 29: "CAR",
  30: "JAX", 33: "BAL", 34: "HOU",
};

export async function importEspnProjections(
  supabase: DB,
  espnLeagueId: string,
  season: number,
  week: number,
  creds?: { swid?: string | null; espnS2?: string | null },
): Promise<ImportResult> {
  const filter = {
    players: {
      limit: 1500,
      sortPercOwned: { sortAsc: false, sortPriority: 1 },
    },
  };
  const cookie =
    creds?.swid && creds.espnS2
      ? `SWID=${creds.swid.startsWith("{") ? creds.swid : `{${creds.swid}}`}; espn_s2=${creds.espnS2}`
      : undefined;
  const res = await fetch(
    `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${espnLeagueId}?scoringPeriodId=${week}&view=kona_player_info`,
    {
      headers: {
        accept: "application/json",
        "x-fantasy-filter": JSON.stringify(filter),
        ...(cookie ? { cookie } : {}),
      },
    },
  );
  if (!res.ok) throw new Error(`ESPN projections request failed (${res.status}).`);
  const body = (await res.json()) as { players?: EspnPlayerEntry[] };

  const { index } = await playerLookup(supabase);
  const opponents = await opponentMap(supabase, season, week);
  const proTeam = ESPN_PRO_TEAM;

  const rows: StatRow[] = [];
  const unmatched: string[] = [];
  const seen = new Set<string>();

  for (const entry of body.players ?? []) {
    const p = entry.player;
    if (!p?.fullName) continue;
    const position = ESPN_POSITION[p.defaultPositionId ?? 0] ?? "";
    const hit = index.find(p.fullName, position);
    if (!hit) {
      unmatched.push(p.fullName);
      continue;
    }
    if (seen.has(hit.id)) continue;
    // statSourceId 1 = projected, statSplitTypeId 1 = single week
    const line = (p.stats ?? []).find(
      (s) => s.statSourceId === 1 && s.scoringPeriodId === week && s.stats,
    );
    if (!line?.stats) continue;
    const mapped: Record<string, unknown> = {};
    for (const [id, value] of Object.entries(line.stats)) {
      const key = ESPN_STAT_IDS[id];
      if (key) mapped[key] = value;
    }
    const stats = cleanStats(mapped);
    if (!Object.keys(stats).length) continue;
    seen.add(hit.id);
    const team = proTeam?.[p.proTeamId ?? 0];
    rows.push({
      player_id: hit.id,
      season,
      week,
      opponent: team ? (opponents.get(team) ?? null) : null,
      stats,
      src_points: Math.round(scoreStats(stats, BASELINE_RULES, hit.position) * 100) / 100,
      source: "espn",
    });
  }

  await writeRows(supabase, rows);
  return { source: "espn", week, matched: rows.length, unmatched: unmatched.slice(0, 50) };
}
