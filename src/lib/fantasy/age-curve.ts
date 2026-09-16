/**
 * Market-implied age curves: how much a position's trade value is worth at
 * each age, fitted from the current market table. Pure math, no I/O.
 *
 * A curve is a list of { age, value } points where value is relative to the
 * position's peak (1.0 at the top). When the market table is empty we fall
 * back to hand-set curves so the app always has something to draw.
 */

export interface CurvePoint {
  age: number;
  value: number;
}

export interface AgeCurve {
  position: string;
  points: CurvePoint[];
  sampleSize: number;
  source: "market" | "hand";
  fittedAt: string | null;
}

/** Peak age and yearly decline used when the market table tells us nothing. */
const HAND_SET: Record<string, { peak: number; decline: number; rise: number }> = {
  QB: { peak: 29, decline: 0.06, rise: 0.04 },
  RB: { peak: 24, decline: 0.16, rise: 0.06 },
  WR: { peak: 26, decline: 0.1, rise: 0.05 },
  TE: { peak: 27, decline: 0.09, rise: 0.05 },
  K: { peak: 31, decline: 0.03, rise: 0.02 },
  DEF: { peak: 30, decline: 0.01, rise: 0.01 },
};

export const CURVE_POSITIONS = ["QB", "RB", "WR", "TE"] as const;

const MIN_AGE = 20;
const MAX_AGE = 38;

function handShape(position: string): CurvePoint[] {
  const shape = HAND_SET[position.toUpperCase()] ?? HAND_SET['WR']!;
  const points: CurvePoint[] = [];
  for (let age = MIN_AGE; age <= MAX_AGE; age += 1) {
    const value =
      age <= shape.peak
        ? Math.pow(1 - shape.rise, shape.peak - age)
        : Math.pow(1 - shape.decline, age - shape.peak);
    points.push({ age, value: Math.round(value * 1000) / 1000 });
  }
  return points;
}

export function handCurve(position: string): AgeCurve {
  return {
    position: position.toUpperCase(),
    points: handShape(position),
    sampleSize: 0,
    source: "hand",
    fittedAt: null,
  };
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/**
 * Fits one position's curve from market rows: the median value at each age,
 * smoothed across neighbouring ages, then scaled so the peak reads 1.0.
 * Returns null when the sample is too thin to mean anything.
 */
export function fitCurve(
  position: string,
  rows: { age: number | null; value: number }[],
  fittedAt = new Date().toISOString(),
): AgeCurve | null {
  const usable = rows.filter(
    (r) => r.age != null && Number.isFinite(r.age) && r.age >= MIN_AGE - 2 && r.age <= MAX_AGE + 4 && r.value > 0,
  );
  const byAge = new Map<number, number[]>();
  for (const row of usable) {
    const age = Math.round(Math.min(MAX_AGE, Math.max(MIN_AGE, row.age!)));
    const list = byAge.get(age);
    if (list) list.push(row.value);
    else byAge.set(age, [row.value]);
  }
  if (usable.length < 20 || byAge.size < 4) return null;

  // Raw median per age, then a weighted three-point smooth so one thin age
  // bucket cannot put a spike in the curve.
  const raw = new Map<number, number>();
  for (const [age, values] of byAge) raw.set(age, median(values));

  const smoothed: CurvePoint[] = [];
  let last = 0;
  for (let age = MIN_AGE; age <= MAX_AGE; age += 1) {
    const here = raw.get(age);
    const before = raw.get(age - 1);
    const after = raw.get(age + 1);
    const parts: { v: number; w: number }[] = [];
    if (here != null) parts.push({ v: here, w: 2 });
    if (before != null) parts.push({ v: before, w: 1 });
    if (after != null) parts.push({ v: after, w: 1 });
    const value = parts.length
      ? parts.reduce((s, p) => s + p.v * p.w, 0) / parts.reduce((s, p) => s + p.w, 0)
      : last;
    last = value;
    smoothed.push({ age, value });
  }

  // Once the curve turns down it should stay down — the market thins out at
  // the old end and an odd survivor must not read as a late-career rebound.
  const peakIndex = smoothed.reduce((best, p, i) => (p.value > smoothed[best]!.value ? i : best), 0);
  for (let i = peakIndex + 1; i < smoothed.length; i += 1) {
    smoothed[i]!.value = Math.min(smoothed[i]!.value, smoothed[i - 1]!.value);
  }

  const peak = smoothed[peakIndex]!.value || 1;
  return {
    position: position.toUpperCase(),
    points: smoothed.map((p) => ({ age: p.age, value: Math.round((p.value / peak) * 1000) / 1000 })),
    sampleSize: usable.length,
    source: "market",
    fittedAt,
  };
}

/** Fits every position we track, falling back to the hand-set shape. */
export function fitAgeCurves(
  rows: { position: string; age: number | null; value: number }[],
  fittedAt = new Date().toISOString(),
): AgeCurve[] {
  return CURVE_POSITIONS.map((position) => {
    const own = rows.filter((r) => r.position.toUpperCase() === position);
    return fitCurve(position, own, fittedAt) ?? handCurve(position);
  });
}

/** Relative value at an age, interpolated between the fitted points. */
export function curveValueAt(curve: AgeCurve, age: number): number {
  const points = curve.points;
  if (!points.length) return 1;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (age <= first.age) return first.value;
  if (age >= last.age) return last.value;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (age <= b.age) {
      const t = (age - a.age) / Math.max(0.001, b.age - a.age);
      return a.value + (b.value - a.value) * t;
    }
  }
  return last.value;
}

