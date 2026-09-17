/**
 * Upload templates for projections.
 *
 * Four groups, each with its own spreadsheet layout: offence, team defence,
 * individual defenders and kickers. A template is one row per player for the
 * whole season; the app splits those totals into weeks itself.
 *
 * Pure: no I/O, so the column maps can be tested directly.
 */

import { STAT_ALIASES } from "./scoring";

export type TemplateGroup = "offense" | "dst" | "idp" | "k";

export const TEMPLATE_GROUPS: TemplateGroup[] = ["offense", "dst", "idp", "k"];

export const GROUP_LABEL: Record<TemplateGroup, string> = {
  offense: "Offence (QB, RB, WR, TE)",
  dst: "Team defence (DST)",
  idp: "Individual defenders (DL, LB, DB)",
  k: "Kickers (K)",
};

/** Player positions each template covers. */
export const GROUP_POSITIONS: Record<TemplateGroup, string[]> = {
  offense: ["QB", "RB", "WR", "TE"],
  dst: ["DST", "DEF"],
  idp: ["DL", "LB", "DB"],
  k: ["K"],
};

export interface TemplateColumn {
  /** Column heading in the spreadsheet. */
  header: string;
  /** Scoring key it maps to, or null when the column is for information only. */
  key: string | null;
  /** Plain-English meaning, used by the printable guide. */
  meaning: string;
}

const ID_COLUMNS: TemplateColumn[] = [
  { header: "player_key", key: null, meaning: "Name and team joined by a bar, e.g. Bijan Robinson|ATL. Used to match players." },
  { header: "name", key: null, meaning: "Player name, or the full team name for a defence." },
  { header: "pos", key: null, meaning: "QB, RB, WR, TE, K, DST, DL, LB or DB." },
  { header: "nfl_team", key: null, meaning: "Three-letter NFL team code." },
  { header: "bye", key: null, meaning: "Bye week. Left out of the split automatically." },
];

const OFFENSE_STATS: TemplateColumn[] = [
  { header: "PASS YD", key: "pass_yd", meaning: "Passing yards for the season." },
  { header: "PASS TD", key: "pass_td", meaning: "Passing touchdowns." },
  { header: "INT", key: "pass_int", meaning: "Interceptions thrown." },
  { header: "RUSH YD", key: "rush_yd", meaning: "Rushing yards." },
  { header: "RUSH TD", key: "rush_td", meaning: "Rushing touchdowns." },
  { header: "REC", key: "rec", meaning: "Receptions." },
  { header: "REC YD", key: "rec_yd", meaning: "Receiving yards." },
  { header: "REC TD", key: "rec_td", meaning: "Receiving touchdowns." },
  { header: "FUM", key: "fum_lost", meaning: "Fumbles lost." },
];

const DST_STATS: TemplateColumn[] = [
  { header: "SCK", key: "def_sack", meaning: "Sacks by the defence." },
  { header: "SAF", key: "def_saf", meaning: "Safeties." },
  { header: "INT", key: "def_int", meaning: "Interceptions." },
  { header: "FR", key: "def_fr", meaning: "Fumbles recovered." },
  { header: "TD", key: "def_td", meaning: "Defensive and return touchdowns." },
  { header: "FF", key: "def_ff", meaning: "Forced fumbles." },
  { header: "PA 0", key: "pa_0", meaning: "Games shutting the opponent out." },
  { header: "1-6", key: "pa_1_6", meaning: "Games allowing 1-6 points." },
  { header: "7-13", key: "pa_7_13", meaning: "Games allowing 7-13 points." },
  { header: "14-20", key: "pa_14_20", meaning: "Games allowing 14-20 points." },
  { header: "21-27", key: "pa_21_27", meaning: "Games allowing 21-27 points." },
  { header: "28-34", key: "pa_28_34", meaning: "Games allowing 28-34 points." },
  { header: "35+", key: "pa_35p", meaning: "Games allowing 35 or more points." },
  { header: "YA 0-199", key: "ya_0_199", meaning: "Games allowing under 200 yards." },
  { header: "200-49", key: "ya_200_249", meaning: "Games allowing 200-249 yards." },
  { header: "250-99", key: "ya_250_299", meaning: "Games allowing 250-299 yards." },
  { header: "300-49", key: "ya_300_349", meaning: "Games allowing 300-349 yards." },
  { header: "350-99", key: "ya_350_399", meaning: "Games allowing 350-399 yards." },
  { header: "400-49", key: "ya_400_449", meaning: "Games allowing 400-449 yards." },
  { header: "450-99", key: "ya_450_499", meaning: "Games allowing 450-499 yards." },
  { header: "500+", key: "ya_500p", meaning: "Games allowing 500 or more yards." },
];

