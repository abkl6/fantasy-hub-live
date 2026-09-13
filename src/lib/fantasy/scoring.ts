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
  passing_td: "pass_td",
  passing_tds: "pass_td",
  interceptions: "pass_int",
  int: "pass_int",
  rushing_yards: "rush_yd",
  rush_yds: "rush_yd",
  rushing_td: "rush_td",
  rushing_tds: "rush_td",
  receiving_yards: "rec_yd",
  rec_yds: "rec_yd",
  receiving_td: "rec_td",
  receiving_tds: "rec_td",
  fumbles_lost: "fum_lost",
  fum: "fum_lost",
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
  K: {},
  DEF: {},
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
  };
}
