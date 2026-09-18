/**
 * Best ball tournament import and scoring. Server-only.
 *
 * Each tournament becomes a league (platform = the site, format = best ball,
 * contest = total points) holding one entry per draft. Weekly scores are the
 * best valid lineup from that week's actual stats, or from projections for
 * weeks that haven't been played.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

import {
  BESTBALL_SCORING,
  BESTBALL_SLOTS,
  BESTBALL_SITE_LABELS,
  ROUND_ONE_LAST_WEEK,
  isWeeklyTournament,
  tournamentKey,
  type BestballSite,
} from "./bestball";

import { groupByTournament, type ParsedEntry } from "./bestball-parse";
import { eligiblePositions } from "./eligibility";
import { optimalLineup, type EnginePlayer } from "./engine";
import { normalizeName, playerIndex } from "./names";
import { fetchAllRows } from "./paginate";
import { leagueScoring, type StatLine } from "./scoring";

type DB = SupabaseClient<Database>;

export interface ImportedTournament {
  leagueId: string;
  name: string;
  entries: number;
  players: number;
  unmatched: string[];
}

function asStats(value: unknown): StatLine {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: StatLine = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const n = Number(v);
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
}

/** The season and week the rest of the account is working in. */
async function accountSeason(supabase: DB) {
  const { data } = await supabase
    .from("leagues")
    .select("season, current_week")
    .order("season", { ascending: false })
    .limit(1)
    .maybeSingle();
  return {
    season: data?.season ?? new Date().getFullYear(),
    currentWeek: data?.current_week ?? 1,
  };
}

/**
 * Replaces every entry of each tournament in the file and returns what was
 * stored, with any player names that matched nobody.
 */
export async function importBestball(
  supabase: DB,
  userId: string,
  site: BestballSite,
  entries: ParsedEntry[],
): Promise<ImportedTournament[]> {
  const { season, currentWeek } = await accountSeason(supabase);

  const canonical = await fetchAllRows<{
    id: string;
    full_name: string;
    position: string;
    nfl_team: string | null;
  }>((from, to) =>
    supabase.from("players").select("id, full_name, position, nfl_team").order("id").range(from, to),
  );
  const index = playerIndex(canonical);

  const out: ImportedTournament[] = [];

  for (const [tournament, list] of groupByTournament(entries)) {
    const externalId = tournamentKey(site, tournament);

    // A re-import replaces the tournament outright; entries cascade away.
    await supabase.from("leagues").delete().eq("platform", site).eq("external_id", externalId);

    const { data: league, error: leagueError } = await supabase
      .from("leagues")
      .insert({
        user_id: userId,
        platform: site,
        external_id: externalId,
        name: tournament,
        season,
        current_week: currentWeek,
        team_count: list.find((e) => e.draftSize && e.draftSize > 1)?.draftSize ?? list.length,
        playoff_teams: 0,

        regular_season_weeks: ROUND_ONE_LAST_WEEK,
        scoring_type: BESTBALL_SCORING[site],
        scoring_rules: {},
        roster_slots: BESTBALL_SLOTS,
        eligible_positions: eligiblePositions(BESTBALL_SLOTS),
        contest_format: "points",
        format: "best_ball",
        league_type: "redraft",
        variant: "none",
        type_source: "detected",
        last_synced_at: new Date().toISOString(),
      })
      .select("id, name")
      .single();
    if (leagueError || !league) {
      throw new Error(leagueError?.message ?? "Could not save that tournament.");
    }

    const { data: savedEntries, error: entryError } = await supabase
      .from("bestball_entries")
      .insert(
        list.map((entry) => ({
          user_id: userId,
          league_id: league.id,
          tournament,
          entry_id: entry.entryId,
          draft_id: entry.draftId,
          draft_slot: entry.draftSlot,
        })),
      )
      .select("id, entry_id");
    if (entryError) throw new Error(entryError.message);

    const idByEntry = new Map((savedEntries ?? []).map((e) => [e.entry_id, e.id]));
    const unmatched = new Set<string>();
    const rows = list.flatMap((entry) => {
      const id = idByEntry.get(entry.entryId);
      if (!id) return [];
      return entry.players.map((player) => {
        const match = index.find(player.name, player.position, player.nflTeam);
        if (!match) unmatched.add(player.name);
        return {
          user_id: userId,
          entry_id: id,
          league_id: league.id,
          player_id: match?.id ?? null,
          player_name: match?.full_name ?? player.name,
          norm_name: normalizeName(match?.full_name ?? player.name),
          position: (match?.position ?? player.position).toUpperCase(),
          nfl_team: player.nflTeam ?? match?.nfl_team ?? null,
          pick_number: player.pickNumber,
        };
      });
    });

    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase.from("bestball_entry_players").insert(rows.slice(i, i + 500));
      if (error) throw new Error(error.message);
    }

    out.push({
      leagueId: league.id,
      name: league.name,
      entries: list.length,
      players: rows.length,
      unmatched: [...unmatched].slice(0, 40),
    });
  }

  return out;
}