const IDP_STATS: TemplateColumn[] = [
  { header: "TCK", key: "idp_tkl", meaning: "Total tackles. Only scored in leagues that use combined tackles." },
  { header: "SOLO", key: "idp_solo", meaning: "Solo tackles." },
  { header: "AST", key: "idp_ast", meaning: "Assisted tackles." },
  { header: "SCK", key: "idp_sack", meaning: "Sacks." },
  { header: "INT", key: "idp_int", meaning: "Interceptions." },
  { header: "FR", key: "idp_fr", meaning: "Fumbles recovered." },
  { header: "FF", key: "idp_ff", meaning: "Forced fumbles." },
  { header: "TD", key: "idp_td", meaning: "Defensive touchdowns." },
];

const K_STATS: TemplateColumn[] = [
  { header: "FG", key: "fg_made", meaning: "Field goals made." },
  { header: "FGA", key: null, meaning: "Field goals attempted. For reference only." },
  { header: "FGM", key: "fg_miss", meaning: "Field goals missed." },
  { header: "XP", key: "xp_made", meaning: "Extra points made." },
  { header: "XPA", key: null, meaning: "Extra points attempted. For reference only." },
  { header: "XPM", key: "xp_miss", meaning: "Extra points missed." },
  { header: "FG 0-29", key: "fg_0_29", meaning: "Field goals made from inside 30 yards." },
  { header: "FG 30-39", key: "fg_30_39", meaning: "Field goals made from 30-39 yards." },
  { header: "FG 40-49", key: "fg_40_49", meaning: "Field goals made from 40-49 yards." },
  { header: "FG 50+", key: "fg_50p", meaning: "Field goals made from 50 yards or more." },
];

export const TEMPLATE_STATS: Record<TemplateGroup, TemplateColumn[]> = {
  offense: OFFENSE_STATS,
  dst: DST_STATS,
  idp: IDP_STATS,
  k: K_STATS,
};

export function templateColumns(group: TemplateGroup): TemplateColumn[] {
  return [...ID_COLUMNS, ...TEMPLATE_STATS[group]];
}

export function templateHeaderRow(group: TemplateGroup): string {
  return templateColumns(group)
    .map((c) => c.header)
    .join(",");
}

const clean = (h: string) => h.trim().toLowerCase().replace(/\s+/g, " ");

/** Loosest possible form of a heading: letters and digits, single spaces. */
const loose = (h: string) =>
  h
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Extra spellings real-world files use for the same column. Keyed loosely, so
 * "Pass Yds", "PASS_YDS" and "passing yards" all land on the same stat.
 */
