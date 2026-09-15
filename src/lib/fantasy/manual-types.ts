/** Client-safe shapes for manually tracked leagues. */

export interface ManualPlayerRow {
  name: string;
  position: string;
  nflTeam: string | null;
  /** True when the name matched a player in the database. */
  matched: boolean;
}

export interface ManualDraftTeam {
  name: string;
  players: ManualPlayerRow[];
}

export interface ManualDraftPreview {
  teams: ManualDraftTeam[];
  total: number;
  unmatched: ManualPlayerRow[];
}

export interface ManualScheduleGame {
  week: number;
  home: string;
  away: string;
}

export interface ManualTransactionRow {
  occurredOn: string;
  kind: "add" | "drop" | "trade";
  playerName: string;
  position: string | null;
  fromTeam: string | null;
  toTeam: string | null;
  dedupeKey: string;
  raw: string;
}

export interface ManualReconcileDiff {
  teamId: string;
  teamName: string;
  added: ManualPlayerRow[];
  dropped: ManualPlayerRow[];
  unchanged: number;
}

export type ManualFreshnessState = "synced" | "tracking" | "stale";

export interface ManualFreshness {
  state: ManualFreshnessState;
  label: string;
  days: number | null;
}

/** How current a manual league's tracked rosters are. */
export function manualFreshness(
  lastConfirmedAt: string | null | undefined,
  now: Date = new Date(),
): ManualFreshness {
  if (!lastConfirmedAt) return { state: "stale", label: "Stale", days: null };
  const days = Math.floor((now.getTime() - new Date(lastConfirmedAt).getTime()) / 86_400_000);
  if (days <= 3) return { state: "synced", label: "Synced", days };
  if (days <= 10) return { state: "tracking", label: "Tracking", days };
  return { state: "stale", label: "Stale", days };
}
