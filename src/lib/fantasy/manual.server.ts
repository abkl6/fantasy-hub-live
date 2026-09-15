/**
 * Manually tracked leagues: draft board import, schedule building, weekly
 * transaction log ingest and roster reconciliation. Server-only.
 *
 * All name matching goes through names.ts so "Kenneth Walker III" and
 * "Kenneth Walker" are never treated as two players.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { normalizeName, normalizePosition, playerIndex } from "./names";
import type {
  ManualDraftPreview,
  ManualDraftTeam,
  ManualPlayerRow,
  ManualReconcileDiff,
  ManualScheduleGame,
  ManualTransactionRow,
} from "./manual-types";

type DB = SupabaseClient<Database>;

const POSITIONS = new Set([
  "QB", "RB", "WR", "TE", "K", "PK", "DEF", "DST", "D/ST", "DL", "LB", "DB", "DE", "DT", "CB", "S",
]);

const NFL_TEAMS = new Set([
  "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN", "DET", "GB", "HOU", "IND",
  "JAX", "KC", "LV", "LAC", "LAR", "MIA", "MIN", "NE", "NO", "NYG", "NYJ", "PHI", "PIT", "SEA",
  "SF", "TB", "TEN", "WAS", "WSH",
]);

export const FFPC_SLOTS = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "TE", "FLEX", "K", "DEF"];
export const FFPC_RULES: Record<string, number> = {
  rec: 1,
  bonus_rec_te: 0.5,
  pass_td: 6,
  pass_yd: 0.04,
  pass_int: -2,
  rush_yd: 0.1,
  rush_td: 6,
  rec_yd: 0.1,
  rec_td: 6,
  fum_lost: -2,
};

function cleanCell(value: string): string {
  return value.replace(/^\s*["']|["']\s*$/g, "").trim();
}

/** Pulls a player name, position and NFL team out of one free-form line. */
export function parsePlayerLine(line: string): { name: string; position: string; nflTeam: string | null } | null {
  let text = cleanCell(line);
  if (!text) return null;

  // Strip a leading pick number: "1.03 ", "12. ", "#4 "
  text = text.replace(/^#?\d+(\.\d+)?[).\-–]?\s+/, "");
  if (!text) return null;

  let position = "";
  let nflTeam: string | null = null;

  // "Name (RB - SEA)" / "Name (RB, SEA)" / "Name (SEA - RB)"
  const paren = text.match(/\(([^)]*)\)/);
  if (paren?.[1]) {
    for (const part of paren[1].split(/[-–,/|]/)) {
      const token = part.trim().toUpperCase();
      if (POSITIONS.has(token)) position ||= token;
      else if (NFL_TEAMS.has(token)) nflTeam ??= token;
    }
    text = text.replace(paren[0], " ").trim();
  }

  // Trailing/leading bare tokens: "Bijan Robinson RB ATL" or "RB Bijan Robinson"
  const tokens = text.split(/\s+/).filter(Boolean);
  const nameTokens: string[] = [];
  for (const raw of tokens) {
    const token = raw.replace(/[,|]+$/, "");
    const upper = token.toUpperCase();
    if (!position && POSITIONS.has(upper)) {
      position = upper;
      continue;
    }
    if (!nflTeam && NFL_TEAMS.has(upper) && token === upper && nameTokens.length) {
      nflTeam = upper;
      continue;
    }
    nameTokens.push(token);
  }

  const name = nameTokens.join(" ").replace(/\s{2,}/g, " ").trim();
  if (!name || name.length < 2 || !/[a-zA-Z]/.test(name)) return null;
  return { name, position: normalizePosition(position || "FLEX"), nflTeam };
}

type CanonicalPlayer = { id: string; full_name: string; position: string; nfl_team: string | null };

async function canonicalIndex(supabase: DB) {
  const { data } = await supabase.from("players").select("id, full_name, position, nfl_team");
  return playerIndex<CanonicalPlayer>((data ?? []) as CanonicalPlayer[]);
}

