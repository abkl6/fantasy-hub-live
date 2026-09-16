/**
 * Tolerant HTML helpers for reading FFPC (myffpc.com) pages.
 *
 * FFPC has no public API, so the league pages are read as HTML. Everything in
 * here is pure string work with no I/O so it can be unit tested, and every
 * function returns an empty / null result instead of throwing — a page whose
 * markup has changed must degrade into "sync paused", never a crash.
 */

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  "#39": "'",
  "#160": " ",
};

export function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, code: string) => {
    const known = ENTITIES[code.toLowerCase()] ?? ENTITIES[code];
    if (known) return known;
    if (code.startsWith("#x") || code.startsWith("#X")) {
      return String.fromCodePoint(parseInt(code.slice(2), 16));
    }
    if (code.startsWith("#")) return String.fromCodePoint(Number(code.slice(1)));
    return whole;
  });
}

/** Visible text of an HTML fragment, whitespace collapsed. */
export function text(html: string): string {
  return decodeEntities(
    html
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]*>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

export interface HtmlTable {
  /** Header cells of the first row that looks like a header. */
  headers: string[];
  /** Body rows as plain text cells. */
  rows: string[][];
  /** The same body rows with their original cell HTML, for link/id digging. */
  rawRows: string[][];
}

function cells(rowHtml: string): { raw: string[]; text: string[] } {
  const raw: string[] = [];
  const out: string[] = [];
  const re = /<t([dh])\b[^>]*>([\s\S]*?)<\/t\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rowHtml))) {
    raw.push(m[2] ?? "");
    out.push(text(m[2] ?? ""));
  }
  return { raw, text: out };
}

/** Every table on the page, innermost first (FFPC nests layout tables). */
export function tables(html: string): HtmlTable[] {
  const found: HtmlTable[] = [];
  const re = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const body = m[1] ?? "";
    const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    const rows: string[][] = [];
    const rawRows: string[][] = [];
    let r: RegExpExecArray | null;
    while ((r = rowRe.exec(body))) {
      const c = cells(r[1] ?? "");
      if (!c.text.length) continue;
      rows.push(c.text);
      rawRows.push(c.raw);
    }
    if (!rows.length) continue;
    const headers = (rows[0] ?? []).map((h) => h.trim());
    found.push({ headers, rows: rows.slice(1), rawRows: rawRows.slice(1) });
  }
  return found;
}

/** First table whose header row mentions all of the given words. */
export function findTable(html: string, ...needles: string[]): HtmlTable | null {
  const wanted = needles.map((n) => n.toLowerCase());
  for (const table of tables(html)) {
    const head = table.headers.join(" | ").toLowerCase();
    if (wanted.every((n) => head.includes(n))) return table;
  }
  return null;
}

export function columnIndex(table: HtmlTable, ...names: string[]): number {
  const wanted = names.map((n) => n.toLowerCase());
  return table.headers.findIndex((h) => wanted.some((n) => h.toLowerCase().includes(n)));
}

export function toNumber(value: string | undefined | null): number {
  if (!value) return 0;
  const n = Number(String(value).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export interface FfpcPlayer {
  name: string;
  position: string;
  nflTeam: string | null;
}

const POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "PK", "DEF", "DST", "D/ST", "DL", "LB", "DB"]);

/**
 * FFPC writes players as "Last, First TEAM (POS)" — sometimes without the team,
 * sometimes as "Ravens, Baltimore BAL (DEF)". Returns the name the rest of the
 * app matches on (which always goes through names.ts afterwards).
 */
export function parsePlayerCell(value: string): FfpcPlayer | null {
  const raw = text(value);
  if (!raw) return null;
  // Header and spacer cells look like names; a real cell always has two words.
  if (/^(player|name|position|pos|slot|team|starters?|bench|empty|total|--?)$/i.test(raw)) {
    return null;
  }

  let position = "";
  let rest = raw;
  const posMatch = rest.match(/\(([^)]+)\)\s*$/);
  if (posMatch) {
    position = (posMatch[1] ?? "").trim().toUpperCase();
    rest = rest.slice(0, posMatch.index).trim();
  }

  let nflTeam: string | null = null;
  const teamMatch = rest.match(/\s([A-Z]{2,3})$/);
  if (teamMatch) {
    nflTeam = teamMatch[1] ?? null;
    rest = rest.slice(0, teamMatch.index).trim();
  }

  rest = rest.replace(/[,\s]+$/, "").trim();
  if (!rest) return null;

  // "Last, First" -> "First Last"; team defenses keep their own order.
  let name = rest;
  const comma = rest.indexOf(",");
  if (comma > 0) {
    const last = rest.slice(0, comma).trim();
    const first = rest.slice(comma + 1).trim();
    if (first) name = `${first} ${last}`;
  }

  if (!position) position = /defense|d\/st|\bdst\b/i.test(raw) ? "DEF" : "";
  if (position && !POSITIONS.has(position)) {
    const head = position.split(/[\s/]/)[0]?.toUpperCase() ?? "";
    position = POSITIONS.has(head) ? head : position;
  }

  return { name, position: position || "WR", nflTeam };
}

/** Pulls `viewingTeam` / `teamID` style ids out of the links inside a cell. */
export function idFromLinks(rawCell: string, ...params: string[]): string | null {
  for (const param of params) {
    const m = rawCell.match(new RegExp(`${param}=([0-9]+)`, "i"));
    if (m) return m[1] ?? null;
  }
  return null;
}

/** Any myffpc.com URL -> the league id and the private ltuid token. */
export function parseFfpcUrl(input: string): { leagueId: string; ltuid: string } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  if (!/(^|\.)myffpc\.com$/i.test(url.hostname)) return null;

  const get = (name: string) => {
    for (const [key, value] of url.searchParams) {
      if (key.toLowerCase() === name.toLowerCase() && value) return value;
    }
    return null;
  };

  const ltuid = get("ltuid");
  const leagueId = get("leagueid") ?? get("leagueno") ?? get("lid");
  if (!ltuid || !leagueId) return null;
  return { leagueId, ltuid };
}

/** "Season VP" in the standings means the league is scored on victory points. */
export function detectVictoryPoints(html: string): boolean {
  return /season\s*vp|victory\s*points?\b|\bvp\b\s*(total|points)/i.test(html);
}

/** The league home notice lists all-play weeks, e.g. "All-Play Weeks: 1, 7, 14". */
export function detectAllPlayWeeks(html: string): number[] {
  const flat = text(html);
  const m = flat.match(/all[\s-]?play[^.:]*[:\s]+((?:\d{1,2}\s*(?:,|and|&|through|-|–)?\s*)+)/i);
  if (!m) return [];
  const segment = m[1] ?? "";
  const weeks = new Set<number>();
  const rangeRe = /(\d{1,2})\s*(?:-|–|through)\s*(\d{1,2})/g;
  let r: RegExpExecArray | null;
  let consumed = segment;
  while ((r = rangeRe.exec(segment))) {
    const from = Number(r[1]);
    const to = Number(r[2]);
    for (let w = Math.min(from, to); w <= Math.max(from, to); w++) weeks.add(w);
    consumed = consumed.replace(r[0], " ");
  }
  for (const n of consumed.match(/\d{1,2}/g) ?? []) {
    const w = Number(n);
    if (w >= 1 && w <= 18) weeks.add(w);
  }
  return [...weeks].sort((a, b) => a - b);
}
