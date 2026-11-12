/**
 * Week-by-week title and playoff chances, shaped for the odds charts on the
 * league page, the Season tab and the Hub.
 */

export type OddsPoint = { week: number; titleOdds: number; playoffOdds: number };

export type SnapshotRow = {
  league_id: string;
  week: number;
  title_odds: number | string | null;
  playoff_odds: number | string | null;
};

export type OddsLeague = {
  id: string;
  name: string;
  abbrev: string | null;
  color: string | null;
  variant: string | null;
};

export type LeagueOddsSeries = {
  leagueId: string;
  name: string;
  abbrev: string | null;
  color: string | null;
  /** Guillotine leagues have no playoffs, so only their title line is drawn. */
  guillotine: boolean;
  points: OddsPoint[];
};

const clamp = (n: unknown) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
};

/** One point per week, earliest week first. The first row seen for a week wins. */
export function toOddsPoints(rows: { week: number; title_odds: unknown; playoff_odds: unknown }[]): OddsPoint[] {
  const byWeek = new Map<number, OddsPoint>();
  for (const r of rows) {
    if (!Number.isFinite(r.week) || byWeek.has(r.week)) continue;
    byWeek.set(r.week, { week: r.week, titleOdds: clamp(r.title_odds), playoffOdds: clamp(r.playoff_odds) });
  }
  return [...byWeek.values()].sort((a, b) => a.week - b.week);
}

/** Replace (or add) this week's point with the figures just calculated. */
export function withCurrentWeek(points: OddsPoint[], current: OddsPoint | null): OddsPoint[] {
  if (!current) return points;
  const rest = points.filter((p) => p.week !== current.week);
  return [...rest, { week: current.week, titleOdds: clamp(current.titleOdds), playoffOdds: clamp(current.playoffOdds) }].sort(
    (a, b) => a.week - b.week,
  );
}

/** Your team's chances in every league, one series per league that has any recorded week. */
export function oddsSeriesByLeague(leagues: OddsLeague[], rows: SnapshotRow[]): LeagueOddsSeries[] {
  const rowsByLeague = new Map<string, SnapshotRow[]>();
  for (const r of rows) {
    const list = rowsByLeague.get(r.league_id) ?? [];
    list.push(r);
    rowsByLeague.set(r.league_id, list);
  }
  return leagues
    .map((l) => ({
      leagueId: l.id,
      name: l.name,
      abbrev: l.abbrev,
      color: l.color,
      guillotine: l.variant === "guillotine",
      points: toOddsPoints(rowsByLeague.get(l.id) ?? []),
    }))
    .filter((s) => s.points.length > 0);
}
