/**
 * Players in the same NFL game do not score independently. A quarterback's
 * good day is his receivers' good day, and a shootout lifts both sidelines.
 *
 * Two levels, both pure math:
 *  - same NFL team, quarterback with his pass catchers: 0.35
 *  - opposing teams in the same game: 0.15
 */

export const STACK_CORRELATION = 0.35;
export const OPPONENT_CORRELATION = 0.15;

export interface CorrelatedPlayer {
  position: string;
  nflTeam?: string | null;
  /** Opponent's NFL team this week, when known. */
  opponent?: string | null;
}

const PASS_CATCHERS = new Set(["WR", "TE"]);

function team(p: CorrelatedPlayer) {
  return (p.nflTeam ?? "").toUpperCase() || null;
}

function opponent(p: CorrelatedPlayer) {
  return (p.opponent ?? "").toUpperCase() || null;
}

/** How tightly two players' weeks move together, 0 when they never interact. */
export function correlationBetween(a: CorrelatedPlayer, b: CorrelatedPlayer): number {
  const ta = team(a);
  const tb = team(b);
  if (!ta || !tb) return 0;

  const pa = a.position.toUpperCase();
  const pb = b.position.toUpperCase();

  if (ta === tb) {
    const stack =
      (pa === "QB" && PASS_CATCHERS.has(pb)) || (pb === "QB" && PASS_CATCHERS.has(pa));
    return stack ? STACK_CORRELATION : 0;
  }

  const oa = opponent(a);
  const ob = opponent(b);
  if ((oa && oa === tb) || (ob && ob === ta)) return OPPONENT_CORRELATION;
  return 0;
}

/**
 * Variance of a group of players once their shared games are accounted for:
 * the plain sum of variances plus twice every pairwise covariance.
 */
export function correlatedVariance(
  players: { sd: number; player: CorrelatedPlayer }[],
): number {
  let total = 0;
  for (let i = 0; i < players.length; i++) {
    const a = players[i]!;
    total += a.sd * a.sd;
    for (let j = i + 1; j < players.length; j++) {
      const b = players[j]!;
      const rho = correlationBetween(a.player, b.player);
      if (rho) total += 2 * rho * a.sd * b.sd;
    }
  }
  return total;
}