function toRow(
  parsed: { name: string; position: string; nflTeam: string | null },
  index: ReturnType<typeof playerIndex<CanonicalPlayer>>,
): ManualPlayerRow {
  const match = index.find(parsed.name, parsed.position);
  return {
    name: match?.full_name ?? parsed.name,
    position: normalizePosition(match?.position ?? parsed.position),
    nflTeam: parsed.nflTeam ?? match?.nfl_team ?? null,
    matched: Boolean(match),
  };
}

/**
 * Reads a pasted or uploaded draft board into per-team rosters.
 *
 * Three shapes are understood:
 *  - CSV with a team column ("Team,Player,Pos,NFL")
 *  - blocks headed by a team name ("Team 3:" followed by its picks)
 *  - a flat pick list, distributed in snake order across `teamNames`
 */
export async function parseDraftBoard(
  supabase: DB,
  text: string,
  teamNames: string[],
): Promise<ManualDraftPreview> {
  const index = await canonicalIndex(supabase);
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const teams = new Map<string, ManualPlayerRow[]>();
  for (const name of teamNames) teams.set(name, []);
  const nameByNorm = new Map(teamNames.map((n) => [normalizeName(n), n]));

  const push = (team: string, row: ManualPlayerRow) => {
    const list = teams.get(team);
    if (list) list.push(row);
    else teams.set(team, [row]);
  };

  // --- CSV with a team column -------------------------------------------
  const header = lines[0]?.toLowerCase() ?? "";
  const isCsv = lines.some((l) => l.includes(",")) && /team|owner|manager/.test(header) && /player|name/.test(header);
  if (isCsv) {
    const cols = lines[0]!.split(",").map((c) => cleanCell(c).toLowerCase());
    const teamCol = cols.findIndex((c) => /team|owner|manager/.test(c));
    const playerCol = cols.findIndex((c) => /player|name/.test(c));
    const posCol = cols.findIndex((c) => /pos/.test(c));
    const nflCol = cols.findIndex((c) => /nfl|pro|club/.test(c));
    for (const line of lines.slice(1)) {
      const cells = line.split(",").map(cleanCell);
      const rawName = cells[playerCol] ?? "";
      if (!rawName) continue;
      const parsed =
        parsePlayerLine(
          [rawName, cells[posCol] ?? "", cells[nflCol] ?? ""].filter(Boolean).join(" "),
        ) ?? { name: rawName, position: "FLEX", nflTeam: null };
      const teamLabel = cells[teamCol] ?? "";
      const team = nameByNorm.get(normalizeName(teamLabel)) ?? teamLabel ?? teamNames[0]!;
      push(team, toRow(parsed, index));
    }
    return summarize(teams, teamNames);
  }

  // --- team-headed blocks -------------------------------------------------
  const headerIdx = lines.findIndex((l) => isTeamHeading(l, nameByNorm));
  if (headerIdx >= 0) {
    let current = teamNames[0]!;
    for (const line of lines) {
      if (isTeamHeading(line, nameByNorm)) {
        const label = line.replace(/[:\-–]+\s*$/, "").trim();
        current = nameByNorm.get(normalizeName(label)) ?? label;
        if (!teams.has(current)) teams.set(current, []);
        continue;
      }
      const parsed = parsePlayerLine(line);
      if (parsed) push(current, toRow(parsed, index));
    }
    return summarize(teams, teamNames);
  }

  // --- flat pick list, snake order ---------------------------------------
  const picks = lines.map(parsePlayerLine).filter(Boolean) as { name: string; position: string; nflTeam: string | null }[];
  const count = Math.max(teamNames.length, 2);
  picks.forEach((parsed, i) => {
    const round = Math.floor(i / count);
    const withinRound = i % count;
    const slot = round % 2 === 0 ? withinRound : count - 1 - withinRound;
    push(teamNames[slot] ?? `Team ${slot + 1}`, toRow(parsed, index));
  });
  return summarize(teams, teamNames);
}

