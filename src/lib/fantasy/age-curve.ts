/**
 * Age curves and value trajectories: how much a position's trade value is
 * worth at each age, and where a given player's value is heading.
 *
 * Curves come from three places, best first:
 *   1. same-player year-over-year moves in `trade_value_history` (40+ pairs),
 *   2. the cross-section of today's market table,
 *   3. hand-set shapes, so the app always has something to draw.
 *
 * Production-by-age curves (from uploaded season totals) are blended into the
 * decline rate; the market curve alone prices the sell estimate.
 *
 * Pure math, no I/O.
 */

export interface CurvePoint {
  age: number;
  value: number;
}

/** Spread of one-year value change at each age, as a fraction. */
export interface DispersionPoint {
  age: number;
  sd: number;
}

export type CurveKind = "market" | "production" | "blended";

export interface AgeCurve {
  position: string;
  points: CurvePoint[];
  sampleSize: number;
  source: "market" | "hand";
  fittedAt: string | null;
  kind?: CurveKind | undefined;
  variant?: string | undefined;
  /** How many same-player year-over-year pairs the fit used (0 = cross-section). */
  pairCount?: number | undefined;
  dispersion?: DispersionPoint[] | undefined;
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

/** Age where each position's curve is allowed to bend. */
export const POSITION_KNOT: Record<string, number> = { RB: 27, WR: 29, TE: 30, QB: 33 };

export function knotFor(position: string): number {
  return POSITION_KNOT[position.toUpperCase()] ?? 28;
}

/** A quarterback with this much of his scoring on the ground ages differently. */
export const QB_RUSH_SHARE_SPLIT = 0.15;
export type CurveVariant = "all" | "rush" | "pocket";

export function qbVariant(rushShare: number | null | undefined): CurveVariant {
  if (rushShare == null || !Number.isFinite(rushShare)) return "all";
  return rushShare >= QB_RUSH_SHARE_SPLIT ? "rush" : "pocket";
}

const MIN_AGE = 20;
const MAX_AGE = 38;
/** Below this many same-player pairs the year-over-year fit is noise. */
export const MIN_PAIRS = 40;

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
    kind: "market",
    variant: "all",
    pairCount: 0,
  };
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/**
 * A cross-section of today's market can make old stars look like proof that
 * value grows with age — the ageing ones we still see are the survivors. No
 * curve is allowed to rise past its position's known peak.
 */
export function clampAfterPeak(position: string, points: CurvePoint[]): CurvePoint[] {
  const peak = HAND_SET[position.toUpperCase()]?.peak ?? 27;
  let ceiling = Infinity;
  return points.map((p) => {
    if (p.age <= peak) return p;
    ceiling = Math.min(ceiling, p.value);
    return { age: p.age, value: Math.min(p.value, ceiling) };
  });
}

function normalisePeak(points: CurvePoint[]): CurvePoint[] {
  const peak = points.reduce((best, p) => Math.max(best, p.value), 0) || 1;
  return points.map((p) => ({ age: p.age, value: Math.round((p.value / peak) * 1000) / 1000 }));
}

/**
 * Two straight lines in log space joined at the position's knot age — a young
 * slope and an old slope. Robust with thin data and it cannot wiggle.
 */
