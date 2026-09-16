/**
 * Rest-of-season blending. Pure math, no I/O.
 *
 * A preseason projection ages badly: by week six a player's own form says more
 * than anything written in August. We turn both into a per-game rate and mix
 * them, letting real games earn their share gradually rather than all at once.
 */

/** How many games of real football it takes for actuals to reach half weight. */
export const BLEND_PRIOR_GAMES = 6;

/** Share of the blend that comes from this season's games: g / (g + 6). */
export function blendWeightForGames(gamesPlayed: number): number {
  if (!Number.isFinite(gamesPlayed) || gamesPlayed <= 0) return 0;
  const g = Math.max(0, gamesPlayed);
  return g / (g + BLEND_PRIOR_GAMES);
}

export type Rates = Record<string, number>;

export interface BlendResult {
  /** Blended per-game rate for every stat either side knows about. */
  perGame: Rates;
  /** How much of the result came from this season, 0-1. */
  weight: number;
  gamesPlayed: number;
}

function perGameOf(totals: Rates, games: number): Rates {
  if (games <= 0) return {};
  const out: Rates = {};
  for (const [key, value] of Object.entries(totals)) {
    if (!Number.isFinite(value) || value === 0) continue;
    out[key] = value / games;
  }
  return out;
}

/**
 * Blend a player's actual per-game production with their preseason per-game
 * projection. Applied to every stat category, so a receiver who has started
 * running the ball is credited for it.
 */
export function blendRates(
  actualPerGame: Rates,
  projectedPerGame: Rates,
  gamesPlayed: number,
): BlendResult {
  const weight = blendWeightForGames(gamesPlayed);
  const keys = new Set([...Object.keys(actualPerGame), ...Object.keys(projectedPerGame)]);
  const perGame: Rates = {};
  for (const key of keys) {
    const a = Number(actualPerGame[key] ?? 0);
    const p = Number(projectedPerGame[key] ?? 0);
    const value = Math.round((p * (1 - weight) + a * weight) * 10000) / 10000;
    if (value !== 0) perGame[key] = value;
  }
  return { perGame, weight, gamesPlayed };
}

/**
 * Same blend, taking season totals on both sides. Actual totals are divided by
 * games actually played; the projection by the games the season is long.
 */
export function blendSeasonTotals(
  actualTotals: Rates,
  projectedTotals: Rates,
  gamesPlayed: number,
  projectedGames: number,
): BlendResult {
  return blendRates(
    perGameOf(actualTotals, gamesPlayed),
    perGameOf(projectedTotals, Math.max(1, projectedGames)),
    gamesPlayed,
  );
}

/** Spread a per-game rate back over a number of remaining games. */
export function ratesToTotals(perGame: Rates, games: number): Rates {
  const out: Rates = {};
  const n = Math.max(0, games);
  for (const [key, value] of Object.entries(perGame)) {
    const total = Math.round(value * n * 1000) / 1000;
    if (total !== 0) out[key] = total;
  }
  return out;
}

/** "based on 4 games + preseason" */
export function blendLabel(gamesPlayed: number): string {
  if (!Number.isFinite(gamesPlayed) || gamesPlayed <= 0) return "preseason projection";
  return `based on ${Math.round(gamesPlayed)} game${gamesPlayed === 1 ? "" : "s"} + preseason`;
}
