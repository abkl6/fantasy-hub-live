/** Client-safe shapes for the cross-league waivers view. */

export interface WaiverHubLeagueEntry {
  leagueId: string;
  leagueName: string;
  leagueColor: string | null;
  platform: string;
  /** This player's projected points this week under that league's scoring. */
  projWeek: number;
  faabBudget: number;
  faabRemaining: number | null;
  /** Suggested bid in dollars, read off winning bids in that league. */
  suggestedBid: number;
  /** Where the number came from, in plain English. */
  basis: string;
  /** The platform's waiver / add-player page for that league. */
  url: string | null;
  urlLabel: string | null;
  /** "+1.8% title" — simulated worth of the claim in that league. */
  impactLabel: string | null;
  impactRank: number;
  /** One line naming the strategy rule that changed this bid. */
  ruleNote?: string | null;
}

export interface WaiverHubPlayer {
  key: string;
  name: string;
  position: string;
  nflTeam: string | null;
  status: string;
  byeWeek: number | null;
  /** Best weekly projection across the leagues he is free in. */
  bestProj: number;
  /** Rank inside the top-120 projection pool. */
  rank: number;
  /** Best impact score across the leagues he is free in. */
  bestImpact: number;
  leagues: WaiverHubLeagueEntry[];
}

export interface WaiverHubPayload {
  generatedAt: string;
  week: number;
  leagues: { id: string; name: string; color: string | null; platform: string; faabRemaining: number | null; faabBudget: number }[];
  players: WaiverHubPlayer[];
}
