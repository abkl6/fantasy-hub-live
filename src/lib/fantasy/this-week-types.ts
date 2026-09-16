/** Client-safe shapes for the "This week" list. */

export type ThisWeekKind =
  | "claim"
  | "lineup"
  | "trade-offer"
  | "waiver-deadline"
  | "rising"
  | "upkeep";

export interface ThisWeekItem {
  id: string;
  kind: ThisWeekKind;
  /** Lower sorts first. */
  priority: number;
  leagueId: string;
  leagueName: string;
  leagueColor: string | null;
  title: string;
  detail: string;
  /** Short right-hand note, such as time remaining. */
  meta: string | null;
  /** Which league tab the row opens. */
  tab: "lineup" | "moves" | "league";
  swap: string | null;
  replacement: string | null;
  /** "+1.8% title" — the change this move makes, in the team's own terms. */
  impactLabel: string | null;
  /** Sort key; bigger is better for this team. */
  impactRank: number;
  /** One line naming the strategy rule that shaped this row. */
  ruleNote?: string | null;
}

export interface ThisWeekLeague {
  id: string;
  name: string;
  platform: string;
  color: string | null;
  teamName: string;
  record: string;
  week: number;
  items: ThisWeekItem[];
}

export interface ThisWeekPayload {
  generatedAt: string;
  kickoffAt: string;
  kickoffLabel: string;
  waiverRunAt: string;
  leagues: ThisWeekLeague[];
  items: ThisWeekItem[];
}

