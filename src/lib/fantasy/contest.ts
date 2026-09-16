/**
 * How a league decides its winner: head-to-head matchups, a total-points race,
 * or both at once. Separate from LeagueFormat (redraft / dynasty / …), which
 * describes how rosters are kept. Client-safe: pure values, no I/O.
 */

export const CONTEST_FORMATS = ["h2h", "points", "hybrid", "vp"] as const;
export type ContestFormat = (typeof CONTEST_FORMATS)[number];

export const CONTEST_LABELS: Record<ContestFormat, string> = {
  h2h: "Head to head",
  points: "Total points",
  hybrid: "Hybrid",
  vp: "Victory points",
};

export const CONTEST_DESCRIPTIONS: Record<ContestFormat, string> = {
  h2h: "You play one team each week and the higher score wins.",
  points: "No opponents — every team races on total points for the season.",
  hybrid: "Weekly matchups plus a season-long total points race.",
  vp: "Weekly matchups plus victory points: 2 for a win, 2 for a top-4 score, 1 for 5th to 8th.",
};

export function asContestFormat(value: unknown): ContestFormat {
  const v = String(value ?? "h2h").toLowerCase();
  return (CONTEST_FORMATS as readonly string[]).includes(v) ? (v as ContestFormat) : "h2h";
}

/** Points-only leagues have no opponent anywhere in the app. */
export function isPointsOnly(contest: ContestFormat) {
  return contest === "points";
}

/** Whether a season-long points race should be shown. */
export function hasPointsRace(contest: ContestFormat) {
  return contest === "points" || contest === "hybrid";
}

/** Whether weekly matchups exist. */
export function hasHeadToHead(contest: ContestFormat) {
  return contest === "h2h" || contest === "hybrid" || contest === "vp";
}

/** Whether the standings are ordered by victory points. */
export function usesVictoryPoints(contest: ContestFormat) {
  return contest === "vp";
}

/**
 * FFPC victory points for one week: 2 for winning the matchup, plus 2 for a
 * top-four score in the league that week, 1 for fifth through eighth.
 * `rank` is 1-based across every team's score that week.
 */
export function weeklyVictoryPoints(won: boolean, tied: boolean, rank: number): number {
  const matchup = won ? 2 : tied ? 1 : 0;
  const scoreVp = rank <= 4 ? 2 : rank <= 8 ? 1 : 0;
  return matchup + scoreVp;
}

/**
 * An all-play week has no single opponent: the top half of scorers all win and
 * the bottom half all lose.
 */
export function allPlayResult(rank: number, teamCount: number): "win" | "loss" {
  return rank <= Math.floor(teamCount / 2) ? "win" : "loss";
}

export function asAllPlayWeeks(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n >= 1 && n <= 18))].sort(
    (a, b) => a - b,
  );
}

/** Playoff rules for a total-points league: none, or top N after week X. */
export interface PointsPlayoffRule {
  teams: number | null;
  afterWeek: number | null;
}

export function pointsPlayoffLabel(rule: PointsPlayoffRule) {
  if (!rule.teams) return "No playoffs — highest total wins";
  return rule.afterWeek
    ? `Top ${rule.teams} by total points after week ${rule.afterWeek}`
    : `Top ${rule.teams} by total points`;
}

/** Reads the contest format a platform exposes, falling back to head to head. */
export function contestFormatFromPlatform(
  platform: string,
  raw: { scoringType?: string | null; bestBall?: boolean | null } = {},
): ContestFormat {
  if (raw.bestBall) return "points";
  const t = String(raw.scoringType ?? "").toLowerCase();
  if (platform === "yahoo") return t === "point" || t === "points" ? "points" : "h2h";
  if (platform === "espn") return t === "total_points" ? "points" : "h2h";
  return "h2h";
}
