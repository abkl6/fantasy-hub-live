/**
 * How a league decides its winner: head-to-head matchups, a total-points race,
 * or both at once. Separate from LeagueFormat (redraft / dynasty / …), which
 * describes how rosters are kept. Client-safe: pure values, no I/O.
 */

export const CONTEST_FORMATS = ["h2h", "points", "hybrid"] as const;
export type ContestFormat = (typeof CONTEST_FORMATS)[number];

export const CONTEST_LABELS: Record<ContestFormat, string> = {
  h2h: "Head to head",
  points: "Total points",
  hybrid: "Hybrid",
};

export const CONTEST_DESCRIPTIONS: Record<ContestFormat, string> = {
  h2h: "You play one team each week and the higher score wins.",
  points: "No opponents — every team races on total points for the season.",
  hybrid: "Weekly matchups plus a season-long total points race.",
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
  return contest === "h2h" || contest === "hybrid";
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
