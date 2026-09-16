/**
 * Upload templates for projections.
 *
 * Four groups, each with its own spreadsheet layout: offence, team defence,
 * individual defenders and kickers. A template is one row per player for the
 * whole season; the app splits those totals into weeks itself.
 *
 * Pure: no I/O, so the column maps can be tested directly.
 */

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

  for (let i = 0; i < header.length; i++) {
    const key = byName.get(clean(header[i] ?? ""));
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
  if (names.has("rec") || names.has("pass yd") || names.has("rush yd") || names.has("rec yd")) {
    return "offense";
  }
  return null;
}
