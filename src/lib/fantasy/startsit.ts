/**
 * Favourite-aware start/sit.
 *
 * A close call between two players is not the same decision every week. When
 * you are a heavy favourite the job is to avoid the disaster, so the safer
 * player wins; when you are a big underdog you need the ceiling, so the boom
 * player wins. In between, the plain projection decides.
 *
 * Pure math, no I/O.
 */

export type StartSitMode = "floor" | "ceiling" | "mean";

/** Above this win chance you protect the lead. */
export const FAVORITE_THRESHOLD = 0.65;
/** Below this you need a big week. */
export const UNDERDOG_THRESHOLD = 0.35;
/** Projection gaps wider than this are not close calls. */
export const BORDERLINE_POINTS = 3;

export function startSitMode(winProbability: number | null | undefined): StartSitMode {
  if (typeof winProbability !== "number" || !Number.isFinite(winProbability)) return "mean";
  if (winProbability > FAVORITE_THRESHOLD) return "floor";
  if (winProbability < UNDERDOG_THRESHOLD) return "ceiling";
  return "mean";
}

export interface StartSitCandidate {
  name: string;
  position: string;
  proj: number;
  /** Fraction of the projection, week to week. */
  volatility: number;
}

/** Mean minus one standard deviation — the bad-but-not-catastrophic week. */
export function floorOf(c: StartSitCandidate): number {
  return c.proj - c.proj * c.volatility;
}

/** Mean plus one standard deviation — the week that wins you the matchup. */
export function ceilingOf(c: StartSitCandidate): number {
  return c.proj + c.proj * c.volatility;
}

export function scoreFor(c: StartSitCandidate, mode: StartSitMode): number {
  if (mode === "floor") return floorOf(c);
  if (mode === "ceiling") return ceilingOf(c);
  return c.proj;
}

export function isBorderline(a: StartSitCandidate, b: StartSitCandidate): boolean {
  return Math.abs(a.proj - b.proj) < BORDERLINE_POINTS;
}

export interface StartSitCall {
  start: StartSitCandidate;
  sit: StartSitCandidate;
  mode: StartSitMode;
  /** True when the mode changed the answer the plain projection would give. */
  flipped: boolean;
  line: string | null;
}

/**
 * Decides between two candidates, and says in one line why — but only when the
 * call was close enough for the mode to matter.
 */
export function startSitCall(
  a: StartSitCandidate,
  b: StartSitCandidate,
  winProbability: number | null | undefined,
): StartSitCall {
  const mode = startSitMode(winProbability);
  const byMean = a.proj >= b.proj ? [a, b] : [b, a];
  const borderline = isBorderline(a, b);
  const ranked =
    borderline && mode !== "mean"
      ? scoreFor(a, mode) >= scoreFor(b, mode)
        ? [a, b]
        : [b, a]
      : byMean;

  const start = ranked[0]!;
  const sit = ranked[1]!;
  const flipped = start.name !== byMean[0]!.name;

  let line: string | null = null;
  if (borderline && mode === "floor") {
    line = `You're favored — playing it safe with ${start.name}.`;
  } else if (borderline && mode === "ceiling") {
    line = `You're a big underdog — chasing the ceiling with ${start.name}.`;
  }

  return { start, sit, mode, flipped, line };
}

/** Sorts a pool of borderline options for the week's mode. */
export function rankForMode<T extends StartSitCandidate>(
  candidates: T[],
  mode: StartSitMode,
): T[] {
  return [...candidates].sort((x, y) => scoreFor(y, mode) - scoreFor(x, mode));
}

export function modeLine(mode: StartSitMode, name: string): string | null {
  if (mode === "floor") return `You're favored — playing it safe with ${name}.`;
  if (mode === "ceiling") return `You're a big underdog — chasing the ceiling with ${name}.`;
  return null;
}
