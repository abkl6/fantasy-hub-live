/**
 * Turns a team's quality badge into a trading posture. A contender should be
 * buying proven production with picks and youth; a rebuilding team should be
 * doing the exact opposite. Everything downstream (trade ideas, waiver
 * ordering, the copy on each card) reads from here.
 */

import type { TeamBadgeKey } from "./team-class";

export type StrategyMode = "buy" | "sell" | "pivot";

export interface TeamStrategy {
  mode: StrategyMode;
  /** Short chip text, e.g. "Buying". */
  label: string;
  /** What this team should be acquiring. */
  wants: string;
  /** What this team should be giving up. */
  gives: string;
  /** One plain-language line explaining the posture. */
  rationale: string;
}

const BUY_BADGES: TeamBadgeKey[] = [
  "top-seed",
  "contender",
  "dynasty-king",
  "dynasty-contender",
  "win-now",
];
const SELL_BADGES: TeamBadgeKey[] = ["bottom", "donator", "future-star"];

export function strategyMode(badge: TeamBadgeKey): StrategyMode {
  if (BUY_BADGES.includes(badge)) return "buy";
  if (SELL_BADGES.includes(badge)) return "sell";
  return "pivot";
}

export function strategyFor(badge: TeamBadgeKey, isDynasty: boolean): TeamStrategy {
  const mode = strategyMode(badge);
  if (mode === "buy") {
    return {
      mode,
      label: "Buying",
      wants: isDynasty ? "proven veteran starters" : "the best starter available",
      gives: isDynasty ? "future picks and young depth" : "surplus depth",
      rationale: isDynasty
        ? "You can win this season — spend future picks and young depth on production now."
        : "You can win this season — turn surplus depth into a stronger starting lineup.",
    };
  }
  if (mode === "sell") {
    return {
      mode,
      label: "Selling",
      wants: isDynasty ? "draft picks and young risers" : "upside players worth keeping",
      gives: isDynasty ? "veterans who won't matter later" : "veterans on a lost season",
      rationale: isDynasty
        ? "This season is gone — cash your veterans in with contenders for picks and youth."
        : "This season is gone — play the young upside and stop chasing small weekly gains.",
    };
  }
  return {
    mode,
    label: "Pick a lane",
    wants: isDynasty ? "either youth or a real upgrade — not both" : "a real upgrade, or nothing",
    gives: isDynasty ? "whichever side you commit to" : "players you are not starting",
    rationale:
      "You're stuck in the middle. Standing still is the worst outcome — commit to buying or selling.",
  };
}

/** Which postures make a good trade partner for this one. */
export function partnerModes(mode: StrategyMode): StrategyMode[] {
  if (mode === "buy") return ["sell", "pivot"];
  if (mode === "sell") return ["buy", "pivot"];
  return ["buy", "sell"];
}

export type AgeLane = "young" | "prime" | "veteran";

/**
 * Running backs age out earlier than everyone else, so their veteran line
 * starts at 26 instead of 29.
 */
export function ageLane(position: string, age: number | null, yearsExp: number | null): AgeLane {
  const pos = position.toUpperCase();
  if (age == null) {
    if (yearsExp != null && yearsExp <= 2) return "young";
    return "prime";
  }
  if (age <= 24 || (yearsExp != null && yearsExp <= 2)) return "young";
  const veteranFrom = pos === "RB" ? 26 : 29;
  if (age >= veteranFrom) return "veteran";
  return "prime";
}
