/**
 * Weekly score reconciliation. Pure math, no I/O.
 *
 * We re-score each team's week from the stat lines we hold, using that
 * league's own rules, and compare with the score the platform reported. A
 * persistent gap almost always means a rule we don't know about.
 */

import { BASELINE_RULES, scoreStats, type ScoringRules, type StatLine } from "./scoring";

/** A gap smaller than this is rounding, not a missing rule. */
export const RECON_TOLERANCE = 0.5;

export interface ReconPlayer {
  name: string;
  position: string;
  stats: StatLine;
}

export interface TeamReconciliation {
  computed: number;
  reported: number;
  diff: number;
  /** The starter whose stat line carries the most unscored production. */
  topPlayerName: string | null;
  topPlayerDiff: number;
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

/**
 * Points in a stat line that this league's rules ignore, priced at the
 * baseline rules. A big number here is the likeliest home of a missing rule.
 */
export function unscoredPoints(stats: StatLine, rules: ScoringRules): number {
  let total = 0;
  for (const [key, value] of Object.entries(stats)) {
    if (!Number.isFinite(value) || value === 0) continue;
    const rule = rules[key];
    if (rule !== undefined && rule !== 0) continue;
    total += Math.abs(value * (BASELINE_RULES[key] ?? 0));
  }
  return round1(total);
}

export function reconcileTeam(
  starters: ReconPlayer[],
  rules: ScoringRules,
  reported: number,
): TeamReconciliation {
  let computed = 0;
  let topPlayerName: string | null = null;
  let topPlayerDiff = 0;

  for (const player of starters) {
    computed += scoreStats(player.stats, rules, player.position);
    const missed = unscoredPoints(player.stats, rules);
    if (missed > topPlayerDiff) {
      topPlayerDiff = missed;
      topPlayerName = player.name;
    }
  }

  computed = round1(computed);
  const rounded = round1(reported);
  return {
    computed,
    reported: rounded,
    diff: round1(rounded - computed),
    topPlayerName,
    topPlayerDiff,
  };
}

export function hasScoringGap(diff: number): boolean {
  return Math.abs(diff) > RECON_TOLERANCE;
}

/** "Scoring rules may be incomplete — 2.4 pt gap in Week 3" */
export function reconciliationBanner(
  rows: { week: number; diff: number }[],
): { text: string; week: number; gap: number } | null {
  let worst: { week: number; diff: number } | null = null;
  for (const row of rows) {
    if (!hasScoringGap(row.diff)) continue;
    if (!worst || Math.abs(row.diff) > Math.abs(worst.diff)) worst = row;
  }
  if (!worst) return null;
  const gap = round1(Math.abs(worst.diff));
  return {
    text: `Scoring rules may be incomplete — ${gap} pt gap in Week ${worst.week}`,
    week: worst.week,
    gap,
  };
}
