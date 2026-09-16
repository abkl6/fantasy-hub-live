/** Client-safe shapes for the lineup check screen. */

export type LineupState = "green" | "yellow" | "red";

export interface LineupIssue {
  id: string;
  severity: Exclude<LineupState, "green">;
  /** "out" | "bye" | "questionable" | "upgrade" */
  kind: "out" | "bye" | "questionable" | "upgrade";
  starter: string;
  starterPosition: string;
  slot: string;
  problem: string;
  /** Suggested replacement from the bench, when one fits the slot. */
  replacement: string | null;
  replacementPosition: string | null;
  /** Projected points gained by making the swap. */
  gain: number | null;
  /** "+1.8% title" — what the swap is worth to this team. */
  impactLabel: string | null;
  impactRank: number;
  /** One line naming the strategy rule that shaped this row. */
  ruleNote?: string | null;
}

export interface LineupCheckLeague {
  id: string;
  name: string;
  platform: string;
  color: string | null;
  teamName: string;
  week: number;
  state: LineupState;
  summary: string;
  issues: LineupIssue[];
  /** My chance of winning this week's matchup, 0-1. */
  winProbability: number | null;
  /** "You're favored — playing it safe with Burden." */
  startSitLine: string | null;
  /** Where to make the change, since this app is read-only. */
  externalUrl: string | null;
  externalLabel: string | null;
}

export interface LineupCheckPayload {
  generatedAt: string;
  leagues: LineupCheckLeague[];
}
