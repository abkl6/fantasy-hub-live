/**
 * Budget pacing.
 *
 * A budget spent by Week 6 is a budget you do not have when three starters are
 * on bye in Week 10. The plan spreads what is left across the weeks still to
 * come, weighted by how much of your starting lineup is off that week and by
 * what winning claims have historically cost in this league at that point in
 * the season.
 *
 * Pure math, no I/O.
 */

export interface FaabPlanInput {
  currentWeek: number;
  /** Last week claims still matter — usually the last regular-season week. */
  lastWeek: number;
  remaining: number;
  /** Bye week of each of my starters, ignoring byes already past. */
  starterByeWeeks: number[];
  /** Winning bids seen in this league, by the week they were won. */
  historicalWins: { week: number; amount: number }[];
}

export interface FaabWeekPlan {
  week: number;
  /** Share of the remaining budget this week is expected to need, 0-1. */
  share: number;
  /** Dollars the plan sets aside for this week. */
  budget: number;
  /** Starters on bye that week. */
  byes: number;
}

export interface FaabPlan {
  weeks: FaabWeekPlan[];
  /** Dollars to hold back for the heaviest stretch still ahead. */
  reserve: number;
  /** The weeks that reserve is for, e.g. "Weeks 9-11". */
  reserveWeeks: string;
  /** Most you should spend right now without breaking the plan. */
  spendableNow: number;
  line: string | null;
}

const EMPTY: FaabPlan = {
  weeks: [],
  reserve: 0,
  reserveWeeks: "",
  spendableNow: 0,
  line: null,
};

/** Average winning bid in this league for a given week, blended to the mean. */
function weekCost(historicalWins: { week: number; amount: number }[], week: number): number {
  const all = historicalWins.map((h) => h.amount).filter((a) => a > 0);
  if (!all.length) return 1;
  const mean = all.reduce((a, b) => a + b, 0) / all.length;
  const here = historicalWins.filter((h) => h.week === week).map((h) => h.amount);
  if (!here.length) return mean;
  const local = here.reduce((a, b) => a + b, 0) / here.length;
  return (local + mean) / 2;
}

function label(weeks: number[]): string {
  if (!weeks.length) return "";
  const sorted = [...weeks].sort((a, b) => a - b);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  return first === last ? `Week ${first}` : `Weeks ${first}-${last}`;
}

export function buildFaabPlan(input: FaabPlanInput): FaabPlan {
  const remaining = Math.max(0, Math.round(input.remaining));
  const weeksAhead: number[] = [];
  for (let w = input.currentWeek; w <= input.lastWeek; w++) weeksAhead.push(w);
  if (!weeksAhead.length || remaining <= 0) return EMPTY;

  const byeCount = (week: number) => input.starterByeWeeks.filter((b) => b === week).length;

  // Each week's pull on the budget: what claims cost then, lifted by every
  // starter you have to replace that week.
  const raw = weeksAhead.map((week) => {
    const byes = byeCount(week);
    return { week, byes, weight: weekCost(input.historicalWins, week) * (1 + byes * 0.6) };
  });
  const totalWeight = raw.reduce((sum, r) => sum + r.weight, 0) || 1;

  const weeks: FaabWeekPlan[] = raw.map((r) => ({
    week: r.week,
    byes: r.byes,
    share: Math.round((r.weight / totalWeight) * 1000) / 1000,
    budget: Math.round((r.weight / totalWeight) * remaining),
  }));

  // The reserve covers the busiest stretch ahead: every future week that needs
  // more than an even share of what is left.
  const evenShare = remaining / weeks.length;
  const heavy = weeks.filter((w) => w.week > input.currentWeek && w.budget > evenShare);
  const reserve = Math.min(
    remaining,
    heavy.reduce((sum, w) => sum + w.budget, 0),
  );
  const spendableNow = Math.max(0, remaining - reserve);

  return {
    weeks,
    reserve,
    reserveWeeks: label(heavy.map((w) => w.week)),
    spendableNow,
    line: reserve > 0 ? `Recommended to keep in reserve: $${reserve} for ${label(heavy.map((w) => w.week))}` : null,
  };
}

export interface PacedBid {
  bid: number;
  note: string | null;
}

/** Trims a bid back to whatever the plan leaves free this week. */
export function paceBid(bid: number, plan: FaabPlan, minimum = 1): PacedBid {
  if (!plan.weeks.length || bid <= plan.spendableNow) return { bid, note: null };
  const capped = Math.max(minimum, Math.floor(plan.spendableNow));
  if (capped >= bid) return { bid, note: null };
  return {
    bid: capped,
    note: `Trimmed to $${capped} — $${plan.reserve} is held back for ${plan.reserveWeeks}.`,
  };
}
