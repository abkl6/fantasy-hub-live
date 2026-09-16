/**
 * Impact scoring: one comparable number behind every recommendation.
 *
 * Every suggestion in the app (lineup swap, add/drop, trade) is re-run through
 * the season simulation with the change applied. The difference in title odds,
 * playoff odds and — in dynasty/keeper leagues — roster value and its rank is
 * the impact. Which of those numbers is shown depends on what the team is
 * playing for: a contender cares about title odds, a rebuilder about where the
 * roster ranks next year, the middle class about both.
 *
 * Client-safe: no database, no server imports.
 */

import { normalizeName } from "./names";
import type { TeamBadgeKey } from "./team-class";

export type TeamClass = "contender" | "middle" | "rebuilder";

export const TEAM_CLASS_LABEL: Record<TeamClass, string> = {
  contender: "Contender",
  middle: "Middle class",
  rebuilder: "Rebuilder",
};

const CONTENDER_BADGES: TeamBadgeKey[] = [
  "top-seed",
  "contender",
  "dynasty-king",
  "dynasty-contender",
  "win-now",
  "safe",
  "loaded",
];

const REBUILDER_BADGES: TeamBadgeKey[] = [
  "bottom",
  "donator",
  "future-star",
  "chopping-block",
  "broke-exposed",
];

export function teamClassOf(badge: TeamBadgeKey): TeamClass {
  if (CONTENDER_BADGES.includes(badge)) return "contender";
  if (REBUILDER_BADGES.includes(badge)) return "rebuilder";
  return "middle";
}

export interface RecommendationImpact {
  /** Change in championship odds, 0-1. */
  titleDelta: number;
  /** Change in playoff odds, 0-1. */
  playoffDelta: number;
  /** Change in projected wins. */
  winDelta: number;
  /** Change in projected points a week. */
  pointsDelta: number;
  /** Change in the market value of the roster; dynasty/keeper only. */
  dynastyValueDelta: number;
  /** Places gained in the league's roster-value table; positive is better. */
  dynastyRankDelta: number;
}

export const EMPTY_IMPACT: RecommendationImpact = {
  titleDelta: 0,
  playoffDelta: 0,
  winDelta: 0,
  pointsDelta: 0,
  dynastyValueDelta: 0,
  dynastyRankDelta: 0,
};

const signed = (value: number, digits = 1) =>
  `${value >= 0 ? "+" : "-"}${Math.abs(value).toFixed(digits)}`;

/** "+1.8% title" */
export function titleText(impact: RecommendationImpact) {
  return `${signed(impact.titleDelta * 100)}% title`;
}

/** "+2 dynasty rank" */
export function dynastyRankText(impact: RecommendationImpact) {
  const places = Math.round(impact.dynastyRankDelta);
  if (places === 0) {
    const value = Math.round(impact.dynastyValueDelta);
    return `${value >= 0 ? "+" : "-"}${Math.abs(value).toLocaleString()} dynasty value`;
  }
  return `${places >= 0 ? "+" : "-"}${Math.abs(places)} dynasty rank`;
}

/**
 * The one line shown on a suggestion card. Contenders read title odds,
 * rebuilders read dynasty rank, the middle class reads both.
 */
export function primaryImpactText(
  impact: RecommendationImpact,
  teamClass: TeamClass,
  isDynasty: boolean,
): string {
  if (!isDynasty) return titleText(impact);
  if (teamClass === "contender") return titleText(impact);
  if (teamClass === "rebuilder") return dynastyRankText(impact);
  return `${titleText(impact)} · ${dynastyRankText(impact)}`;
}

/** Sort key for a list of suggestions: bigger is better for this team. */
export function impactScore(
  impact: RecommendationImpact,
  teamClass: TeamClass,
  isDynasty: boolean,
): number {
  const future = impact.dynastyRankDelta + impact.dynastyValueDelta / 20000;
  if (!isDynasty || teamClass === "contender") return impact.titleDelta;
  if (teamClass === "rebuilder") return future;
  return impact.titleDelta * 0.5 + future * 0.02;
}

/** Key for a swap (start B over A, or add B and drop A). */
export const impactSwapKey = (add: string, drop: string) =>
  `swap:${normalizeName(add)}|${normalizeName(drop)}`;

/** Key for a plain add. */
export const impactAddKey = (add: string) => `add:${normalizeName(add)}`;
