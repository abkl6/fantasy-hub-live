/**
 * Waiver wire ordering and bid ceilings. Pure functions so the ranking rules
 * can be tested without a database: what counts as injured, where kickers and
 * defenses belong, how a guillotine board differs from a normal one, and how
 * much a player can sanely cost.
 */

export type WaiverSort = "impact" | "points" | "value" | "ktc" | "gems" | "bid";

/** Positions that fill a real starting slot week to week. */
const SKILL = new Set(["QB", "RB", "WR", "TE", "DL", "LB", "DB"]);

const INJURED = new Set([
  "IR",
  "INJURED RESERVE",
  "OUT",
  "O",
  "SUSPENDED",
  "SUSP",
  "PUP",
  "NA",
]);

/** True when the player cannot be counted on this week. */
export function isInjuredStatus(status: string | null | undefined): boolean {
  const s = String(status ?? "").trim().toUpperCase();
  if (!s) return false;
  return INJURED.has(s);
}

export interface RankableRow {
  id: string;
  position: string;
  status: string;
  /** Rest-of-season projected points. */
  projSeason: number;
  projWeek: number;
  tradeValue: number;
  ktcValue: number | null;
  projValue: number;
  undervalued: boolean;
  /** Projection minus the best available free agent at the same position. */
  vor: number;
  /** Strategy-rule multiplier applied to value over replacement. */
  ruleScore: number;
  /** One line explaining a rule that changed or suppressed this row. */
  ruleNote: string | null;
  bid: number;
  titleDelta: number | null;
  /** Guillotine only: change in this week's survival probability. */
  survivalDelta: number | null;
  /** Guillotine only: he was on a roster that got cut. */
  fromCutTeam: boolean;
  longTermValue: number | null;
}

export interface RankOptions {
  sort: WaiverSort;
  /** Guillotine league: survival is the currency, not the title. */
  survival: boolean;
  showInjured: boolean;
  /** Rebuilding boards lead with keepers. */
  strategy?: string | null;
}

/** Skill players only: kickers and defences live in the fill strip. */
function inMainList(row: RankableRow): boolean {
  return SKILL.has(row.position.toUpperCase());
}

function primary(row: RankableRow, opts: RankOptions): number {
  if (opts.survival) return row.survivalDelta ?? 0;
  return row.titleDelta ?? 0;
}

export function rankWaivers<T extends RankableRow>(rows: T[], opts: RankOptions): T[] {
  const kept = rows
    .filter(inMainList)
    .filter((r) => (opts.showInjured ? true : !isInjuredStatus(r.status)));

  const compare = (a: T, b: T): number => {


    switch (opts.sort) {
      case "points":
        return b.projWeek - a.projWeek || b.projSeason - a.projSeason;
      case "value":
        return b.tradeValue - a.tradeValue;
      case "ktc":
        return (b.ktcValue ?? -1) - (a.ktcValue ?? -1);
      case "gems":
        return (
          Number(b.undervalued) - Number(a.undervalued) ||
          b.projValue - (b.ktcValue ?? b.projValue) - (a.projValue - (a.ktcValue ?? a.projValue))
        );
      case "bid":
        return b.bid - a.bid || b.projSeason - a.projSeason;
      default:
        break;
    }

    // Impact: a rebuilding manager wants keepers, everyone else wants the
    // simulated change in survival (guillotine) or title odds.
    if (opts.strategy === "sell" && !opts.survival) {
      const keep = (b.longTermValue ?? 0) - (a.longTermValue ?? 0);
      if (keep !== 0) return keep;
    }
    const impact = primary(b, opts) - primary(a, opts);
    if (Math.abs(impact) > 1e-6) return impact;
    // Value over replacement is the house ranking rule: what a player is worth
    // is what he gives you over the best free agent you could have instead.
    const vor = b.vor * (b.ruleScore || 1) - a.vor * (a.ruleScore || 1);
    if (Math.abs(vor) > 1e-6) return vor;
    // Nothing separates them on the simulation, so fall back to what they are
    // projected to be worth for the rest of the season. Players from a cut
    // roster break exact ties, since they are usually the better body.
    return (
      b.projSeason - a.projSeason ||
      Number(b.fromCutTeam) - Number(a.fromCutTeam) ||
      b.projWeek - a.projWeek
    );
  };

  return [...kept].sort(compare);
}

// --- bid ceilings ----------------------------------------------------------

/** Points a week that marks a genuine starter, the yardstick for a full bid. */
const STARTER_WEEK_POINTS = 14;