function isTeamHeading(line: string, nameByNorm: Map<string, string>): boolean {
  const label = line.replace(/[:\-–]+\s*$/, "").trim();
  if (nameByNorm.has(normalizeName(label))) return true;
  return /[:]$/.test(line.trim()) && !parsePlayerLine(line);
}

function summarize(teams: Map<string, ManualPlayerRow[]>, order: string[]): ManualDraftPreview {
  const ordered: ManualDraftTeam[] = [];
  for (const name of order) ordered.push({ name, players: teams.get(name) ?? [] });
  for (const [name, players] of teams) {
    if (!order.includes(name)) ordered.push({ name, players });
  }
  const all = ordered.flatMap((t) => t.players);
  return { teams: ordered, total: all.length, unmatched: all.filter((p) => !p.matched) };
}

/** Round-robin schedule over the regular season, repeating once teams run out. */
export function generateSchedule(teamIds: string[], weeks: number): { week: number; home: string; away: string }[] {
  const ids = [...teamIds];
  if (ids.length % 2 === 1) ids.push("BYE");
  const half = ids.length / 2;
  const rotation = ids.slice(1);
  const games: { week: number; home: string; away: string }[] = [];

  for (let week = 1; week <= weeks; week++) {
    const order = [ids[0]!, ...rotation];
    for (let i = 0; i < half; i++) {
      const home = order[i]!;
      const away = order[order.length - 1 - i]!;
      if (home === "BYE" || away === "BYE") continue;
      games.push(week % 2 === 0 ? { week, home: away, away: home } : { week, home, away });
    }
    rotation.push(rotation.shift()!);
  }
  return games;
}