/** Age at which the fitted curve tops out. */
export function curvePeakAge(curve: AgeCurve): number {
  return curve.points.reduce((best, p) => (p.value > curveValueAt(curve, best) ? p.age : best), curve.points[0]?.age ?? 25);
}

export type ProductionTier = "elite" | "starter" | "replacement";
export type TrajectoryClass = "rising" | "peak" | "declining" | "cliff";

export const TRAJECTORY_LABEL: Record<TrajectoryClass, string> = {
  rising: "Rising",
  peak: "Peak",
  declining: "Declining",
  cliff: "Cliff",
};

/** Top-12 at the position age more slowly; sub-replacement players faster. */
const TIER_SLOPE: Record<ProductionTier, number> = {
  elite: 0.6,
  starter: 1,
  replacement: 1.4,
};

export interface Trajectory {
  position: string;
  age: number;
  now: number;
  plus1: number;
  plus2: number;
  /** ±15% band around each point. */
  band: { low: number; high: number }[];
  change1: number;
  change2: number;
  classification: TrajectoryClass;
  tier: ProductionTier;
  curveSource: "market" | "hand";
  peakAge: number;
  /** One sentence naming the curve, the age and the sell window. */
  sentence: string;
}

const BAND = 0.15;

export function classifyTrajectory(change1: number): TrajectoryClass {
  if (change1 > 0.05) return "rising";
  if (change1 >= -0.05) return "peak";
  if (change1 >= -0.2) return "declining";
  return "cliff";
}

function sellWindow(cls: TrajectoryClass, age: number, peakAge: number) {
  if (cls === "rising") return `value still climbing — hold, and revisit around ${Math.round(peakAge)}`;
  if (cls === "peak") return "at the top of the curve — this is the best sell window";
  if (cls === "declining") return "sell this season while the market still pays for the name";
  return "sell now; another year takes a fifth or more off the price";
}

/**
 * Value now, in a year and in two years, walking the position's curve from the
 * player's age with the slope adjusted for how much they still produce.
 */
export function trajectoryFor(options: {
  position: string;
  age: number;
  value: number;
  tier: ProductionTier;
  curve: AgeCurve;
}): Trajectory {
  const { position, age, value, tier, curve } = options;
  const here = Math.max(0.001, curveValueAt(curve, age));
  const slope = TIER_SLOPE[tier];
  const ratio = (years: number) => {
    const raw = curveValueAt(curve, age + years) / here;
    // Production rank only changes how fast a player falls, not how fast the
    // curve lifts a young player.
    const adjusted = raw < 1 ? 1 + (raw - 1) * slope : raw;
    return Math.max(0.05, adjusted);
  };
  const r1 = ratio(1);
  const r2 = ratio(2);
  const now = Math.round(value);
  const plus1 = Math.round(value * r1);
  const plus2 = Math.round(value * r2);
  const band = [now, plus1, plus2].map((v) => ({
    low: Math.round(v * (1 - BAND)),
    high: Math.round(v * (1 + BAND)),
  }));
  const classification = classifyTrajectory(r1 - 1);
  const peakAge = curvePeakAge(curve);
  const curveName = `${position.toUpperCase()} ${curve.source === "market" ? "market" : "standard"} age curve`;
  const sentence = `On the ${curveName}, a ${age}-year-old is ${
    age < peakAge ? `${Math.round(peakAge - age)} year${Math.round(peakAge - age) === 1 ? "" : "s"} from the peak at ${Math.round(peakAge)}` : age > peakAge ? `${Math.round(age - peakAge)} year${Math.round(age - peakAge) === 1 ? "" : "s"} past the peak at ${Math.round(peakAge)}` : "right at the peak"
  } — ${sellWindow(classification, age, peakAge)}.`;

  return {
    position: position.toUpperCase(),
    age,
    now,
    plus1,
    plus2,
    band,
    change1: r1 - 1,
    change2: r2 - 1,
    classification,
    tier,
    curveSource: curve.source,
    peakAge,
    sentence,
  };
}

/** Top 12 at the position is elite; outside the starting pool is replacement. */
export function tierFromRank(positionRank: number | null, teamCount: number, position: string): ProductionTier {
  if (positionRank == null) return "starter";
  if (positionRank <= 12) return "elite";
  const starters = position.toUpperCase() === "QB" ? teamCount : teamCount * 2;
  return positionRank > starters ? "replacement" : "starter";
}
