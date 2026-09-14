import { optimalLineup, type EnginePlayer } from "./engine";

export interface ProbabilityPlayer extends EnginePlayer {
  livePoints: number;
  projectedFinal: number;
  gameState: "pre" | "in" | "post";
}

function erf(x: number) {
  const sign = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-a * a);
  return sign * y;
}

function normalCdf(x: number) {
  return 0.5 * (1 + erf(x / Math.sqrt(2)));
}

function remainingVariance(players: ProbabilityPlayer[]) {
  return players.reduce((sum, player) => {
    if (player.gameState === "post") return sum;
    const remaining = Math.max(0, player.projectedFinal - player.livePoints);
    const sd = Math.max(1, remaining * (player.volatility ?? 0.35));
    return sum + sd * sd;
  }, 0);
}

export function headToHeadWinProbability(mine: ProbabilityPlayer[], opponent: ProbabilityPlayer[]) {
  const myFinal = mine.reduce((sum, player) => sum + player.projectedFinal, 0);
  const oppFinal = opponent.reduce((sum, player) => sum + player.projectedFinal, 0);
  const sd = Math.sqrt(remainingVariance(mine) + remainingVariance(opponent));
  if (sd < 0.01) return myFinal === oppFinal ? 0.5 : myFinal > oppFinal ? 1 : 0;
  return Math.max(0.01, Math.min(0.99, normalCdf((myFinal - oppFinal) / sd)));
}

function mulberry32(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
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

export function bestBallWeekProbability(
  teams: { id: string; players: ProbabilityPlayer[] }[],
  myTeamId: string,
  slots: string[],
  iterations = 600,
) {
  const rand = mulberry32(29);
  let wins = 0;
  for (let run = 0; run < iterations; run++) {
    const scores = teams.map((team) => {
      const drawn = team.players.map((player) => {
        if (player.gameState === "post") return { ...player, proj: player.livePoints };
        const remaining = Math.max(0, player.projectedFinal - player.livePoints);
        const sd = Math.max(1, remaining * (player.volatility ?? 0.35));
        return { ...player, proj: Math.max(player.livePoints, player.livePoints + remaining + gaussian(rand) * sd) };
      });
      return { id: team.id, score: optimalLineup(drawn, slots).total };
    });
    const best = Math.max(...scores.map((team) => team.score));
    const leaders = scores.filter((team) => Math.abs(team.score - best) < 0.001);
    if (leaders.some((team) => team.id === myTeamId)) wins += 1 / leaders.length;
  }
  return wins / iterations;
}