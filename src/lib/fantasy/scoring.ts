/**
 * League-specific scoring.
 *
 * Player projections are stored once, under a PPR baseline. Every league then
 * re-scores those projections against its own rules, so a half-PPR, standard,
 * TE-premium or 6-point-passing-TD league sees different numbers. Pure math,
 * no I/O.
 */

export type ScoringRules = Record<string, number>;

/** Baseline (full PPR) rules the stored projections were generated under. */
export const BASELINE_RULES: ScoringRules = {
  pass_yd: 0.04,
  pass_td: 4,
  pass_int: -1,
  pass_2pt: 2,
  rush_yd: 0.1,
  rush_td: 6,
  rec: 1,
  rec_yd: 0.1,
  rec_td: 6,
  fum_lost: -2,
  // kicking
  fg_made: 3,
  fg_0_29: 0,
  fg_30_39: 0,
  fg_40_49: 1,
  fg_50p: 2,
  fg_miss: -1,
  xp_made: 1,
  xp_miss: -1,
  // team defense
  def_sack: 1,
  def_int: 2,
  def_fr: 2,
  def_td: 6,
  def_saf: 2,
  def_ff: 1,
  pa_0: 10,
  pa_1_6: 7,
  pa_7_13: 4,
  pa_14_20: 1,
  pa_21_27: 0,
  pa_28_34: -1,
  pa_35p: -4,
  // individual defensive players
  idp_solo: 1,
  idp_ast: 0.5,
  idp_sack: 2,
  idp_int: 3,
  idp_fr: 3,
  idp_ff: 3,
  idp_td: 6,
};

const PRESETS: Record<string, ScoringRules> = {
  ppr: { rec: 1 },
  half_ppr: { rec: 0.5 },
  standard: { rec: 0 },
  te_premium: { rec: 1, bonus_rec_te: 0.5 },
};

/** Aliases used by ESPN / Yahoo / hand-entered rule sets. */
const ALIASES: Record<string, string> = {
  receptions: "rec",
  reception: "rec",
  rec_ppr: "rec",
  passing_yards: "pass_yd",
  pass_yds: "pass_yd",
  pa_yd: "pass_yd",
  passing_td: "pass_td",
  passing_tds: "pass_td",
  pa_td: "pass_td",
  interceptions: "pass_int",
  int: "pass_int",
  rushing_yards: "rush_yd",
  rush_yds: "rush_yd",
  ru_yd: "rush_yd",
  rushing_td: "rush_td",
  rushing_tds: "rush_td",
  ru_td: "rush_td",
  ru_fd: "rush_fd",
  receiving_yards: "rec_yd",
  rec_yds: "rec_yd",
  receiving_td: "rec_td",
  receiving_tds: "rec_td",
  fumbles_lost: "fum_lost",
  fum: "fum_lost",
  // kicking aliases
  fgm: "fg_made",
  fg: "fg_made",
  fg_50_plus: "fg_50p",
  fgmiss: "fg_miss",
  xpm: "xp_made",
  xp: "xp_made",
  xpmiss: "xp_miss",
  // team defense aliases
  sack: "def_sack",
  sacks: "def_sack",
  def_st_td: "def_td",
  safety: "def_saf",
  def_forced_fum: "def_ff",
  pts_allow_0: "pa_0",
  pts_allow_1_6: "pa_1_6",
  pts_allow_7_13: "pa_7_13",
  pts_allow_14_20: "pa_14_20",
  pts_allow_21_27: "pa_21_27",
  pts_allow_28_34: "pa_28_34",
  pts_allow_35p: "pa_35p",
  // IDP aliases
  idp_tkl_solo: "idp_solo",
  tkl_solo: "idp_solo",
  idp_tkl_ast: "idp_ast",
  tkl_ast: "idp_ast",
  idp_sk: "idp_sack",
  idp_tkl: "idp_tkl",
};


/** Merges a preset with any league-specific overrides into one rule set. */
export function normalizeRules(scoringType: string | null | undefined, rules: ScoringRules | null | undefined): ScoringRules {
  const preset = PRESETS[(scoringType ?? "ppr").toLowerCase()] ?? PRESETS['ppr']!;
  const out: ScoringRules = { ...BASELINE_RULES, ...preset };
  for (const [rawKey, value] of Object.entries(rules ?? {})) {
    if (typeof value !== "number" || Number.isNaN(value)) continue;
    const k = rawKey.toLowerCase();
    out[ALIASES[k] ?? k] = value;
  }
  return out;
}

