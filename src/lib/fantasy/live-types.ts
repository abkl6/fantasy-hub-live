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

export interface LiveMatchup {
  leagueId: string;
  leagueName: string;
  /** Palette key chosen for this league, used for stripes and tiles. */
  color: string | null;
  scoringLabel: string;
  format: string;
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
  /** Only filled when the caller asks for the game slate. */
  games: LiveGame[];
}
