/**
 * Keeping the app honest about its own numbers.
 *
 * Every win chance and every player projection the app shows is written down,
 * then compared with what actually happened. Two measures come out of that:
 * a Brier score for the win chances (lower is better, 0.25 is a coin flip) and
 * mean absolute error per position for the projections.
 *
 * Pure math — no I/O.
 */

export interface CalibrationRow {
  week: number;
  kind: "win_prob" | "projection";
  position?: string | null;
  predicted: number;
  actual: number | null;
}

export interface WeeklyBrier {
  week: number;
  brier: number;
  samples: number;
}

export interface PositionError {
  position: string;
  mae: number;
  samples: number;
}

/** (predicted - outcome)^2, where outcome is 1 for a win and 0 for a loss. */
export function brier(predicted: number, won: boolean): number {
  const p = Math.min(1, Math.max(0, predicted));
  return (p - (won ? 1 : 0)) ** 2;
}

export function weeklyBrier(rows: CalibrationRow[]): WeeklyBrier[] {
  const byWeek = new Map<number, number[]>();
  for (const r of rows) {
    if (r.kind !== "win_prob" || r.actual === null) continue;
    const list = byWeek.get(r.week) ?? [];
    list.push(brier(r.predicted, r.actual >= 0.5));
    byWeek.set(r.week, list);
  }
  return [...byWeek.entries()]
    .map(([week, scores]) => ({
      week,
      brier: Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 1000) / 1000,
      samples: scores.length,
    }))
    .sort((a, b) => a.week - b.week);
}

export function maeByPosition(rows: CalibrationRow[]): PositionError[] {
  const byPos = new Map<string, number[]>();
  for (const r of rows) {
    if (r.kind !== "projection" || r.actual === null) continue;
    const pos = (r.position ?? "UNK").toUpperCase();
    const list = byPos.get(pos) ?? [];
    list.push(Math.abs(r.predicted - r.actual));
    byPos.set(pos, list);
  }
  return [...byPos.entries()]
    .map(([position, errors]) => ({
      position,
      mae: Math.round((errors.reduce((a, b) => a + b, 0) / errors.length) * 100) / 100,
      samples: errors.length,
    }))
    .sort((a, b) => b.samples - a.samples);
}

// --- auto-adjusting the volatility defaults --------------------------------

/** Only mid-range favourites tell us anything: 95% shots always win. */
export const FAVORITE_BAND: [number, number] = [0.6, 0.8];
/** How far off the stated chance has to land before the app changes its mind. */
export const CALIBRATION_GAP = 0.08;
export const TRAILING_WEEKS = 6;
export const VOLATILITY_STEP = 0.1;

export interface CalibrationVerdict {
  /** Multiplier to apply to every position volatility default. */
  factor: number;
  /** Actual win rate of 60-80% favourites minus their average stated chance. */
  gap: number;
  samples: number;
  reason: string;
}

/**
 * When mid-range favourites win far more often than the app said they would,
 * the app is treating the league as more random than it is: tighten the
 * spreads. When they win far less often, loosen them.
 */
export function calibrationVerdict(
  rows: CalibrationRow[],
  currentWeek: number,
  trailingWeeks = TRAILING_WEEKS,
): CalibrationVerdict {
  const since = currentWeek - trailingWeeks;
  const band = rows.filter(
    (r) =>
      r.kind === "win_prob" &&
      r.actual !== null &&
      r.week > since &&
      r.predicted >= FAVORITE_BAND[0] &&
      r.predicted <= FAVORITE_BAND[1],
  );
  if (band.length < 10) {
    return { factor: 1, gap: 0, samples: band.length, reason: "Not enough matchups yet." };
  }
  const stated = band.reduce((sum, r) => sum + r.predicted, 0) / band.length;
  const won = band.filter((r) => (r.actual ?? 0) >= 0.5).length / band.length;
  const gap = Math.round((won - stated) * 1000) / 1000;

  if (gap > CALIBRATION_GAP) {
    return {
      factor: 1 - VOLATILITY_STEP,
      gap,
      samples: band.length,
      reason: `Favourites won ${Math.round(won * 100)}% against a stated ${Math.round(stated * 100)}% — the app was treating weeks as more random than they are.`,
    };
  }
  if (gap < -CALIBRATION_GAP) {
    return {
      factor: 1 + VOLATILITY_STEP,
      gap,
      samples: band.length,
      reason: `Favourites won only ${Math.round(won * 100)}% against a stated ${Math.round(stated * 100)}% — weeks are swingier than the app assumed.`,
    };
  }
  return {
    factor: 1,
    gap,
    samples: band.length,
    reason: `Favourites won ${Math.round(won * 100)}% against a stated ${Math.round(stated * 100)}% — close enough to leave alone.`,
  };
}