export type StatLine = Record<string, number>;

/**
 * Typical full-season stat line per position. Only the shape matters: the
 * projection is rescaled by the ratio of league points to baseline points.
 */
const ARCHETYPES: Record<string, StatLine> = {
  QB: { pass_yd: 4200, pass_td: 29, pass_int: 12, rush_yd: 280, rush_td: 3, fum_lost: 3 },
  RB: { rush_yd: 950, rush_td: 7, rec: 45, rec_yd: 340, rec_td: 2, fum_lost: 2 },
  WR: { rec: 85, rec_yd: 1150, rec_td: 8, rush_yd: 30, fum_lost: 1 },
  TE: { rec: 70, rec_yd: 780, rec_td: 6, fum_lost: 1 },
  K: { fg_made: 28, fg_40_49: 9, fg_50p: 5, fg_miss: 5, xp_made: 32, xp_miss: 2 },
  DEF: { def_sack: 40, def_int: 13, def_fr: 9, def_td: 3, def_saf: 1, def_ff: 11, pa_14_20: 6, pa_21_27: 5, pa_7_13: 4 },
  DL: { idp_solo: 40, idp_ast: 20, idp_sack: 7, idp_ff: 2, idp_fr: 1 },
  LB: { idp_solo: 80, idp_ast: 45, idp_sack: 3, idp_int: 1, idp_ff: 2, idp_fr: 1 },
  DB: { idp_solo: 65, idp_ast: 25, idp_sack: 1, idp_int: 3, idp_ff: 1, idp_fr: 1 },
};


/** Applies a rule set to a stat line, including position-specific bonuses. */
export function scoreStats(stats: StatLine, rules: ScoringRules, position?: string): number {
  let total = 0;
  for (const [stat, amount] of Object.entries(stats)) {
    total += amount * (rules[stat] ?? 0);
  }
  const pos = position?.toUpperCase();
  if (pos === "TE" && rules['bonus_rec_te']) total += (stats['rec'] ?? 0) * rules['bonus_rec_te'];
  if (pos === "RB" && rules['bonus_rec_rb']) total += (stats['rec'] ?? 0) * rules['bonus_rec_rb'];
  if (pos === "WR" && rules['bonus_rec_wr']) total += (stats['rec'] ?? 0) * rules['bonus_rec_wr'];
  return total;
}

/**
 * Per-position scaling factor from baseline projections to this league's
 * scoring. 1.0 means the league scores that position like the baseline.
 */
export function positionMultipliers(rules: ScoringRules): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [pos, stats] of Object.entries(ARCHETYPES)) {
    const base = scoreStats(stats, BASELINE_RULES, pos);
    if (!base) {
      out[pos] = 1;
      continue;
    }
    const league = scoreStats(stats, rules, pos);
    // Clamp so an unusual rule set cannot produce nonsense projections.
    out[pos] = Math.max(0.35, Math.min(2.5, league / base));
  }
  return out;
}

export interface LeagueScoring {
  rules: ScoringRules;
  multipliers: Record<string, number>;
  label: string;
  /** Scales a baseline projection into this league's points. */
  scale: (position: string, points: number) => number;
  /** Scores a real stat line (a projected week or season) in this league. */
  score: (position: string, stats: StatLine | null | undefined) => number;
}


function labelFor(rules: ScoringRules): string {
  const rec = rules['rec'] ?? 0;
  const parts: string[] = [];
  if (rec >= 1) parts.push("Full PPR");
  else if (rec > 0) parts.push(`${rec} PPR`);
  else parts.push("Standard");
  if (rules['bonus_rec_te']) parts.push("TE premium");
  if ((rules['pass_td'] ?? 4) !== 4) parts.push(`${rules['pass_td']}pt pass TD`);
  return parts.join(" · ");
}

export function leagueScoring(scoringType: string | null | undefined, rules: ScoringRules | null | undefined): LeagueScoring {
  const merged = normalizeRules(scoringType, rules);
  const multipliers = positionMultipliers(merged);
  return {
    rules: merged,
    multipliers,
    label: labelFor(merged),
    scale: (position: string, points: number) => {
      const m = multipliers[position.toUpperCase()] ?? 1;
      return Math.round(points * m * 10) / 10;
    },
    score: (position: string, stats: StatLine | null | undefined) =>
      stats && Object.keys(stats).length
        ? Math.round(scoreStats(stats, merged, position) * 10) / 10
        : 0,
  };

}
