/**
 * FAAB bidding math for guillotine leagues. Survival is the only currency:
 * what a player is worth to a manager is how much elimination risk he removes,
 * and what you actually have to pay is set by the most desperate rival who can
 * still afford him. Pure functions, no I/O.
 */

export interface FaabRival {
  id: string;
  name: string;
  /** 0-1 chance of NOT being eliminated this coming week, before the pickup. */
  surviveWeekOdds: number;
  /** How much this player would raise that team's weekly survival odds (0-1). */
  survivalGain: number;
  /** Dollars this team still has; null when unknown. */
  faabRemaining: number | null;
}

export interface BidLadderInput {
  /** League starting budget ($100 or $1000). */
  budget: number;
  /** What I have left to spend. */
  myRemaining: number;
  /** My own weekly survival odds before the pickup. */
  mySurviveWeekOdds: number;
  /** Survival odds I gain by adding him. */
  mySurvivalGain: number;
  rivals: FaabRival[];
  /** Teams still alive, used to read what "normal" elimination risk looks like. */
  teamCount: number;
  /** Weeks of guillotine left; budget saved past the end is wasted. */
  weeksLeft: number;
  /** True in a week where an eliminated roster just flooded the pool. */
  poolFlooded?: boolean;
}

export interface BidLadder {
  aggressive: number;
  optimal: number;
  passive: number;
  /** Plain-English read on the room. */
  reason: string;
  /** The strongest bid we expect to face. */
  expectedTopRival: number;
  /** Rivals desperate enough to chase him with money to spend. */
  threats: { name: string; bid: number }[];
}

/**
 * 0-1 desperation. A team sitting on exactly average elimination risk reads
 * about 0.35; the projected low scorer reads near 1.
 */
export function desperationOf(surviveWeekOdds: number, teamCount: number): number {
  const evenRisk = 1 / Math.max(2, teamCount);
  const risk = Math.max(0, 1 - surviveWeekOdds);
  return Math.max(0, Math.min(1, (risk / evenRisk) * 0.35));
}

/** What one manager would rationally pay, capped by the money they hold. */
export function willingToPay(
  budget: number,
  remaining: number | null,
  surviveWeekOdds: number,
  survivalGain: number,
  teamCount: number,
  weeksLeft: number,
): number {
  const desperation = desperationOf(surviveWeekOdds, teamCount);
  // Late in the season unspent budget is worthless, so the same help is worth
  // a bigger slice of what's left.
  const lateness = weeksLeft <= 1 ? 1.6 : weeksLeft <= 3 ? 1.3 : 1;
  const share = Math.min(1, Math.max(0, survivalGain) * (0.9 + 2.6 * desperation) * lateness);
  const cash = remaining == null ? budget * 0.5 : Math.max(0, remaining);
  return Math.round(Math.min(cash, budget * share));
}

const clampBid = (value: number, remaining: number) =>
  Math.max(0, Math.min(Math.round(remaining), Math.round(value)));

/** Three bids: the price that wins a war, the balanced number, and the steal. */
export function bidLadder(input: BidLadderInput): BidLadder {
  const { budget, myRemaining, teamCount, weeksLeft } = input;
  const flood = input.poolFlooded ? 0.75 : 1;

  const threats = input.rivals
    .map((r) => ({
      name: r.name,
      bid: Math.round(
        willingToPay(budget, r.faabRemaining, r.surviveWeekOdds, r.survivalGain, teamCount, weeksLeft) *
          flood,
      ),
    }))
    .filter((t) => t.bid > 0)
    .sort((a, b) => b.bid - a.bid);

  const expectedTopRival = threats[0]?.bid ?? 0;
  const myWorth = Math.round(
    willingToPay(
      budget,
      myRemaining,
      input.mySurviveWeekOdds,
      input.mySurvivalGain,
      teamCount,
      weeksLeft,
    ) * flood,
  );
  const myDesperation = desperationOf(input.mySurviveWeekOdds, teamCount);

  // Safe teams should not be dragged into somebody else's panic auction: they
  // only go past their own valuation by a little.
  const stretch = 1 + myDesperation * 0.8;
  const unit = Math.max(1, Math.round(budget / 100));

  const passive = clampBid(Math.max(unit, Math.min(myWorth, expectedTopRival * 0.55)), myRemaining);
  const optimalRaw = Math.min(myWorth * stretch, Math.max(myWorth * 0.6, expectedTopRival + unit));
  const optimal = clampBid(Math.max(passive, optimalRaw), myRemaining);
  const aggressive = clampBid(
    Math.max(optimal + unit, expectedTopRival * 1.25 + unit * 2, myWorth * stretch * 1.2),
    myRemaining,
  );

  const hot = threats.filter((t) => t.bid >= Math.max(unit * 3, expectedTopRival * 0.7));
  let reason: string;
  if (!threats.length) {
    reason = "Nobody left alive both needs him and can pay — the minimum should do it.";
  } else if (hot.length >= 2) {
    reason = `${hot.length} teams near the cut line can afford him (top read $${expectedTopRival}) — expect heat.`;
  } else {
    reason = `${threats[0]!.name} is the one real threat, good for about $${expectedTopRival}.`;
  }
  if (myDesperation < 0.3) {
    reason += " You're safe this week, so there's no need to win every war.";
  } else if (myDesperation > 0.7) {
    reason += " You're on the block — losing this bid costs more than the money.";
  }
  if (input.poolFlooded) reason += " A full roster just hit waivers, so prices sag.";

  return { aggressive, optimal, passive, reason, expectedTopRival, threats: threats.slice(0, 3) };
}
