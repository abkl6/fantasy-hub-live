/**
 * League format rules: redraft, keeper, dynasty, guillotine and best ball all
 * need different advice from the same roster data. Pure math, no I/O.
 */

import { optimalLineup, type EnginePlayer, type Slot } from "./engine";

export const LEAGUE_FORMATS = ["redraft", "keeper", "dynasty", "guillotine", "best_ball"] as const;
export type LeagueFormat = (typeof LEAGUE_FORMATS)[number];

export const FORMAT_LABELS: Record<LeagueFormat, string> = {
  redraft: "Redraft",
  keeper: "Keeper",
  dynasty: "Dynasty",
  guillotine: "Guillotine",
  best_ball: "Best ball",
};

export function asFormat(value: unknown): LeagueFormat {
  const v = String(value ?? "redraft").toLowerCase();
  return (LEAGUE_FORMATS as readonly string[]).includes(v) ? (v as LeagueFormat) : "redraft";
}

/** Dynasty leagues keep players for years, so age matters as much as output. */
export function isMultiYear(format: LeagueFormat) {
  return format === "dynasty" || format === "keeper";
}

/** Guillotine has no playoffs — survival replaces title odds. */
export function isSurvival(format: LeagueFormat) {
  return format === "guillotine";
}

/** Best ball auto-starts the top scorers, so there is nothing to start or sit. */
export function hasLineupDecisions(format: LeagueFormat) {
  return format !== "best_ball";
}

// --- dynasty value --------------------------------------------------------

/** Age at which each position starts losing value, and how fast. */
const AGE_CURVE: Record<string, { peak: number; decline: number }> = {
  QB: { peak: 30, decline: 0.05 },
  RB: { peak: 25, decline: 0.14 },
  WR: { peak: 27, decline: 0.08 },
  TE: { peak: 28, decline: 0.08 },
  K: { peak: 32, decline: 0.03 },
  DEF: { peak: 99, decline: 0 },
};

/** Where the age used in the curve came from. */
export type AgeSource = "age" | "experience" | "unknown";

/** An unknown age is a guess, so the value it produces is held back. */
const UNKNOWN_AGE_DISCOUNT = 0.85;

/**
 * Long-term value with the age it was based on. An age we never learned is
 * treated as the position's median age in the current market table, not as a
 * player just short of their peak, and is discounted for the uncertainty.
 */
export function dynastyValueDetail(
  position: string,
  seasonProj: number,
  bestSeasonProj: number,
  age: number | null,
  yearsExp: number | null,
  medianAge: number | null = null,
): { value: number; ageSource: AgeSource } {
  const curve = AGE_CURVE[position.toUpperCase()] ?? AGE_CURVE['WR']!;
  const ageSource: AgeSource = age != null ? "age" : yearsExp != null ? "experience" : "unknown";
  const effectiveAge =
    age ??
    (yearsExp != null ? 22 + yearsExp : (medianAge ?? curve.peak));
  const yearsPast = Math.max(0, effectiveAge - curve.peak);
  const decay = Math.pow(1 - curve.decline, yearsPast);
  // Young players who already produce get a small ascending-curve bonus.
  const ascending = effectiveAge < curve.peak - 2 ? 1.12 : 1;
  const uncertainty = ageSource === "unknown" ? UNKNOWN_AGE_DISCOUNT : 1;
  const production = bestSeasonProj > 0 ? seasonProj / bestSeasonProj : 0;
  const value = Math.round(
    Math.max(0, Math.min(100, production * decay * ascending * uncertainty * 100)),
  );
  return { value, ageSource };
}

/**
 * Long-term value, 0-100. Blends this season's projection with how many
 * productive years the player likely has left.
 */
export function dynastyValue(
  position: string,
  seasonProj: number,
  bestSeasonProj: number,
  age: number | null,
  yearsExp: number | null,
  medianAge: number | null = null,
): number {
  return dynastyValueDetail(position, seasonProj, bestSeasonProj, age, yearsExp, medianAge).value;
}

/** How much a format cares about this season versus future seasons. */
export function formatWeights(format: LeagueFormat): { now: number; future: number } {
  switch (format) {
    case "dynasty":
      return { now: 0.45, future: 0.55 };
    case "keeper":
      return { now: 0.75, future: 0.25 };
    case "guillotine":
      return { now: 1, future: 0 };
    default:
      return { now: 1, future: 0 };
  }
}