// --- scoring ---------------------------------------------------------------

export interface EntryWeek {
  week: number;
  points: number;
  /** True when the week is scored from real stats rather than projections. */
  actual: boolean;
}

export interface BestballEntryRow {
  id: string;
  entryId: string;
  draftSlot: number | null;
  weeks: EntryWeek[];
  /** Running total through week 14 — the round one total. */
  total: number;
  rank: number;
  players: { name: string; position: string; nflTeam: string | null }[];
}

export interface BestballPayload {
  leagueId: string;
  name: string;
  site: BestballSite;
  siteLabel: string;
  season: number;
  lastWeek: number;
  scoringLabel: string;
  entries: BestballEntryRow[];
}

interface WeekPoints {
  points: number;
  actual: boolean;
}

/** Points per player per week, actuals first and projections after. */
async function weeklyPoints(
  supabase: DB,
  userId: string,
  season: number,
  playerIds: string[],
  positionById: Map<string, string>,
  score: (position: string, stats: StatLine) => number,
): Promise<Map<string, WeekPoints>> {
  const out = new Map<string, WeekPoints>();
  if (!playerIds.length) return out;

  const sources = ["actual", `user:${userId}`, "app"];
  const rank = new Map(sources.map((s, i) => [s, i]));

  for (let i = 0; i < playerIds.length; i += 300) {
    const slice = playerIds.slice(i, i + 300);
    const rows = await fetchAllRows<{
      player_id: string;
      week: number;
      source: string;
      stats: unknown;
    }>((from, to) =>
      supabase
        .from("player_week_stats")
        .select("player_id, week, source, stats")
        .eq("season", season)
        .lte("week", ROUND_ONE_LAST_WEEK)
        .in("player_id", slice)
        .in("source", sources)
        .order("player_id")
        .range(from, to),
    );
    const best = new Map<string, { rank: number; row: (typeof rows)[number] }>();
    for (const row of rows) {
      const key = `${row.player_id}|${row.week}`;
      const r = rank.get(row.source) ?? 99;
      const current = best.get(key);
      if (!current || r < current.rank) best.set(key, { rank: r, row });
    }
    for (const [key, { row }] of best) {
      const position = positionById.get(row.player_id) ?? "WR";
      out.set(key, {
        points: score(position, asStats(row.stats)),
        actual: row.source === "actual",
      });
    }
  }
  return out;
}

