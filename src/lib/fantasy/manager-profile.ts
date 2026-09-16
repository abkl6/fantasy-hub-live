/**
 * Reading the manager on the other side of the trade.
 *
 * Everything here comes from what a rival has actually done in this league:
 * the ages of the players they have taken in against the ages they have sent
 * out, how many picks they hoard, how often they say yes, and the positions
 * they reliably pay over the odds for.
 *
 * Pure math, no I/O.
 */

export interface ManagerMove {
  /** Players this manager received. */
  gotAges: number[];
  gotPositions: string[];
  gotPicks: number;
  /** Players this manager gave up. */
  gaveAges: number[];
  gavePositions: string[];
  gavePicks: number;
  /** Value received minus value sent, in trade-value points. */
  valueGap: number;
  accepted: boolean;
}

export interface ManagerProfile {
  teamId: string;
  /** Average age of players taken in, null when never seen. */
  ageIn: number | null;
  ageOut: number | null;
  /** Positive when they trade for youth. */
  youthLean: number;
  /** Picks accumulated net of picks spent. */
  pickLean: number;
  /** Accepted / offers seen, 0-1; null when no offers are visible. */
  acceptRate: number | null;
  /** Positions they habitually overpay for. */
  overpays: string[];
  moves: number;
}

const OVERPAY_GAP = 3;

function mean(values: number[]): number | null {
  const ok = values.filter((v) => Number.isFinite(v));
  if (!ok.length) return null;
  return Math.round((ok.reduce((a, b) => a + b, 0) / ok.length) * 10) / 10;
}

export function buildManagerProfile(teamId: string, moves: ManagerMove[]): ManagerProfile {
  const ageIn = mean(moves.flatMap((m) => m.gotAges));
  const ageOut = mean(moves.flatMap((m) => m.gaveAges));
  const pickLean = moves.reduce((sum, m) => sum + m.gotPicks - m.gavePicks, 0);
  const seen = moves.length;
  const accepted = moves.filter((m) => m.accepted).length;

  // A position they took in while giving up more value than they got is a
  // position they will pay for again.
  const counts = new Map<string, number>();
  for (const m of moves) {
    if (m.valueGap >= -OVERPAY_GAP) continue;
    for (const pos of m.gotPositions) {
      const key = pos.toUpperCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const overpays = [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([pos]) => pos);

  return {
    teamId,
    ageIn,
    ageOut,
    youthLean: ageIn !== null && ageOut !== null ? Math.round((ageOut - ageIn) * 10) / 10 : 0,
    pickLean,
    acceptRate: seen ? Math.round((accepted / seen) * 100) / 100 : null,
    overpays,
    moves: seen,
  };
}

export interface AcceptanceInput {
  /** 0-1 fairness of the offer from their side; 0.5 is even. */
  fairness: number;
  /** Positions they would receive. */
  theyGet: string[];
  /** Average age of the players they would receive. */
  theyGetAge: number | null;
  /** Average age of the players they would send. */
  theyGiveAge: number | null;
  picksToThem: number;
}

export interface AcceptanceEstimate {
  probability: number;
  band: "low" | "medium" | "high";
  label: string;
  reason: string;
}

export function acceptanceBand(p: number): "low" | "medium" | "high" {
  if (p >= 0.6) return "high";
  if (p >= 0.35) return "medium";
  return "low";
}

/**
 * How likely this manager is to say yes: fairness first, then everything their
 * history says they like.
 */
export function estimateAcceptance(
  profile: ManagerProfile | null,
  offer: AcceptanceInput,
): AcceptanceEstimate {
  const reasons: string[] = [];
  let p = Math.min(0.95, Math.max(0.05, offer.fairness));

  if (profile) {
    if (profile.acceptRate !== null && profile.moves >= 3) {
      // Pull toward how often they actually deal.
      p = p * 0.7 + profile.acceptRate * 0.3;
      reasons.push(`accepts ${Math.round(profile.acceptRate * 100)}% of offers`);
    }
    const overpaid = offer.theyGet.map((x) => x.toUpperCase()).filter((x) => profile.overpays.includes(x));
    if (overpaid.length) {
      p += 0.1;
      reasons.push(`pays up for ${overpaid[0]}`);
    }
    if (
      profile.youthLean > 0.5 &&
      offer.theyGetAge !== null &&
      offer.theyGiveAge !== null &&
      offer.theyGetAge < offer.theyGiveAge
    ) {
      p += 0.08;
      reasons.push("buys youth");
    }
    if (profile.youthLean < -0.5 && offer.theyGetAge !== null && offer.theyGiveAge !== null && offer.theyGetAge > offer.theyGiveAge) {
      p += 0.08;
      reasons.push("buys proven veterans");
    }
    if (profile.pickLean > 0 && offer.picksToThem > 0) {
      p += 0.06;
      reasons.push("collects picks");
    }
  }

  const probability = Math.round(Math.min(0.95, Math.max(0.03, p)) * 100) / 100;
  const band = acceptanceBand(probability);
  return {
    probability,
    band,
    label: `Likely to accept: ${band}`,
    reason: reasons.length ? reasons.join(", ") : "based on the offer alone",
  };
}
