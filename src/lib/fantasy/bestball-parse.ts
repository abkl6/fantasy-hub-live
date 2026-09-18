/**
 * Reads the entries CSV a best ball site exports: one row per drafted player,
 * grouped into one entry per draft. Tolerant about column names because both
 * sites have changed their headers over time. Pure, no I/O.
 */

import { asBestballSite, type BestballSite } from "./bestball";

export interface BestballPick {
  name: string;
  position: string;
  nflTeam: string | null;
  pickNumber: number | null;
}

export interface ParsedEntry {
  tournament: string;
  entryId: string;
  draftId: string | null;
  draftSlot: number | null;
  /** How many managers were in the draft, when the file says. */
  draftSize: number | null;
  /** Weekly-winner style tournaments are scored week by week, not cumulatively. */
  weekly: boolean;
  players: BestballPick[];
}


export interface ParsedBestballFile {
  site: BestballSite;
  entries: ParsedEntry[];
  /** Rows that had no usable player name. */
  skipped: number;
  /** Header columns the reader did not recognise. */
  unknownColumns: string[];
}

/** Small CSV reader: handles quoted fields and commas inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") field += ch;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim().length));
}

const norm = (value: string) =>
  value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

const COLUMNS = {
  tournament: [
    "tournament_title",
    "tournament_name",
    "tournament",
    "contest_name",
    "contest",
    "contest_title",
    "slate",
  ],
  entryId: [
    "draft_entry_id",
    "draft_entry",
    "entry_id",
    "entry_key",
    "entry",
    "lineup_id",
    "roster_id",
  ],
  draftId: ["draft_id", "draft_key", "draft", "contest_id"],
  slot: ["pick_order", "draft_slot", "draft_position", "slot", "team_pick_slot", "draft_order"],
  size: ["draft_size", "tournament_size", "team_count", "teams"],
  name: ["player_name", "player", "name", "full_name", "playername"],
  firstName: ["first_name", "firstname"],
  lastName: ["last_name", "lastname"],
  position: ["position", "pos", "roster_position", "player_position"],
  team: ["team", "nfl_team", "team_abbreviation", "teamabbrev", "player_team", "team_name"],
  pick: ["overall_pick_number", "overall_pick", "pick_number", "pick", "draft_pick"],
} as const;

type ColumnKey = keyof typeof COLUMNS;

/** Titles are spread across several columns; the first non-empty one wins. */
const TITLE_COLUMNS = [
  "tournament_title",
  "draft_pool_title",
  "weekly_winner_title",
  "tournament_name",
  "contest_name",
  "contest_title",
] as const;

/** Column names that hold a weekly-winner style title. */
const WEEKLY_TITLE_COLUMNS = new Set(["weekly_winner_title"]);

function mapHeaders(header: string[]) {
  const normalized = header.map(norm);
  const index = {} as Record<ColumnKey, number>;
  const used = new Set<number>();
  for (const key of Object.keys(COLUMNS) as ColumnKey[]) {
    const found = (COLUMNS[key] as readonly string[])
      .map((alias) => normalized.indexOf(alias))
      .find((i) => i >= 0);
    index[key] = found ?? -1;
    if (found != null && found >= 0) used.add(found);
  }
  const titles: { column: string; index: number }[] = [];
  for (const column of TITLE_COLUMNS) {
    const i = normalized.indexOf(column);
    if (i >= 0) {
      titles.push({ column, index: i });
      used.add(i);
    }
  }
  const unknownColumns = header.filter((_, i) => !used.has(i) && header[i]!.trim().length);
  return { index, titles, unknownColumns, normalized };
}

/** Which site an export came from, read from its headers. */
export function detectSite(header: string[]): BestballSite | null {
  const set = new Set(header.map(norm));
  if (
    set.has("draft_entry_id") ||
    set.has("draft_entry") ||
    set.has("tournament_title") ||
    set.has("weekly_winner_title") ||
    set.has("draft_pool_title") ||
    set.has("appearance_id")
  ) {
    return "underdog";
  }
  if (set.has("entry_key") || set.has("contest_key") || set.has("draftkings_id")) {
    return "draftkings";
  }
  const joined = header.join(" ").toLowerCase();
  if (joined.includes("underdog")) return "underdog";
  if (joined.includes("draftkings") || joined.includes("draft kings")) return "draftkings";
  return null;
}