const HEADER_ALIASES: Record<string, string> = {
  // passing
  "pass yd": "pass_yd", "pass yds": "pass_yd", "pass yards": "pass_yd",
  "passing yds": "pass_yd", "passing yards": "pass_yd", "py": "pass_yd",
  "pyds": "pass_yd", "pa yd": "pass_yd", "pass": "pass_yd",
  "pass td": "pass_td", "pass tds": "pass_td", "passing td": "pass_td",
  "passing tds": "pass_td", "ptd": "pass_td", "ptds": "pass_td", "pa td": "pass_td",
  "int": "pass_int", "ints": "pass_int", "interceptions": "pass_int",
  "pass int": "pass_int", "pass ints": "pass_int", "interception": "pass_int",
  // rushing
  "rush yd": "rush_yd", "rush yds": "rush_yd", "rush yards": "rush_yd",
  "rushing yds": "rush_yd", "rushing yards": "rush_yd", "ry": "rush_yd",
  "ryds": "rush_yd", "ru yd": "rush_yd",
  "rush td": "rush_td", "rush tds": "rush_td", "rushing td": "rush_td",
  "rushing tds": "rush_td", "rtd": "rush_td", "rtds": "rush_td", "ru td": "rush_td",
  // receiving
  "rec": "rec", "receptions": "rec", "catches": "rec", "recs": "rec",
  "rec yd": "rec_yd", "rec yds": "rec_yd", "rec yards": "rec_yd",
  "receiving yds": "rec_yd", "receiving yards": "rec_yd", "reyds": "rec_yd",
  "rec td": "rec_td", "rec tds": "rec_td", "receiving td": "rec_td",
  "receiving tds": "rec_td",
  // misc offence
  "fum": "fum_lost", "fmb": "fum_lost", "fum lost": "fum_lost",
  "fumbles lost": "fum_lost", "fl": "fum_lost", "fumbles": "fum_lost",
  // kicking
  "fg": "fg_made", "fgm": "fg_made", "fg made": "fg_made",
  "fg missed": "fg_miss", "fg miss": "fg_miss",
  "xp": "xp_made", "xpm": "xp_made", "pat": "xp_made", "xp made": "xp_made",
  "xp missed": "xp_miss", "xp miss": "xp_miss",
  "fg 50": "fg_50p", "fg 50+": "fg_50p",
  // team defence
  "sck": "def_sack", "sack": "def_sack", "sacks": "def_sack",
  "saf": "def_saf", "safety": "def_saf", "safeties": "def_saf",
  "fr": "def_fr", "fum rec": "def_fr", "ff": "def_ff", "forced fumbles": "def_ff",
  // individual defenders
  "tck": "idp_tkl", "tkl": "idp_tkl", "tackles": "idp_tkl",
  "solo": "idp_solo", "solo tackles": "idp_solo",
  "ast": "idp_ast", "assists": "idp_ast", "assisted tackles": "idp_ast",
};

/** Which loose alias spellings are allowed for a group, to avoid cross-talk. */
function aliasMapFor(group: TemplateGroup): Map<string, string> {
  const allowed = new Set(
    TEMPLATE_STATS[group].map((c) => c.key).filter((k): k is string => !!k),
  );
  const out = new Map<string, string>();
  for (const [name, key] of Object.entries(HEADER_ALIASES)) {
    if (allowed.has(key)) out.set(name, key);
  }
  // The shared scoring aliases, keyed loosely too ("pass_yds" -> "pass yds").
  for (const [name, key] of Object.entries(STAT_ALIASES)) {
    if (allowed.has(key) && !out.has(loose(name))) out.set(loose(name), key);
  }
  // A file may simply use the scoring key itself.
  for (const key of allowed) out.set(loose(key), key);
  return out;
}

/**
 * Maps a file's headers onto scoring keys for one group. Bare band headings
 * ("1-6", "200-49") only make sense in order, so the defence layout is walked
 * left to right rather than matched by name alone.
 */