/** Parses a pasted schedule: "Week 3: Team A vs Team B". */
export function parseSchedule(text: string, teamNames: string[]): ManualScheduleGame[] {
  const nameByNorm = new Map(teamNames.map((n) => [normalizeName(n), n]));
  const resolve = (label: string) => nameByNorm.get(normalizeName(label)) ?? label.trim();
  const games: ManualScheduleGame[] = [];
  let week = 1;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const weekOnly = line.match(/^week\s*(\d{1,2})\s*[:.\-–]?\s*$/i);
    if (weekOnly?.[1]) {
      week = Number(weekOnly[1]);
      continue;
    }
    const inline = line.match(/^week\s*(\d{1,2})\s*[:.\-–]\s*(.+)$/i);
    const body = inline?.[2] ?? line;
    if (inline?.[1]) week = Number(inline[1]);

    const pair = body.split(/\s+(?:vs\.?|v\.?|@|at)\s+/i);
    if (pair.length !== 2 || !pair[0]?.trim() || !pair[1]?.trim()) continue;
    games.push({ week, home: resolve(pair[0]!), away: resolve(pair[1]!) });
  }
  return games;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function parseDate(line: string, fallback: string): string {
  const iso = line.match(/(20\d{2})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const slash = line.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (slash) {
    const year = slash[3] ? (slash[3].length === 2 ? `20${slash[3]}` : slash[3]) : String(new Date().getFullYear());
    return `${year}-${slash[1]!.padStart(2, "0")}-${slash[2]!.padStart(2, "0")}`;
  }
  const named = line.match(/\b([a-z]{3})[a-z]*\.?\s+(\d{1,2})\b/i);
  const month = named?.[1] ? MONTHS[named[1].toLowerCase()] : undefined;
  if (named && month) {
    return `${new Date().getFullYear()}-${String(month).padStart(2, "0")}-${named[2]!.padStart(2, "0")}`;
  }
  return fallback;
}

/**
 * Reads a pasted transaction log. Every entry gets a stable dedupe key of
 * date + action + normalised player name, so pasting the whole log again
 * changes nothing.
 */
export function parseTransactionLog(text: string, teamNames: string[]): ManualTransactionRow[] {
  const nameByNorm = new Map(teamNames.map((n) => [normalizeName(n), n]));
  const today = new Date().toISOString().slice(0, 10);
  const rows: ManualTransactionRow[] = [];
  let currentDate = today;

  const teamIn = (line: string): string | null => {
    for (const [norm, name] of nameByNorm) {
      if (norm && normalizeName(line).includes(norm)) return name;
    }
    return null;
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    currentDate = parseDate(line, currentDate);

    const kindMatch = line.match(/\b(added|added|claimed|dropped|released|waived|traded)\b/i);
    if (!kindMatch?.[1]) continue;
    const verb = kindMatch[1].toLowerCase();
    const kind: ManualTransactionRow["kind"] =
      verb === "traded" ? "trade" : verb === "dropped" || verb === "released" || verb === "waived" ? "drop" : "add";

    const after = line.slice(line.toLowerCase().indexOf(verb) + verb.length);
    const parsed = parsePlayerLine(after.split(/\b(?:from|to|for)\b/i)[0] ?? after);
    if (!parsed) continue;

    const team = teamIn(line.slice(0, line.toLowerCase().indexOf(verb)));
    rows.push({
      occurredOn: currentDate,
      kind,
      playerName: parsed.name,
      position: parsed.position,
      fromTeam: kind === "add" ? null : team,
      toTeam: kind === "drop" ? null : team,
      dedupeKey: `${currentDate}|${kind}|${normalizeName(parsed.name)}`,
      raw: line,
    });
  }
  return rows;
}

/** Reads a full-roster paste into matched player rows. */
export async function parseRosterPaste(supabase: DB, text: string): Promise<ManualPlayerRow[]> {
  const index = await canonicalIndex(supabase);
  return text
    .split(/\r?\n/)
    .map((line) => parsePlayerLine(line))
    .filter(Boolean)
    .map((parsed) => toRow(parsed!, index));
}

/** Diffs a pasted roster against what the app currently tracks for a team. */
export async function reconcileRoster(
  supabase: DB,
  leagueId: string,
  teamId: string,
  text: string,
): Promise<ManualReconcileDiff> {
  const [{ data: team }, { data: spots }] = await Promise.all([
    supabase.from("teams").select("id, name").eq("id", teamId).maybeSingle(),
    supabase.from("roster_spots").select("player_name, position").eq("team_id", teamId),
  ]);

  const pasted = await parseRosterPaste(supabase, text);
  const pastedKeys = new Set(pasted.map((p) => normalizeName(p.name)));
  const currentKeys = new Set((spots ?? []).map((s) => normalizeName(s.player_name)));

  const added = pasted.filter((p) => !currentKeys.has(normalizeName(p.name)));
  const dropped = (spots ?? [])
    .filter((s) => !pastedKeys.has(normalizeName(s.player_name)))
    .map((s) => ({
      name: s.player_name,
      position: normalizePosition(s.position),
      nflTeam: null,
      matched: true,
    }));

  return {
    teamId,
    teamName: team?.name ?? "Team",
    added,
    dropped,
    unchanged: pasted.length - added.length,
  };
}

/** Records unresolved names so they show up in the review queue. */
export async function queueUnmatched(supabase: DB, rows: ManualPlayerRow[], source: string) {
  const unmatched = rows.filter((r) => !r.matched);
  if (!unmatched.length) return;
  await supabase.from("unmatched_players").insert(
    unmatched.map((r) => ({
      raw_name: r.name,
      position: r.position,
      nfl_team: r.nflTeam,
      payload: { source },
      status: "pending",
    })) as never,
  );
}

/** Marks a league's tracked rosters as confirmed right now. */
export async function touchConfirmed(supabase: DB, leagueId: string) {
  await supabase
    .from("leagues")
    .update({ last_confirmed_at: new Date().toISOString() })
    .eq("id", leagueId);
}
