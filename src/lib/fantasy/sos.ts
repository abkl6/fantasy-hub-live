/**
 * Strength of schedule. Pure math, no I/O.
 *
 * A multiplier says how favourable it is to face one NFL team, for one group
 * of positions. 1.00 is neutral: nothing changes. Above 1 means a soft
 * matchup, below 1 a hard one. Multipliers are deliberately gentle — a
 * projection should never swing wildly on the strength of an opponent.
 */

export const POSITION_GROUPS = ["QB", "RB", "WR", "TE", "K", "DST", "IDP"] as const;
export type PositionGroup = (typeof POSITION_GROUPS)[number];

/** Widest a matchup may move a projection. */
export const SOS_MIN = 0.9;
export const SOS_MAX = 1.1;

export function groupOf(position: string | null | undefined): PositionGroup | null {
  const pos = (position ?? "").toUpperCase();
  if (pos === "QB" || pos === "RB" || pos === "WR" || pos === "TE" || pos === "K") return pos;
  if (pos === "DST" || pos === "DEF" || pos === "D/ST") return "DST";
  if (pos === "DL" || pos === "LB" || pos === "DB" || pos === "IDP" || pos === "DE" || pos === "DT" || pos === "CB" || pos === "S") {
    return "IDP";
  }
  return null;
}

/**
 * Which position's opponent rating governs a stat. Passing is judged by how an
 * opponent handles quarterbacks, rushing by runners, receiving by receivers
 * (tight ends use the tight-end rating), kicking by kickers. Anything else is
 * left alone.
 */
export function categoryGroupFor(
  statKey: string,
  position: string | null | undefined,
): PositionGroup | null {
  const key = statKey.toLowerCase();
  if (key.startsWith("pass_")) return "QB";
  if (key.startsWith("rush_")) return "RB";
  if (key === "rec" || key.startsWith("rec_")) {
    return groupOf(position) === "TE" ? "TE" : "WR";
  }
  if (key.startsWith("fg_") || key.startsWith("xp_")) return "K";
  if (key.startsWith("def_") || key.startsWith("pa_") || key.startsWith("ya_")) return "DST";
  if (key.startsWith("idp_")) return "IDP";
  return null;
}

export function clampMultiplier(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(SOS_MIN, Math.min(SOS_MAX, value));
}

export type MatchupRating = "easy" | "neutral" | "tough";

export function ratingOf(multiplier: number): MatchupRating {
  if (multiplier >= 1.02) return "easy";
  if (multiplier <= 0.98) return "tough";
  return "neutral";
}

export const RATING_LABEL: Record<MatchupRating, string> = {
  easy: "Easy",
  neutral: "Even",
  tough: "Tough",
};

/**
 * How much this season's own results count against last season's baseline:
 * nothing at week zero, everything from eight games on.
 */
export function blendWeight(gamesPlayed: number): number {
  if (!Number.isFinite(gamesPlayed) || gamesPlayed <= 0) return 0;
  return Math.min(1, gamesPlayed / 8);
}

export function blendMeasure(
  prior: number | null | undefined,
  current: number | null | undefined,
  gamesPlayed: number,
): number | null {
  const w = blendWeight(gamesPlayed);
  const hasPrior = Number.isFinite(prior) && (prior as number) > 0;
  const hasCurrent = Number.isFinite(current) && (current as number) > 0;
  if (!hasPrior && !hasCurrent) return null;
  if (!hasPrior) return current as number;
  if (!hasCurrent || w <= 0) return prior as number;
  return (prior as number) * (1 - w) + (current as number) * w;
}


/**
 * Turns a raw per-team measure (points allowed, offensive strength, …) into a
 * multiplier around the league average. `weight` decides how much of the gap
 * between a team and the average is passed through.
 */
export function multipliersFromMeasure(
  measure: Map<string, number>,
  weight: number,
): Map<string, number> {
  const out = new Map<string, number>();
  const values = [...measure.values()].filter((v) => Number.isFinite(v) && v > 0);
  if (values.length < 4) return out;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (!mean) return out;
  for (const [team, value] of measure) {
    if (!Number.isFinite(value) || value <= 0) continue;
    out.set(team.toUpperCase(), clampMultiplier(1 + weight * ((value - mean) / mean)));
  }
  return out;
}

export interface WeekSlot {
  week: number;
  opponent: string | null;
}

/** Looks up the multiplier for one stat category against one opponent. */
export type CategoryMultiplier = (
  group: PositionGroup | null,
  opponent: string | null,
) => number;

/**
 * Splits a season total across the weeks a team actually plays. Each stat is
 * shaped by the opponent rating for its own category (passing by the
 * opponent's quarterback rating, rushing by its runner rating, and so on), and
 * every stat's season total is preserved exactly.
 */
export function spreadSeasonTotals(
  totals: Record<string, number>,
  weeks: WeekSlot[],
  position?: string | null,
  multiplierFor?: CategoryMultiplier,
): { week: number; opponent: string | null; stats: Record<string, number> }[] {
  if (!weeks.length) return [];
  const out = weeks.map((w) => ({
    week: w.week,
    opponent: w.opponent,
    stats: {} as Record<string, number>,
  }));

  for (const [key, value] of Object.entries(totals)) {
    if (!Number.isFinite(value) || value === 0) continue;
    const group = multiplierFor ? categoryGroupFor(key, position) : null;
    const shares = weeks.map((w) =>
      multiplierFor ? Math.max(0.01, multiplierFor(group, w.opponent)) : 1,
    );
    const sum = shares.reduce((a, b) => a + b, 0) || weeks.length;
    for (let i = 0; i < weeks.length; i++) {
      const per = Math.round(((value * shares[i]!) / sum) * 1000) / 1000;
      if (per !== 0) out[i]!.stats[key] = per;
    }
  }
  return out;
}

/** Scales one week's stat line by each stat's own matchup multiplier. */
export function applyMatchup(
  stats: Record<string, number>,
  position: string | null | undefined,
  opponent: string | null,
  multiplierFor: CategoryMultiplier,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(stats)) {
    const m = multiplierFor(categoryGroupFor(key, position), opponent);
    out[key] = Math.round(value * m * 1000) / 1000;
  }
  return out;
}


/** Average multiplier across a player's season — the schedule rating. */
export function seasonRating(
  weeks: WeekSlot[],
  multiplierFor: (opponent: string | null) => number,
): number {
  const played = weeks.filter((w) => w.opponent);
  if (!played.length) return 1;
  const total = played.reduce((sum, w) => sum + multiplierFor(w.opponent), 0);
  return Math.round((total / played.length) * 1000) / 1000;
}
