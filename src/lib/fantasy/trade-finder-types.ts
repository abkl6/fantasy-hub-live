/** Client-safe shapes for the Trade Finder. */

import type { Trajectory } from "./age-curve";

export interface TradeFinderAsset {
  name: string;
  position: string;
  proj: number;
  value: number;
  /** Dynasty, keeper and empire leagues only. */
  trajectory?: Trajectory | null;
}

export interface TradeFinderIdea {
  teamId: string;
  teamName: string;
  /** Why these two rosters fit: their hole against my surplus. */
  fitReason: string;
  /** The starting slot they are weakest at. */
  theirWeakSlot: string;
  /** The position I am deepest at. */
  myDeepPosition: string;
  /** Higher means a better match. */
  fitScore: number;
  shape: "2-for-1" | "2-for-2";
  iGive: TradeFinderAsset[];
  iGet: TradeFinderAsset[];
  /** Projected change to the best starting lineup this week. */
  myPointsDelta: number;
  theirPointsDelta: number;
  /** 0-100; 100 means market value is dead even. */
  fairness: number;
  fairnessText: string;
  /** Market value I send minus market value I receive. */
  valueGap: number;
  /** Ready-to-send message. */
  offerText: string;
}

export interface TradeFinderPayload {
  leagueId: string;
  leagueName: string;
  hasMyTeam: boolean;
  myTeamName: string | null;
  projectionLabel: string;
  scoringLabel: string;
  ideas: TradeFinderIdea[];
}
