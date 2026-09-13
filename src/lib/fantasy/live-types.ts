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
  scoringLabel: string;
  week: number;
  myTeam: string;
  oppTeam: string | null;
  myScore: number;
  oppScore: number;
  myProjected: number;
  oppProjected: number;
  yetToPlay: number;
  oppYetToPlay: number;
  starters: LivePlayerRow[];
  bench: LivePlayerRow[];
  oppStarters: LivePlayerRow[];
}

export interface GameDayPayload {
  season: number;
  week: number;
  updatedAt: string | null;
  matchups: LiveMatchup[];
  events: LiveEventRow[];
}