/** Every entry in a tournament with its weekly and running scores. */
export async function buildBestball(
  supabase: DB,
  userId: string,
  leagueId: string,
): Promise<BestballPayload | null> {
  const { data: league } = await supabase
    .from("leagues")
    .select("id, name, platform, season, scoring_type, scoring_rules, roster_slots, current_week")
    .eq("id", leagueId)
    .maybeSingle();
  if (!league) return null;
  const site = String(league.platform).toLowerCase() as BestballSite;
  if (site !== "underdog" && site !== "draftkings") return null;

  const [{ data: entryRows }, { data: playerRows }] = await Promise.all([
    supabase
      .from("bestball_entries")
      .select("id, entry_id, draft_slot")
      .eq("league_id", leagueId)
      .order("draft_slot"),
    supabase
      .from("bestball_entry_players")
      .select("entry_id, player_id, player_name, position, nfl_team")
      .eq("league_id", leagueId),
  ]);

  const scoring = leagueScoring(league.scoring_type, league.scoring_rules as never);
  const slots = Array.isArray(league.roster_slots)
    ? (league.roster_slots as string[])
    : BESTBALL_SLOTS;

  const positionById = new Map<string, string>();
  for (const row of playerRows ?? []) {
    if (row.player_id) positionById.set(row.player_id, row.position);
  }
  const points = await weeklyPoints(
    supabase,
    userId,
    league.season,
    [...positionById.keys()],
    positionById,
    (position, stats) => scoring.score(position, stats),
  );

  const byEntry = new Map<string, typeof playerRows>();
  for (const row of playerRows ?? []) {
    const list = byEntry.get(row.entry_id) ?? [];
    list.push(row);
    byEntry.set(row.entry_id, list as never);
  }

  const rows: BestballEntryRow[] = (entryRows ?? []).map((entry) => {
    const roster = byEntry.get(entry.id) ?? [];
    const weeks: EntryWeek[] = [];
    let total = 0;
    for (let week = 1; week <= ROUND_ONE_LAST_WEEK; week++) {
      let anyActual = false;
      const pool: EnginePlayer[] = roster.map((p) => {
        const found = p.player_id ? points.get(`${p.player_id}|${week}`) : undefined;
        if (found?.actual) anyActual = true;
        return {
          id: p.player_id,
          name: p.player_name,
          position: p.position,
          nflTeam: p.nfl_team,
          proj: found?.points ?? 0,
        };
      });
      const best = optimalLineup(pool, slots);
      const weekPoints = Math.round(best.total * 10) / 10;
      total += weekPoints;
      weeks.push({ week, points: weekPoints, actual: anyActual });
    }
    return {
      id: entry.id,
      entryId: entry.entry_id,
      draftSlot: entry.draft_slot,
      weeks,
      total: Math.round(total * 10) / 10,
      rank: 0,
      players: roster.map((p) => ({
        name: p.player_name,
        position: p.position,
        nflTeam: p.nfl_team,
      })),
    };
  });

  rows.sort((a, b) => b.total - a.total);
  rows.forEach((row, i) => {
    row.rank = i + 1;
  });

  return {
    leagueId,
    name: league.name,
    site,
    siteLabel: BESTBALL_SITE_LABELS[site],
    season: league.season,
    lastWeek: ROUND_ONE_LAST_WEEK,
    scoringLabel: scoring.label,
    entries: rows,
  };
}

// --- exposure and games ----------------------------------------------------

export interface BestballExposureRow {
  name: string;
  position: string;
  nflTeam: string | null;
  entries: number;
  tournaments: string[];
}

/** How many of my best ball entries hold each player. */
export async function bestballExposure(supabase: DB): Promise<{
  totalEntries: number;
  players: BestballExposureRow[];
}> {
  const { data: entries } = await supabase.from("bestball_entries").select("id, tournament");
  if (!entries?.length) return { totalEntries: 0, players: [] };

  const rows = await fetchAllRows<{
    entry_id: string;
    player_name: string;
    position: string;
    nfl_team: string | null;
  }>((from, to) =>
    supabase
      .from("bestball_entry_players")
      .select("entry_id, player_name, position, nfl_team")
      .order("entry_id")
      .range(from, to),
  );

  const tournamentByEntry = new Map(entries.map((e) => [e.id, e.tournament]));
  const map = new Map<string, BestballExposureRow & { seen: Set<string> }>();
  for (const row of rows) {
    const key = `${normalizeName(row.player_name)}::${row.position}`;
    const current = map.get(key);
    const tournament = tournamentByEntry.get(row.entry_id) ?? "";
    if (current) {
      current.entries += 1;
      if (tournament) current.seen.add(tournament);
    } else {
      map.set(key, {
        name: row.player_name,
        position: row.position,
        nflTeam: row.nfl_team,
        entries: 1,
        tournaments: [],
        seen: new Set(tournament ? [tournament] : []),
      });
    }
  }

  const players = [...map.values()]
    .map(({ seen, ...rest }) => ({ ...rest, tournaments: [...seen] }))
    .sort((a, b) => b.entries - a.entries || a.name.localeCompare(b.name));

  return { totalEntries: entries.length, players };
}
