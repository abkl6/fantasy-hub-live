/**
 * Buy / sell list for dynasty and keeper leagues.
 *
 * The market (Keep Trade Cut) prices a player, the scoreboard measures him.
 * When production is well ahead of price he is a buy; when price is well ahead
 * of production he is a sell. Both ranks are taken inside the player's own
 * position, and a gap of eight places or more is the trigger.
 *
 * Client-safe: pure ranking maths, no database.
 */

import type { TeamClass } from "./impact";

export const BUY_SELL_GAP = 8;

export interface BuySellCandidate {
  name: string;
  position: string;
  nflTeam?: string | null;
  /** Market value in the league's value format. */
  value: number;
  /** Season production so far, in this league's scoring. */
  production: number;
  /** True when the player is on my roster. */
  mine: boolean;
}

export interface BuySellRow {
  name: string;
  position: string;
  nflTeam: string | null;
  side: "buy" | "sell";
  value: number;
  production: number;
  valueRank: number;
  productionRank: number;
  /** Places production sits ahead of price; negative means priced ahead. */
  gap: number;
  mine: boolean;
  reason: string;
}

function rankMap(items: BuySellCandidate[], score: (c: BuySellCandidate) => number) {
  const order = [...items].sort((a, b) => score(b) - score(a));
  return new Map(order.map((item, i) => [item, i + 1]));
}

/**
 * Returns every player whose position value rank and production rank disagree
 * by at least eight places, best gaps first.
 */
export function buildBuySell(candidates: BuySellCandidate[]): BuySellRow[] {
  const byPosition = new Map<string, BuySellCandidate[]>();
  for (const c of candidates) {
    const pos = c.position.toUpperCase();
    const list = byPosition.get(pos);
    if (list) list.push(c);
    else byPosition.set(pos, [c]);
  }

  const rows: BuySellRow[] = [];
  for (const [position, group] of byPosition) {
    // Ranks are meaningless in a tiny pool.
    if (group.length < BUY_SELL_GAP + 2) continue;
    const valueRanks = rankMap(group, (c) => c.value);
    const productionRanks = rankMap(group, (c) => c.production);

    for (const c of group) {
      const valueRank = valueRanks.get(c)!;
      const productionRank = productionRanks.get(c)!;
      const gap = valueRank - productionRank;
      if (Math.abs(gap) < BUY_SELL_GAP) continue;
      const side: "buy" | "sell" = gap > 0 ? "buy" : "sell";
      rows.push({
        name: c.name,
        position,
        nflTeam: c.nflTeam ?? null,
        side,
        value: c.value,
        production: Math.round(c.production * 10) / 10,
        valueRank,
        productionRank,
        gap,
        mine: c.mine,
        reason:
          side === "buy"
            ? `${position}${productionRank} on the field but only ${position}${valueRank} on the market — ${gap} places of cheap production.`
            : `${position}${valueRank} on the market but only ${position}${productionRank} on the field — ${Math.abs(gap)} places of price you can cash in.`,
      });
    }
  }

  return rows.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap) || b.value - a.value);
}

/**
 * A contender wants the cheap producers; a rebuilder wants to cash in price it
 * is not using. The middle class sees both sides.
 */
export function filterBuySellForClass(rows: BuySellRow[], teamClass: TeamClass): BuySellRow[] {
  if (teamClass === "contender") return rows.filter((r) => r.side === "buy" || r.mine);
  if (teamClass === "rebuilder") return rows.filter((r) => r.side === "sell" || !r.mine);
  return rows;
}