export function fitSpline(
  samples: { age: number; value: number }[],
  knot: number,
): CurvePoint[] | null {
  const usable = samples.filter((s) => Number.isFinite(s.age) && s.value > 0);
  if (usable.length < 12) return null;

  // Median log value per age keeps one loud outlier from tilting a segment.
  const byAge = new Map<number, number[]>();
  for (const s of usable) {
    const age = Math.round(Math.min(MAX_AGE, Math.max(MIN_AGE, s.age)));
    const list = byAge.get(age);
    if (list) list.push(Math.log(s.value));
    else byAge.set(age, [Math.log(s.value)]);
  }
  const anchors = [...byAge.entries()].map(([age, logs]) => ({ age, y: median(logs) }));
  if (anchors.length < 4) return null;

  const segment = (rows: { age: number; y: number }[]) => {
    if (rows.length < 2) return null;
    const n = rows.length;
    const mx = rows.reduce((s, r) => s + r.age, 0) / n;
    const my = rows.reduce((s, r) => s + r.y, 0) / n;
    const den = rows.reduce((s, r) => s + (r.age - mx) ** 2, 0);
    if (den === 0) return null;
    const slope = rows.reduce((s, r) => s + (r.age - mx) * (r.y - my), 0) / den;
    return { slope, at: (age: number) => my + slope * (age - mx) };
  };

  const young = segment(anchors.filter((a) => a.age <= knot));
  const old = segment(anchors.filter((a) => a.age >= knot));
  const both = segment(anchors);
  const youngFit = young ?? both;
  const oldFit = old ?? both;
  if (!youngFit || !oldFit) return null;

  // Join the segments at the knot so the curve is continuous.
  const joinYoung = youngFit.at(knot);
  const joinOld = oldFit.at(knot);
  const points: CurvePoint[] = [];
  for (let age = MIN_AGE; age <= MAX_AGE; age += 1) {
    const y = age <= knot ? youngFit.at(age) : joinYoung + (oldFit.at(age) - joinOld);
    points.push({ age, value: Math.exp(y) });
  }

  // Once the curve turns down it stays down: the market thins at the old end
  // and an odd survivor must not read as a late-career rebound.
  const peakIndex = points.reduce((best, p, i) => (p.value > points[best]!.value ? i : best), 0);
  for (let i = peakIndex + 1; i < points.length; i += 1) {
    points[i]!.value = Math.min(points[i]!.value, points[i - 1]!.value);
  }
  return normalisePeak(points);
}

/**
 * Fits one position's curve from the current market cross-section using the
 * position's knot. Returns null when the sample is too thin to mean anything.
 */
export function fitCurve(
  position: string,
  rows: { age: number | null; value: number }[],
  fittedAt = new Date().toISOString(),
): AgeCurve | null {
  const usable = rows
    .filter((r) => r.age != null && Number.isFinite(r.age) && r.age >= MIN_AGE - 2 && r.age <= MAX_AGE + 4 && r.value > 0)
    .map((r) => ({ age: r.age as number, value: r.value }));
  if (usable.length < 20) return null;
  const fitted = fitSpline(usable, knotFor(position));
  if (!fitted) return null;
  const points = normalisePeak(clampAfterPeak(position, fitted));
  return {
    position: position.toUpperCase(),
    points,
    sampleSize: usable.length,
    source: "market",
    fittedAt,
    kind: "market",
    variant: "all",
    pairCount: 0,
  };
}

export interface YearPair {
  age: number;
  /** value a year later divided by value then. */
  ratio: number;
}

/**
 * Fits from same-player year-over-year moves: the median change at each age,
 * cumulated into a curve. This is what the market actually did to real
 * players, rather than a snapshot of who happens to be young today.
 */
export function fitFromPairs(
  position: string,
  pairs: YearPair[],
  fittedAt = new Date().toISOString(),
): AgeCurve | null {
  const usable = pairs.filter(
    (p) => Number.isFinite(p.age) && Number.isFinite(p.ratio) && p.ratio > 0.05 && p.ratio < 6,
  );
  if (usable.length < MIN_PAIRS) return null;

  const byAge = new Map<number, number[]>();
  for (const p of usable) {
    const age = Math.round(Math.min(MAX_AGE, Math.max(MIN_AGE, p.age)));
    const list = byAge.get(age);
    if (list) list.push(Math.log(p.ratio));
    else byAge.set(age, [Math.log(p.ratio)]);
  }
  if (byAge.size < 4) return null;

  // Median log-change per age, smoothed across neighbours, then walked from
  // the youngest age upward to build a level curve out of the changes.
  const step = new Map<number, number>();
  for (const [age, logs] of byAge) step.set(age, median(logs));

  const points: CurvePoint[] = [];
  let level = 0;
  for (let age = MIN_AGE; age <= MAX_AGE; age += 1) {
    points.push({ age, value: Math.exp(level) });
    const here = step.get(age);
    const before = step.get(age - 1);
    const after = step.get(age + 1);
    const parts: { v: number; w: number }[] = [];
    if (here != null) parts.push({ v: here, w: 2 });
    if (before != null) parts.push({ v: before, w: 1 });
    if (after != null) parts.push({ v: after, w: 1 });
    const change = parts.length
      ? parts.reduce((s, p) => s + p.v * p.w, 0) / parts.reduce((s, p) => s + p.w, 0)
      : 0;
    level += change;
  }

  return {
    position: position.toUpperCase(),
    points: normalisePeak(points),
    sampleSize: usable.length,
    source: "market",
    fittedAt,
    kind: "market",
    variant: "all",
    pairCount: usable.length,
    dispersion: dispersionFromPairs(usable),
  };
}

