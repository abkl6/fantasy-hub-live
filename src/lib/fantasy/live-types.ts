/** Shapes returned by the live game-day feed. Client-safe (types only). */

export interface LivePlayerRow {
  name: string;
  position: string;
  nflTeam: string | null;
  slot: string;
  isStarter: boolean;
  livePoints: number;
  projPoints: number;
  projectedFinal: number;
  gameState: "pre" | "in" | "post";
  gameClock: string | null;
  opponent: string | null;
}

export interface LiveEventRow {
  id: string;
  leagueId: string;
  leagueName: string;
  playerName: string;
  position: string;
  nflTeam: string | null;
  description: string;
  points: number;
  side: "mine" | "opponent";
  occurredAt: string;
  myScore: number;
  oppScore: number;
}

/** Total-points leagues race on cumulative score instead of an opponent. */
export interface LivePointsRace {
  /** Where my live score sits among every team this week. */
  rankThisWeek: number;
  /** Where my season total sits. */
  seasonRank: number;
  seasonTotal: number;
  teamCount: number;
  /** The place directly above me in the season table, when there is one. */
  gapAbove: { name: string; points: number } | null;
  gapBelow: { name: string; points: number } | null;
  firstOdds: number;
  topThreeOdds: number;
  topNOdds: number | null;
  topN: number | null;
  /** My players who have not finished, and what they are projected to add. */
  playersLeft: number;
  projectedRemaining: number;
}

/** The league's weekly top-scorer bonus, when the league runs one. */
export interface LiveWeeklyHigh {
  probability: number;
  leaderName: string;
  /** Points between me and the current leader; negative when I lead. */
  gap: number;
  leading: boolean;
  label: string | null;
}

export interface LiveMatchup {
  leagueId: string;
  leagueName: string;
  /** Palette key chosen for this league, used for stripes and tiles. */
  color: string | null;
  scoringLabel: string;
  format: string;
  /** "h2h", "points" or "hybrid". */
  contestFormat: string;
  /** Total-points standing, on points and hybrid leagues only. */
  pointsRace: LivePointsRace | null;
  /** Weekly top-scorer bonus read, when the league runs one. */
  weeklyHigh: LiveWeeklyHigh | null;
  week: number;
  myTeam: string;
  oppTeam: string | null;
  myScore: number;
  oppScore: number;
  myProjected: number;
  oppProjected: number;
  yetToPlay: number;
  oppYetToPlay: number;
  winProbability: number | null;
  titleOdds: number | null;
  playoffOdds: number | null;
  /** Title and playoff odds recorded for each completed week. */
  oddsHistory: { week: number; titleOdds: number; playoffOdds: number }[];
  gameState: "pre" | "in" | "post";
  /** One-line "what you need" read, null once the matchup is final. */
  needLine: string | null;
  isBestBall: boolean;
  leagueRank: number | null;
  teamCount: number;
  starters: LivePlayerRow[];
  bench: LivePlayerRow[];
  oppStarters: LivePlayerRow[];
  oppBench: LivePlayerRow[];
}

/** One NFL game this week, with its live score when the scoreboard has it. */
export interface LiveGame {
  id: string;
  home: string;
  away: string;
  homeScore: number | null;
  awayScore: number | null;
  gameState: "pre" | "in" | "post";
  gameClock: string | null;
  /** ISO kickoff time when the scoreboard knows it. */
  kickoff: string | null;
  /** "Thursday night", "Sunday early", "Sunday night", and so on. */
  window: string;
  today: boolean;
}

export interface GameDayPayload {
  season: number;
  week: number;
  updatedAt: string | null;
  matchups: LiveMatchup[];
  events: LiveEventRow[];
  /** ISO time of the next kickoff still ahead this week, when known. */
  nextKickoff?: string | null;
  /** Only filled when the caller asks for the game slate. */
  games: LiveGame[];

}
