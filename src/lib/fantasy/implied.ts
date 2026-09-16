/**
 * Vegas implied team totals. Pure math, no I/O.
 *
 * A team expected to score 29 this week will carry its fantasy players further
 * than the same team in a 17-point game. The adjustment is deliberately small:
 * no player's week moves more than 15% on the strength of a betting line.
 */

export const IMPLIED_MIN = 0.85;
export const IMPLIED_MAX = 1.15;

export interface ImpliedRow {
  week: number;
  nflTeam: string;
  implied: number;
}

export function clampImplied(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(IMPLIED_MIN, Math.min(IMPLIED_MAX, value));
}

export interface ImpliedBook {
  /** 1 when there is no line for that team and week. */
  multiplier(nflTeam: string | null | undefined, week: number): number;
  /** True when at least one line is known. */
  covered: boolean;
}

export const NEUTRAL_IMPLIED: ImpliedBook = { multiplier: () => 1, covered: false };

/**
 * Build a lookup of per-week multipliers: each team's line for the week
 * against that team's own season average line.
 */
export function buildImpliedBook(rows: ImpliedRow[]): ImpliedBook {
  const byTeam = new Map<string, ImpliedRow[]>();
  for (const row of rows) {
    if (!Number.isFinite(row.implied) || row.implied <= 0) continue;
    const team = row.nflTeam.toUpperCase();
    const list = byTeam.get(team) ?? [];
    list.push({ ...row, nflTeam: team });
    byTeam.set(team, list);
  }
  if (!byTeam.size) return NEUTRAL_IMPLIED;

  const multipliers = new Map<string, number>();
  for (const [team, list] of byTeam) {
    const average = list.reduce((sum, r) => sum + r.implied, 0) / list.length;
    if (!average) continue;
    for (const row of list) {
      multipliers.set(`${team}|${row.week}`, clampImplied(row.implied / average));
    }
  }

  return {
    covered: multipliers.size > 0,
    multiplier: (nflTeam, week) => {
      if (!nflTeam) return 1;
      return multipliers.get(`${nflTeam.toUpperCase()}|${week}`) ?? 1;
    },
  };
}

/** "Vegas has Miami at 27.5 this week (+8%)" style tooltip text. */
export function impliedTooltip(implied: number | null, multiplier: number): string | null {
  if (implied === null || !Number.isFinite(implied)) return null;
  const pct = Math.round((multiplier - 1) * 100);
  const sign = pct > 0 ? "+" : "";
  return `Vegas total ${Math.round(implied * 10) / 10} (${sign}${pct}%)`;
}