/** Spread (standard deviation) of one-year change at each age. */
export function dispersionFromPairs(pairs: YearPair[]): DispersionPoint[] {
  const byAge = new Map<number, number[]>();
  for (const p of pairs) {
    if (!Number.isFinite(p.age) || !(p.ratio > 0)) continue;
    const age = Math.round(Math.min(MAX_AGE, Math.max(MIN_AGE, p.age)));
    const list = byAge.get(age);
    if (list) list.push(p.ratio - 1);
    else byAge.set(age, [p.ratio - 1]);
  }
  const out: DispersionPoint[] = [];
  for (let age = MIN_AGE; age <= MAX_AGE; age += 1) {
    const here = [...(byAge.get(age) ?? []), ...(byAge.get(age - 1) ?? []), ...(byAge.get(age + 1) ?? [])];
    if (here.length < 6) continue;
    const mean = here.reduce((s, v) => s + v, 0) / here.length;
    const variance = here.reduce((s, v) => s + (v - mean) ** 2, 0) / here.length;
    out.push({ age, sd: Math.round(Math.min(0.9, Math.max(0.04, Math.sqrt(variance))) * 1000) / 1000 });
  }
  return out;
}

export const DEFAULT_DISPERSION = 0.15;

export function dispersionAt(dispersion: DispersionPoint[] | undefined, age: number): number {
  if (!dispersion?.length) return DEFAULT_DISPERSION;
  let best = dispersion[0]!;
  for (const p of dispersion) {
    if (Math.abs(p.age - age) < Math.abs(best.age - age)) best = p;
  }
  return best.sd;
}