const cell = (row: string[], i: number) => (i >= 0 ? (row[i] ?? "").trim() : "");

function toNumber(value: string): number | null {
  const n = Number(value.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) && value.trim() !== "" ? n : null;
}

/**
 * Parses an entries export into one entry per draft. `siteHint` is used when
 * the headers do not name the site (the manager picked a tab).
 */
export function parseBestballCsv(text: string, siteHint?: string | null): ParsedBestballFile {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error("That file has no rows in it.");
  const header = rows[0]!;
  const site = detectSite(header) ?? asBestballSite(siteHint);
  if (!site) {
    throw new Error("That doesn't look like an Underdog or DraftKings entries export.");
  }
  const { index, titles, unknownColumns } = mapHeaders(header);
  if (index.name < 0 && (index.firstName < 0 || index.lastName < 0)) {
    throw new Error("That file has no player name column.");
  }

  const byEntry = new Map<string, ParsedEntry>();
  let skipped = 0;
  let rowNumber = 0;

  for (const row of rows.slice(1)) {
    rowNumber += 1;
    const name =
      cell(row, index.name) ||
      `${cell(row, index.firstName)} ${cell(row, index.lastName)}`.trim();
    if (!name) {
      skipped += 1;
      continue;
    }
    const title = titles.find((t) => cell(row, t.index).length);
    const fallbackTitle = cell(row, index.tournament);
    const tournament = title ? cell(row, title.index) : fallbackTitle || "Best ball tournament";
    const weekly = title ? WEEKLY_TITLE_COLUMNS.has(title.column) : false;
    const draftId = cell(row, index.draftId) || null;
    const entryId = cell(row, index.entryId) || draftId || `row-${rowNumber}`;
    const key = `${tournament}::${entryId}`;
    let entry = byEntry.get(key);
    if (!entry) {
      entry = {
        tournament,
        entryId,
        draftId,
        draftSlot: toNumber(cell(row, index.slot)),
        draftSize: toNumber(cell(row, index.size)),
        weekly,
        players: [],
      };
      byEntry.set(key, entry);
    }
    const team = cell(row, index.team).toUpperCase();
    entry.players.push({
      name,
      position: (cell(row, index.position) || "WR").toUpperCase(),
      nflTeam: team || null,
      pickNumber: toNumber(cell(row, index.pick)),
    });
  }

  const entries = [...byEntry.values()].filter((e) => e.players.length > 0);
  if (!entries.length) throw new Error("No entries could be read from that file.");
  for (const entry of entries) {
    entry.players.sort((a, b) => (a.pickNumber ?? 0) - (b.pickNumber ?? 0));
    if (entry.draftSlot == null) entry.draftSlot = deriveSlot(entry);
  }
  return { site, entries, skipped, unknownColumns };
}

/**
 * Underdog's export has no draft slot, but the first pick of an entry gives it
 * away: in a snake draft, slot = ((first pick − 1) mod draft size) + 1.
 */
function deriveSlot(entry: ParsedEntry): number | null {
  const size = entry.draftSize && entry.draftSize > 1 ? Math.round(entry.draftSize) : null;
  const picks = entry.players.map((p) => p.pickNumber).filter((n): n is number => n != null && n > 0);
  if (!size || !picks.length) return null;
  return ((Math.min(...picks) - 1) % size) + 1;
}


/** Groups parsed entries by tournament, the unit a league is created for. */
export function groupByTournament(entries: ParsedEntry[]): Map<string, ParsedEntry[]> {
  const out = new Map<string, ParsedEntry[]>();
  for (const entry of entries) {
    const list = out.get(entry.tournament) ?? [];
    list.push(entry);
    out.set(entry.tournament, list);
  }
  return out;
}
