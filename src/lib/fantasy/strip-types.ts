/** Client-safe shapes for the persistent league strip. */

export type StripTab = "lineup" | "moves" | "league" | "live";

export interface LeagueStripLive {
  myScore: number;
  oppScore: number;
  oppName: string | null;
  /** 0–1, or null when the league has no head-to-head opponent this week. */
  winProbability: number | null;
  state: "pre" | "in" | "post";
}

export interface LeagueStripTile {
  id: string;
  name: string;
  /** Two or three letters; stored on the league or derived from its name. */
  abbrev: string;
  color: string | null;
  /** "6-3" when a team of mine is on file. */
  record: string | null;
  /** My place in the league table, 1-based. */
  standing: number | null;
  teamCount: number;
  /** Open "This week" rows for this league. */
  todoCount: number;
  live: LeagueStripLive | null;
  /** Matchup line during games, else the top to-do headline. */
  peek: string;
  defaultTab: StripTab;
}

export interface LeagueStripPayload {
  /** True while NFL games are being played. */
  gameDay: boolean;
  tiles: LeagueStripTile[];
}
