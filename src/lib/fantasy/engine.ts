/**
 * Pure fantasy-football analysis engine.
 *
 * Everything here is deterministic-ish math with no I/O, so it can run inside
 * server functions and be unit tested. It powers:
 *  - optimal lineup / start-sit
 *  - team strength grades
 *  - season Monte Carlo (playoff + title odds)
 *  - win-impact of any hypothetical roster change
 */

export type Slot = string;

export interface EnginePlayer {
  id: string | null;
  name: string;
  position: string;
  nflTeam?: string | null;
  proj: number;
  volatility?: number;
}

export interface EngineTeam {
  id: string;
  name: string;
  isMine: boolean;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  roster: EnginePlayer[];
}

export interface LeagueConfig {
  teamCount: number;
  playoffTeams: number;
  regularSeasonWeeks: number;
  currentWeek: number;
  rosterSlots: Slot[];
}

export const FLEX_ELIGIBLE: Record<string, string[]> = {
  FLEX: ["RB", "WR", "TE"],
  WRRB_FLEX: ["RB", "WR"],
  REC_FLEX: ["WR", "TE"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
  SUPERFLEX: ["QB", "RB", "WR", "TE"],
  OP: ["QB", "RB", "WR", "TE"],
};

export function slotAccepts(slot: Slot, position: string): boolean {
  const s = slot.toUpperCase();
  const p = position.toUpperCase();
  if (s === p) return true;
  if (s === "DST" && p === "DEF") return true;
  if (s === "DEF" && p === "DST") return true;
  if (s === "PK" && p === "K") return true;
  const flex = FLEX_ELIGIBLE[s];
  return flex ? flex.includes(p) : false;
}

export interface LineupResult {
  starters: { slot: Slot; player: EnginePlayer | null }[];
  bench: EnginePlayer[];
  total: number;
}

/** Greedy-by-scarcity optimal lineup: fill the most restrictive slots first. */
export function optimalLineup(roster: EnginePlayer[], slots: Slot[]): LineupResult {
  const pool = [...roster].sort((a, b) => b.proj - a.proj);
  const used = new Set<number>();
  const order = slots
    .map((slot, i) => ({
      slot,
      i,
      breadth: pool.filter((p) => slotAccepts(slot, p.position)).length,
    }))
    .sort((a, b) => a.breadth - b.breadth);

  const filled: (EnginePlayer | null)[] = slots.map(() => null);
  for (const { slot, i } of order) {
    const idx = pool.findIndex((p, pi) => !used.has(pi) && slotAccepts(slot, p.position));
    if (idx >= 0) {
      used.add(idx);
      filled[i] = pool[idx]!;
    }
  }

  const starters = slots.map((slot, i) => ({ slot, player: filled[i] ?? null }));
  const bench = pool.filter((_, pi) => !used.has(pi));
  const total = starters.reduce((sum, s) => sum + (s.player?.proj ?? 0), 0);
  return { starters, bench, total };
}

/** Weekly scoring distribution for a team, derived from its optimal lineup. */
export function teamDistribution(roster: EnginePlayer[], slots: Slot[]) {
  const { starters, total } = optimalLineup(roster, slots);
  const variance = starters.reduce((sum, s) => {
    if (!s.player) return sum + 25;
    const sd = s.player.proj * (s.player.volatility ?? 0.35);
    return sum + sd * sd;
  }, 0);
  return { mean: total, sd: Math.max(Math.sqrt(variance), 8) };
}

// --- random helpers -------------------------------------------------------

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// --- season simulation ----------------------------------------------------

export interface SimTeamInput {
  id: string;
  name: string;
  isMine: boolean;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  mean: number;
  sd: number;
}

export interface SimTeamResult {
  id: string;
  name: string;
  isMine: boolean;
  playoffOdds: number;
  titleOdds: number;
  projWins: number;
  projLosses: number;
  projPointsPerWeek: number;
  powerRank: number;
}

export interface ScheduleGame {
  week: number;
  homeTeamId: string;
  awayTeamId: string;
}

export function simulateSeason(
  teams: SimTeamInput[],
  config: { playoffTeams: number; regularSeasonWeeks: number; currentWeek: number },
  schedule: ScheduleGame[] = [],
  iterations = 2000,
  seed = 12345,
): SimTeamResult[] {
  const n = teams.length;
  if (n < 2) {
    return teams.map((t, i) => ({
      id: t.id,
      name: t.name,
      isMine: t.isMine,
      playoffOdds: 1,
      titleOdds: 1,
      projWins: t.wins,
      projLosses: t.losses,
      projPointsPerWeek: t.mean,
      powerRank: i + 1,
    }));
  }

  const rand = mulberry32(seed);
  const index = new Map(teams.map((t, i) => [t.id, i]));
  const weeksLeft = Math.max(0, config.regularSeasonWeeks - (config.currentWeek - 1));
  const playoffTeams = Math.min(
    Math.max(2, config.playoffTeams),
    2 ** Math.floor(Math.log2(Math.max(2, Math.min(n, config.playoffTeams)))) * 2,
  );
  const bracketSize = Math.min(n, Math.max(2, playoffTeams));

  const madePlayoffs = new Array(n).fill(0);
  const wonTitle = new Array(n).fill(0);
  const totalWins = new Array(n).fill(0);

  const byWeek = new Map<number, ScheduleGame[]>();
  for (const g of schedule) {
    if (g.week < config.currentWeek) continue;
    const list = byWeek.get(g.week) ?? [];
    list.push(g);
    byWeek.set(g.week, list);
  }

  const draw = (i: number) => Math.max(0, teams[i]!.mean + gaussian(rand) * teams[i]!.sd);

  for (let it = 0; it < iterations; it++) {
    const wins = teams.map((t) => t.wins + t.ties * 0.5);
    const points = teams.map((t) => t.pointsFor);

    for (let w = 0; w < weeksLeft; w++) {
      const week = config.currentWeek + w;
      const scores = teams.map((_, i) => draw(i));
      for (let i = 0; i < n; i++) points[i] = (points[i] ?? 0) + (scores[i] ?? 0);

      const games = byWeek.get(week);
      if (games && games.length) {
        for (const g of games) {
          const a = index.get(g.homeTeamId);
          const b = index.get(g.awayTeamId);
          if (a === undefined || b === undefined) continue;
          if ((scores[a] ?? 0) >= (scores[b] ?? 0)) wins[a] = (wins[a] ?? 0) + 1;
          else wins[b] = (wins[b] ?? 0) + 1;
        }
      } else {
        // No stored schedule: random pairings keep the win distribution honest.
        const order = teams.map((_, i) => i);
        for (let i = order.length - 1; i > 0; i--) {
          const j = Math.floor(rand() * (i + 1));
          [order[i], order[j]] = [order[j]!, order[i]!];
        }
        for (let i = 0; i + 1 < order.length; i += 2) {
          const a = order[i]!;
          const b = order[i + 1]!;
          if ((scores[a] ?? 0) >= (scores[b] ?? 0)) wins[a] = (wins[a] ?? 0) + 1;
          else wins[b] = (wins[b] ?? 0) + 1;
        }
      }
    }

    for (let i = 0; i < n; i++) totalWins[i] += wins[i];

    const seeds = teams
      .map((_, i) => i)
      .sort((a, b) => (wins[b] ?? 0) - (wins[a] ?? 0) || (points[b] ?? 0) - (points[a] ?? 0))
      .slice(0, bracketSize);
    for (const i of seeds) madePlayoffs[i] += 1;

    let field = [...seeds];
    while (field.length > 1) {
      const next: number[] = [];
      const half = Math.floor(field.length / 2);
      for (let i = 0; i < half; i++) {
        const a = field[i]!;
        const b = field[field.length - 1 - i]!;
        next.push(draw(a) >= draw(b) ? a : b);
      }
      if (field.length % 2 === 1) next.push(field[half]!);
      field = next;
    }
    if (field.length === 1) wonTitle[field[0]!] += 1;
  }

  const results = teams.map((t, i) => ({
    id: t.id,
    name: t.name,
    isMine: t.isMine,
    playoffOdds: madePlayoffs[i] / iterations,
    titleOdds: wonTitle[i] / iterations,
    projWins: Math.round(((totalWins[i] ?? 0) / iterations) * 10) / 10,
    projLosses:
      Math.round(
        (t.wins + t.losses + t.ties + weeksLeft - (totalWins[i] ?? 0) / iterations) * 10,
      ) / 10,
    projPointsPerWeek: Math.round(t.mean * 10) / 10,
    powerRank: 0,
  }));

  [...results]
    .sort((a, b) => b.projPointsPerWeek - a.projPointsPerWeek)
    .forEach((r, i) => {
      r.powerRank = i + 1;
    });

  return results;
}

// --- grades ---------------------------------------------------------------

export const GRADE_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"];

export interface PositionGrade {
  position: string;
  myPoints: number;
  leagueAverage: number;
  grade: string;
  verdict: "strength" | "solid" | "weakness";
}

function letterGrade(ratio: number): string {
  if (ratio >= 1.3) return "A+";
  if (ratio >= 1.18) return "A";
  if (ratio >= 1.08) return "B+";
  if (ratio >= 1.0) return "B";
  if (ratio >= 0.93) return "C+";
  if (ratio >= 0.85) return "C";
  if (ratio >= 0.75) return "D";
  return "F";
}

export function positionGrades(
  myTeam: EngineTeam,
  allTeams: EngineTeam[],
  slots: Slot[],
): PositionGrade[] {
  const startersNeeded = (pos: string) =>
    Math.max(
      1,
      slots.filter((s) => s.toUpperCase() === pos || s.toUpperCase() === (pos === "DEF" ? "DST" : pos))
        .length,
    );

  const topN = (team: EngineTeam, pos: string, count: number) =>
    team.roster
      .filter((p) => p.position.toUpperCase() === pos || (pos === "DEF" && p.position.toUpperCase() === "DST"))
      .sort((a, b) => b.proj - a.proj)
      .slice(0, count)
      .reduce((s, p) => s + p.proj, 0);

  const others = allTeams.filter((t) => t.id !== myTeam.id && t.roster.length > 0);

  return GRADE_POSITIONS.map((pos) => {
    const count = startersNeeded(pos);
    const mine = topN(myTeam, pos, count);
    const avg = others.length
      ? others.reduce((s, t) => s + topN(t, pos, count), 0) / others.length
      : mine || 1;
    const ratio = avg > 0 ? mine / avg : 1;
    return {
      position: pos,
      myPoints: Math.round(mine * 10) / 10,
      leagueAverage: Math.round(avg * 10) / 10,
      grade: letterGrade(ratio),
      verdict: ratio >= 1.08 ? "strength" : ratio >= 0.93 ? "solid" : "weakness",
    } as PositionGrade;
  });
}
