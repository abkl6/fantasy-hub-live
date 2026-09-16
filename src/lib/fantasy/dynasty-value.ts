/**
 * Dynasty Future Value: everything a team owns — every rostered player plus
 * every future draft pick — priced on the Keep Trade Cut market.
 */

import type { TradeAsset, TradeValueBook } from "./trade-value";

export interface DynastyAsset {
  label: string;
  value: number;
  kind: "player" | "pick";
}

export interface TeamDynastyValue {
  teamId: string;
  teamName: string;
  isMine: boolean;
  playerValue: number;
  pickValue: number;
  total: number;
  /** 1 = highest total in the league. */
  rank: number;
  /** Total minus the league average. */
  vsAverage: number;
  /** Players we hold no age for — nearly always a failed name match. */
  unknownAgeCount: number;
  top: DynastyAsset[];
}

export interface DynastyTeamInput {
  id: string;
  name: string;
  isMine: boolean;
  players: {
    id: string | null;
    name: string;
    position: string;
    projSeason: number;
    /** False when neither the market nor our own record knows the age. */
    ageKnown?: boolean;
  }[];
  picks: TradeAsset[];
}

export function teamDynastyTotals(team: DynastyTeamInput, book: TradeValueBook) {
  const players: DynastyAsset[] = team.players.map((p) => ({
    kind: "player" as const,
    label: `${p.name} (${p.position})`,
    value: book.player(p.id, p.name, p.position, p.projSeason),
  }));
  const picks: DynastyAsset[] = team.picks
    .filter((a): a is Extract<TradeAsset, { kind: "pick" }> => a.kind === "pick")
    .map((a) => ({ kind: "pick" as const, label: a.label, value: a.value }));

  const playerValue = Math.round(players.reduce((s, a) => s + a.value, 0));
  const pickValue = Math.round(picks.reduce((s, a) => s + a.value, 0));
  const unknownAgeCount = team.players.filter((p) => p.ageKnown === false).length;
  const top = [...players, ...picks].sort((a, b) => b.value - a.value).slice(0, 5);
  return { playerValue, pickValue, total: playerValue + pickValue, unknownAgeCount, top };
}

export function leagueDynastyValues(
  teams: DynastyTeamInput[],
  book: TradeValueBook,
): TeamDynastyValue[] {
  const rows = teams.map((t) => {
    const totals = teamDynastyTotals(t, book);
    return { teamId: t.id, teamName: t.name, isMine: t.isMine, ...totals, rank: 0, vsAverage: 0 };
  });
  const average = rows.length ? rows.reduce((s, r) => s + r.total, 0) / rows.length : 0;
  rows.sort((a, b) => b.total - a.total);
  rows.forEach((r, i) => {
    r.rank = i + 1;
    r.vsAverage = Math.round(r.total - average);
  });
  return rows;
}