/** Single comparable number for "should I want this player in this league?". */
export function blendedValue(
  format: LeagueFormat,
  seasonProj: number,
  bestSeasonProj: number,
  longTerm: number,
): number {
  const w = formatWeights(format);
  const nowScore = bestSeasonProj > 0 ? (seasonProj / bestSeasonProj) * 100 : 0;
  return Math.round(nowScore * w.now + longTerm * w.future);
}

// --- guillotine survival ---------------------------------------------------

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export interface SurvivalTeam {
  id: string;
  name: string;
  isMine: boolean;
  mean: number;
  sd: number;
}

export interface SurvivalResult {
  id: string;
  name: string;
  isMine: boolean;
  /** Chance of NOT being the lowest scorer this coming week. */
  surviveWeekOdds: number;
  /** Chance of being the last team standing. */
  winOdds: number;
  /** Expected number of further weeks in the league. */
  expectedWeeksLeft: number;
  powerRank: number;
}

/** Each week the lowest scorer is eliminated; last team standing wins. */
export function simulateGuillotine(
  teams: SurvivalTeam[],
  weeksLeft: number,
  iterations = 2000,
  seed = 7,
): SurvivalResult[] {
  const rand = mulberry32(seed);
  const survivedWeek = new Map<string, number>();
  const won = new Map<string, number>();
  const weeksTotal = new Map<string, number>();
  for (const t of teams) {
    survivedWeek.set(t.id, 0);
    won.set(t.id, 0);
    weeksTotal.set(t.id, 0);
  }

  const maxWeeks = Math.max(1, Math.min(weeksLeft, teams.length - 1));

  for (let i = 0; i < iterations; i++) {
    let alive = teams.slice();
    for (let w = 0; w < maxWeeks && alive.length > 1; w++) {
      const scores = alive.map((t) => ({ t, score: t.mean + gaussian(rand) * t.sd }));
      scores.sort((a, b) => a.score - b.score);
      const out = scores[0]!.t;
      if (w === 0) {
        for (const t of alive) if (t.id !== out.id) survivedWeek.set(t.id, (survivedWeek.get(t.id) ?? 0) + 1);
      }
      for (const t of alive) weeksTotal.set(t.id, (weeksTotal.get(t.id) ?? 0) + 1);
      alive = alive.filter((t) => t.id !== out.id);
    }
    if (alive.length) {
      const share = 1 / alive.length;
      for (const t of alive) won.set(t.id, (won.get(t.id) ?? 0) + share);
    }
  }

  const results = teams.map((t) => ({
    id: t.id,
    name: t.name,
    isMine: t.isMine,
    surviveWeekOdds: (survivedWeek.get(t.id) ?? 0) / iterations,
    winOdds: (won.get(t.id) ?? 0) / iterations,
    expectedWeeksLeft: Math.round(((weeksTotal.get(t.id) ?? 0) / iterations) * 10) / 10,
    powerRank: 0,
  }));

  results
    .slice()
    .sort((a, b) => b.winOdds - a.winOdds || b.surviveWeekOdds - a.surviveWeekOdds)
    .forEach((r, i) => {
      const row = results.find((x) => x.id === r.id)!;
      row.powerRank = i + 1;
    });

  return results;
}

// --- best ball -------------------------------------------------------------

/**
 * Best ball auto-starts the highest scorers each week, so the expected total
 * is the average of the optimal lineup over simulated weeks — always at least
 * as high as the projected lineup, with a tighter spread.
 */
export function bestBallDistribution(roster: EnginePlayer[], slots: Slot[], iterations = 400, seed = 11) {
  if (!roster.length) return { mean: 0, sd: 8 };
  const rand = mulberry32(seed);
  const totals: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const drawn = roster.map((p) => ({
      ...p,
      proj: Math.max(0, p.proj + gaussian(rand) * p.proj * (p.volatility ?? 0.35)),
    }));
    totals.push(optimalLineup(drawn, slots).total);
  }
  const mean = totals.reduce((a, b) => a + b, 0) / totals.length;
  const variance = totals.reduce((sum, t) => sum + (t - mean) * (t - mean), 0) / totals.length;
  return { mean: Math.round(mean * 10) / 10, sd: Math.max(Math.sqrt(variance), 6) };
}