export function mapHeaders(
  group: TemplateGroup,
  header: string[],
): { key: string; index: number }[] {
  const wanted = TEMPLATE_STATS[group];
  const byName = new Map<string, string>();
  for (const col of wanted) if (col.key) byName.set(clean(col.header), col.key);

  const out: { key: string; index: number }[] = [];
  const used = new Set<string>();

  if (group === "dst") {
    // Walk the two band runs positionally: PA 0 then six bands, YA 0-199 then seven.
    const order = wanted.filter((c) => c.key).map((c) => c.key!);
    const paStart = header.findIndex((h) => clean(h) === "pa 0");
    const yaStart = header.findIndex((h) => clean(h) === "ya 0-199");
    for (let i = 0; i < header.length; i++) {
      const name = clean(header[i] ?? "");
      if (paStart >= 0 && i >= paStart && i < paStart + 7) {
        const key = order[order.indexOf("pa_0") + (i - paStart)];
        if (key && !used.has(key)) { out.push({ key, index: i }); used.add(key); }
        continue;
      }
      if (yaStart >= 0 && i >= yaStart && i < yaStart + 8) {
        const key = order[order.indexOf("ya_0_199") + (i - yaStart)];
        if (key && !used.has(key)) { out.push({ key, index: i }); used.add(key); }
        continue;
      }
      const key = byName.get(name);
      if (key && !used.has(key)) { out.push({ key, index: i }); used.add(key); }
    }
    return out;
  }

  const aliases = aliasMapFor(group);
  for (let i = 0; i < header.length; i++) {
    const raw = header[i] ?? "";
    const key = byName.get(clean(raw)) ?? aliases.get(loose(raw));
    if (key && !used.has(key)) { out.push({ key, index: i }); used.add(key); }
  }
  return out;
}

/** Works out which template a file follows from its headers. */
export function detectGroup(header: string[]): TemplateGroup | null {
  const names = new Set(header.map(clean));
  if (names.has("pa 0") || names.has("saf")) return "dst";
  if (names.has("solo") || names.has("tck")) return "idp";
  if (names.has("fga") || names.has("fg 40-49") || names.has("xpa")) return "k";
  const offense = aliasMapFor("offense");
  if (header.some((h) => offense.has(loose(h)))) return "offense";
  return null;
}

/**
 * Recognises a schedule grid: a team column followed by one column per week
 * (nfl_team, Wk1, Wk2, …). These files carry opponents, not stat lines.
 */
export function detectOpponentGrid(header: string[]): boolean {
  const names = header.map(clean);
  const hasTeam = names.some((h) => h === "nfl team" || h === "team" || h === "nfl_team");
  const weekCols = names.filter((h) => /^wk\s?\d{1,2}$/.test(h) || /^week\s?\d{1,2}$/.test(h));
  return hasTeam && weekCols.length >= 4;
}

export interface OpponentGridRow {
  nflTeam: string;
  opponents: { week: number; opponent: string | null }[];
}

/**
 * Parses a schedule grid into per-team, per-week opponents. "BYE", empty or
 * dash cells mean no game that week. Anything in parentheses is stripped, so
 * "BUF (Sun)" still reads as BUF.
 */
export function parseOpponentGrid(csv: string): OpponentGridRow[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const splitRow = (line: string) => {
    const out: string[] = [];
    let cur = "";
    let quoted = false;
    for (const ch of line) {
      if (ch === '"') quoted = !quoted;
      else if (ch === "," && !quoted) { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out.map((c) => c.trim());
  };
  const header = splitRow(lines[0]!).map(clean);
  const teamIdx = header.findIndex((h) => h === "nfl team" || h === "team" || h === "nfl_team");
  const weekCols = header
    .map((h, i) => ({ m: /^(?:wk|week)\s?(\d{1,2})$/.exec(h), i }))
    .filter((c) => c.m)
    .map((c) => ({ week: Number(c.m![1]), i: c.i }));
  if (teamIdx < 0 || !weekCols.length) return [];

  const rows: OpponentGridRow[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitRow(line);
    const team = (cells[teamIdx] ?? "").toUpperCase().trim();
    if (!/^[A-Z]{2,4}$/.test(team)) continue;
    const opponents = weekCols.map(({ week, i }) => {
      const raw = (cells[i] ?? "").replace(/\([^)]*\)/g, "").trim().toUpperCase();
      const opponent = !raw || raw === "BYE" || raw === "-" || raw === "--" ? null : raw;
      return { week, opponent };
    });
    rows.push({ nflTeam: team, opponents });
  }
  return rows;
}
