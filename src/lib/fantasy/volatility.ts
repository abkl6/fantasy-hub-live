/**
 * Historical week-to-week volatility. Pure math, no I/O.
 *
 * How much a player swings around their own average, as a fraction of it. A
 * short sample says nothing useful, so below six games the position default
 * stands.
 */

export const MIN_VOLATILITY_GAMES = 6;
export const VOLATILITY_FLOOR = 0.12;
export const VOLATILITY_CEILING = 1.2;

/**
 * Standard deviation of weekly scores divided by the mean. Returns null when
 * there are too few games, or the player barely scored, to let the caller fall
 * back to the position default.
 */
export function historicalVolatility(weeklyPoints: number[]): number | null {
  const games = weeklyPoints.filter((p) => Number.isFinite(p));
  if (games.length < MIN_VOLATILITY_GAMES) return null;
  const mean = games.reduce((a, b) => a + b, 0) / games.length;
  if (mean <= 1) return null;
  const variance = games.reduce((sum, p) => sum + (p - mean) ** 2, 0) / games.length;
  const sd = Math.sqrt(variance);
  const ratio = sd / mean;
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  return Math.round(Math.max(VOLATILITY_FLOOR, Math.min(VOLATILITY_CEILING, ratio)) * 1000) / 1000;
}