/** Mixes two curves point by point in log space (weight applies to `a`). */
export function blendCurves(a: AgeCurve, b: AgeCurve | null, weight = 0.5): AgeCurve {
  if (!b || !b.points.length) return a;
  const points: CurvePoint[] = a.points.map((p) => {
    const other = curveValueAt(b, p.age);
    const mixed = Math.exp(weight * Math.log(Math.max(0.001, p.value)) + (1 - weight) * Math.log(Math.max(0.001, other)));
    return { age: p.age, value: mixed };
  });
  return {
    ...a,
    points: normalisePeak(points),
    kind: "blended",
    sampleSize: a.sampleSize + b.sampleSize,
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

export function trajectoryLabel(cls: TrajectoryClass, uncertain = false) {
  return uncertain ? `${TRAJECTORY_LABEL[cls]} (uncertain)` : TRAJECTORY_LABEL[cls];
}

/** Top-12 at the position age more slowly; sub-replacement players faster. */
const TIER_SLOPE: Record<ProductionTier, number> = {
  elite: 0.6,
  starter: 1,
  replacement: 1.4,
};

/**
 * How fast a player climbs the young side of the curve. Top-12 production or
 * first-round draft capital climbs faster; no production plus day-3 capital
 * barely climbs at all.
 */
export function riseSlope(tier: ProductionTier, draftRound: number | null | undefined): number {
  const firstRound = draftRound != null && draftRound === 1;
  const dayThree = draftRound != null && draftRound >= 4;
  if (tier === "elite" || firstRound) return 1.3;
  if (tier === "replacement" && dayThree) return 0.5;
  return 1;
}

/** Things about a player's situation that nudge the one-year outlook. */
export interface SituationFeatures {
  /** Last-4-week target or carry share minus the season share. Under-26 only. */
  roleTrend?: number | null | undefined;
  draftRound?: number | null | undefined;
  /** Under-26 only. */
  contractYear?: boolean | undefined;
  /** Games missed across the previous two seasons. */
  gamesMissed2y?: number | null | undefined;
}

const SHIFT_CAP = 0.08;

/** Bounded nudge to the one-year change, as a fraction. */
export function situationShift(age: number, features: SituationFeatures): number {
  const young = age < 26;
  let shift = 0;

  if (young && features.roleTrend != null && Number.isFinite(features.roleTrend)) {
    // A 10-point share swing is worth ~4%.
    shift += Math.max(-0.04, Math.min(0.04, features.roleTrend * 0.4));
  }
  if (young && features.draftRound != null) {
    if (features.draftRound === 1) shift += 0.03;
    else if (features.draftRound === 2) shift += 0.015;
    else if (features.draftRound >= 5) shift -= 0.02;
  }
  if (young && features.contractYear) shift -= 0.02;

  const missed = features.gamesMissed2y ?? 0;
  if (missed > 0) shift -= Math.min(0.05, (missed / 34) * 0.12);

  return Math.round(Math.max(-SHIFT_CAP, Math.min(SHIFT_CAP, shift)) * 1000) / 1000;
}

export interface Trajectory {
  position: string;
  age: number;
  now: number;
  plus1: number;
  plus2: number;
  /** Band from the real spread of year-over-year moves at this age. */
  band: { low: number; high: number }[];
  change1: number;
  change2: number;
  classification: TrajectoryClass;
  /** True when the band straddles a class boundary. */
  uncertain: boolean;
  label: string;
  tier: ProductionTier;
  curveSource: "market" | "hand";
  /** How many same-player moves the curve was fitted from. */
  pairCount: number;
  dispersion: number;
  situationShift: number;
  peakAge: number;
  /** One sentence naming the curve, the age and the sell window. */
  sentence: string;
}

const THRESHOLDS = [0.05, -0.05, -0.2];

export function classifyTrajectory(change1: number): TrajectoryClass {
  if (change1 > 0.05) return "rising";
  if (change1 >= -0.05) return "peak";
  if (change1 >= -0.2) return "declining";
  return "cliff";
}

/**
 * Uncertain when a class boundary sits close enough that the ordinary spread
 * of year-to-year moves could easily land the player on the other side. Half a
 * standard deviation keeps the flag meaningful: with a wide band almost every
 * player would otherwise be labelled uncertain.
 */
export function isUncertain(change1: number, sd: number): boolean {
  const reach = Math.max(0.015, Math.min(0.04, sd * 0.25));
  return THRESHOLDS.some((t) => Math.abs(change1 - t) < reach);
}

export interface SellContext {
  /** Draft picks and first-year players are priced on the rookie-draft calendar. */
  rookieOrPick?: boolean | undefined;
  /** Month 0-11, from the current date. */
  month?: number | undefined;
}

/** Sell timing in plain words, aware of where we are in the football year. */
export function sellWindowSentence(
  cls: TrajectoryClass,
  age: number,
  peakAge: number,
  tier: ProductionTier,
  ctx: SellContext = {},
): string {
  const month = ctx.month ?? new Date().getUTCMonth();
  const inSeason = month >= 8 || month === 0; // September through January
  const beforeDraft = month >= 1 && month <= 3; // February through April

  if (ctx.rookieOrPick) {
    return beforeDraft
      ? "price peaks in the weeks before the rookie draft — move it then"
      : cls === "rising"
        ? "hold until the run-up to next year's rookie draft"
        : "sell before the rookie draft, when pick fever is highest";
  }

  const producing = tier !== "replacement";
  if (cls === "rising") {
    return `value still climbing — hold, and revisit around ${Math.round(peakAge)}`;
  }
  if (cls === "peak") {
    if (inSeason && producing) return "at the top of the curve — sell in-season while the weekly scores are on the screen";
    return "at the top of the curve — this is the best sell window";
  }
  if (cls === "declining") {
    if (inSeason && producing) return "sell in-season, on the back of a big week, while the market still pays for the name";
    return "sell after the rookie draft, when contenders are shopping for a win-now piece";
  }
  return inSeason && producing
    ? "sell now, this season; another year takes a fifth or more off the price"
    : "sell now — waiting past the draft costs a fifth or more of the price";
}

/**
 * Value now, in a year and in two years, walking the position's curve from the
 * player's age with the slope adjusted for how much they still produce and for
 * their situation.
 */
export function trajectoryFor(options: {
  position: string;
  age: number;
  value: number;
  tier: ProductionTier;
  /** Market curve — prices the value estimate. */
  curve: AgeCurve;
  /** Market blended with production — sets how fast the player falls. */
  declineCurve?: AgeCurve | null | undefined;
  situation?: SituationFeatures | undefined;
  sell?: SellContext | undefined;
}): Trajectory {
  const { position, age, value, tier, curve } = options;
  const decline = options.declineCurve ?? curve;
  const situation = options.situation ?? {};
  const slope = TIER_SLOPE[tier];
  const rise = riseSlope(tier, situation.draftRound);

  const hereValue = Math.max(0.001, curveValueAt(curve, age));
  const hereDecline = Math.max(0.001, curveValueAt(decline, age));

  const ratio = (years: number) => {
    const marketRaw = curveValueAt(curve, age + years) / hereValue;
    const declineRaw = curveValueAt(decline, age + years) / hereDecline;
    // Falling uses the blended (market + production) shape; climbing uses the
    // market, which is what actually sets the sell price.
    const raw = declineRaw < 1 ? declineRaw : marketRaw;
    const adjusted = raw < 1 ? 1 + (raw - 1) * slope : 1 + (raw - 1) * rise;
    return Math.max(0.05, adjusted);
  };

  const shift = situationShift(age, situation);
  const r1 = Math.max(0.05, ratio(1) + shift);
  const r2 = Math.max(0.05, ratio(2) + shift * 1.5);

  const now = Math.round(value);
  const plus1 = Math.round(value * r1);
  const plus2 = Math.round(value * r2);

  const sd = dispersionAt(curve.dispersion ?? decline.dispersion, age);
  const spread = [sd * 0.4, sd, sd * Math.SQRT2];
  const band = [now, plus1, plus2].map((v, i) => ({
    low: Math.round(v * Math.max(0.05, 1 - spread[i]!)),
    high: Math.round(v * (1 + spread[i]!)),
  }));

  const change1 = r1 - 1;
  const classification = classifyTrajectory(change1);
  const uncertain = isUncertain(change1, sd);
  const peakAge = curvePeakAge(curve);
  const curveName = `${position.toUpperCase()} ${curve.source === "market" ? "market" : "standard"} age curve`;
  const distance =
    age < peakAge
      ? `${Math.round(peakAge - age)} year${Math.round(peakAge - age) === 1 ? "" : "s"} from the peak at ${Math.round(peakAge)}`
      : age > peakAge
        ? `${Math.round(age - peakAge)} year${Math.round(age - peakAge) === 1 ? "" : "s"} past the peak at ${Math.round(peakAge)}`
        : "right at the peak";
  const sentence = `On the ${curveName}, a ${age}-year-old is ${distance} — ${sellWindowSentence(
    classification,
    age,
    peakAge,
    tier,
    options.sell ?? {},
  )}.`;

  return {
    position: position.toUpperCase(),
    age,
    now,
    plus1,
    plus2,
    band,
    change1,
    change2: r2 - 1,
    classification,
    uncertain,
    label: trajectoryLabel(classification, uncertain),
    tier,
    curveSource: curve.source,
    pairCount: curve.pairCount ?? 0,
    dispersion: sd,
    situationShift: shift,
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
