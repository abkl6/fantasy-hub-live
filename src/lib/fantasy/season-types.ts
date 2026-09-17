/** Shapes for the Season tab: how the rest of the year could go. */

import type { FinishShares, ScheduleGame, SimTeamInput } from "./engine";

export interface SeasonMarker {
  kind: "trade" | "injury" | "result";
  label: string;
}

export interface SeasonWeekOdds {
  week: number;
  titleOdds: number;
  playoffOdds: number;
  markers: SeasonMarker[];
}

export interface SeasonGame {
  week: number;
  opponentId: string;
  opponentName: string;
  winProb: number;
}

export interface SeasonOutcome {
  iterations: number;
  titleOdds: number;
  playoffOdds: number;
  projWins: number;
  projLosses: number;
  finish: FinishShares;
  /** Share of seasons ending on each win total. */
  winSpread: { wins: number; share: number }[];
  /** Share of seasons finishing on each playoff seed. */
  seedSpread: { seed: number; share: number }[];
}

export interface SeasonSimSnapshot {
  teams: SimTeamInput[];
  config: {
    playoffTeams: number;
    regularSeasonWeeks: number;
    currentWeek: number;
    victoryPoints?: boolean;
    allPlayWeeks?: number[];
    byes?: number;
    divisions?: Record<string, string>;
  };
  schedule: ScheduleGame[];
}

export interface SeasonPayload {
  myTeamId: string;
  myTeamName: string;
  currentRecord: string;
  currentWins: number;
  /** Wins the last team in the bracket usually finishes on. */
  playoffCut: number | null;
  outcome: SeasonOutcome;
  history: SeasonWeekOdds[];
  remaining: SeasonGame[];
  /** Everything a what-if re-run needs, without rebuilding rosters. */
  sim: SeasonSimSnapshot;
}