export interface BidCeilingInput {
  /** League FAAB budget. */
  budget: number;
  /** What I still have to spend; the full budget when unknown. */
  remaining?: number | null;
  /** This player's rest-of-season projected points per week. */
  perWeek: number;
  /**
   * What the simulation says adding him is worth: the change in survival odds
   * in a chop league, otherwise the change in title odds. Same number the
   * board is sorted by, so price and order can never disagree.
   */
  impact?: number | null;
  /** The best impact on this board, used to read one player against the rest. */
  topImpact?: number | null;
  /** Points he adds to my best starting lineup this week. */
  lineupGain?: number | null;
  /** The strongest rival bid we expect to face, when we can estimate it. */
  rivalFloor?: number | null;
  /** Winning bids seen in this league's transaction history. */
  winningBids: number[];
}

export interface BidRecommendation {
  /** The bid we suggest, in dollars. */
  recommended: number;
  /** 30% under the recommendation. */
  passive: number;
  /** 30% over the recommendation. */
  aggressive: number;
  /** The most this player can justify, in dollars. */
  ceiling: number;
}

function percentile(values: number[], p: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[idx]!;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/**
 * A bid is worth what the player does for *this* team: the simulated change in
 * survival or title odds that also orders the board, plus the points he adds
 * to the best starting lineup, priced against what claims have historically
 * cost in this league and what the strongest rival can pay.
 */
export function bidRecommendation(input: BidCeilingInput): BidRecommendation {
  const budget = Math.max(1, input.budget);
  const pot = Math.max(0, input.remaining ?? budget);

  // How good is he, on the same scale the list is sorted by? Without a
  // simulation to read, his weekly points stand in for it.
  const impact = Math.max(0, input.impact ?? 0);
  const topImpact = Math.max(0, input.topImpact ?? 0);
  const impactShare = topImpact > 0 ? clamp01(impact / topImpact) : null;
  const pointsShare = clamp01(input.perWeek / STARTER_WEEK_POINTS);
  const gainShare = clamp01((input.lineupGain ?? 0) / 6);

  const share =
    impactShare === null
      ? pointsShare
      : clamp01(0.6 * impactShare + 0.25 * gainShare + 0.15 * pointsShare);

  const history = input.winningBids.filter((n) => n > 0);
  // No history: the best claim of the year is worth about a third of a budget.
  const topPrice = history.length ? Math.max(percentile(history, 0.9), 1) : budget * 0.35;

  let ceiling = Math.min(pot, budget * 0.5, topPrice * (0.3 + share * 1.1));
  // He neither starts nor moves the odds: a bench flier, not an auction. Only
  // judged when a simulation actually ran for him.
  const simulated = input.impact != null || input.lineupGain != null;
  const helps = !simulated || (input.lineupGain ?? 0) > 0.05 || impact > 0;
  if (!helps) ceiling = Math.min(ceiling, budget * 0.05);
  ceiling = Math.max(0, ceiling);

  let recommended = Math.max(
    input.perWeek > 0 ? 1 : 0,
    Math.round(ceiling * (0.4 + share * 0.6)),
  );
  // Somebody else needs him badly enough to pay: a bid under that loses him.
  const floor = Math.max(0, input.rivalFloor ?? 0);
  if (floor > 0 && helps) {
    const unit = Math.max(1, Math.round(budget / 100));
    recommended = Math.min(Math.round(ceiling), Math.max(recommended, Math.round(floor) + unit));
  }
  recommended = Math.min(recommended, Math.round(pot));

  return {
    recommended,
    passive: Math.max(0, Math.round(recommended * 0.7)),
    aggressive: Math.min(Math.round(pot), Math.round(recommended * 1.3)),
    ceiling: Math.round(ceiling),
  };
}

/**
 * Prices can never contradict the order of the board: nobody further down the
 * list may carry a bigger recommended bid than the player above him.
 */
export function enforceBidOrder<T extends { bid: number; bidRec?: BidRecommendation }>(
  rows: T[],
): T[] {
  let cap = Infinity;
  for (const row of rows) {
    if (row.bid > cap) {
      row.bid = cap;
      if (row.bidRec) {
        row.bidRec = {
          ...row.bidRec,
          recommended: cap,
          passive: Math.max(0, Math.round(cap * 0.7)),
          aggressive: Math.min(row.bidRec.aggressive, Math.round(cap * 1.3)),
        };
      }
    }
    cap = row.bid;
  }
  return rows;
}
