/**
 * Filling empty starting spots, kept apart from the waiver wire.
 *
 * A kicker or a defence is never a "waiver target" — it is a hole in the
 * lineup that gets plugged with whoever has the kindest matchup this week, at
 * the minimum bid. Everything here reads the league's slot definition, never
 * the roster's current contents, so a position the league does not start can
 * never appear anywhere.
 *
 * Pure functions only: no database, no engine simulation.
 */

import { slotAccepts, type Slot } from "./engine";
import { MIN_BID } from "./rules";

/** Positions that are streamed by matchup rather than shopped for. */
export const STREAM_POSITIONS = new Set(["K", "PK", "DEF", "DST"]);

/** True when this position belongs in the fill strip, not the main list. */
export function isStreamedPosition(position: string): boolean {
  return STREAM_POSITIONS.has(position.trim().toUpperCase());
}

/** Slots that hold anyone and so never count as a starting spot. */
const OPEN_SLOTS = new Set(["BN", "BE", "BENCH", "IR", "TAXI", "TX", "RES", "NA"]);

/** How far from the top or the bottom a matchup has to be to stream. */
export const STREAM_EDGE = 8;

export interface EmptySlot {
  /** The slot as the league spells it, e.g. "K" or "FLEX". */
  slot: string;
  /** The position we would shop for to fill it. */
  position: string;
}

/**
 * Which starting spots have nobody who can fill them.
 *
 * Players are assigned to the tightest slots first so a flex body is never
 * counted against a dedicated slot it could have filled.
 */
export function emptySlots(slots: string[], rosterPositions: string[]): EmptySlot[] {
  const starting = slots
    .map((s) => String(s).trim().toUpperCase())
    .filter((s) => s && !OPEN_SLOTS.has(s));
  const pool = rosterPositions.map((p) => String(p).trim().toUpperCase()).filter(Boolean);
  const used = new Array(pool.length).fill(false);

  // Narrow slots claim their players before flexes do.
  const width = (slot: string) => pool.filter((p) => slotAccepts(slot as Slot, p)).length;
  const order = starting
    .map((slot, index) => ({ slot, index, width: width(slot) }))
    .sort((a, b) => a.width - b.width || a.index - b.index);

  const empty: EmptySlot[] = [];
  for (const entry of order) {
    const found = pool.findIndex((p, i) => !used[i] && slotAccepts(entry.slot as Slot, p));
    if (found >= 0) {
      used[found] = true;
      continue;
    }
    empty.push({ slot: entry.slot, position: fillPosition(entry.slot) });
  }
  return empty.sort(
    (a, b) => starting.indexOf(a.slot) - starting.indexOf(b.slot),
  );
}

/** What to shop for when a slot is empty: a flex shops for its best body. */
function fillPosition(slot: string): string {
  const s = slot.toUpperCase();
  if (s === "DST") return "DEF";
  if (s === "PK") return "K";
  return s;
}

// --- matchups ---------------------------------------------------------------

export interface MatchupFacts {
  /** This player's NFL team. */
  nflTeam: string | null;
  /** Who they play this week. */
  opponent: string | null;
  /** Vegas total for this player's own team. */
  impliedOwn: number | null;
  /** Vegas total for the opponent. */
  impliedOpponent: number | null;
  /** Fantasy points the opponent has been giving up. Higher is kinder. */
  opponentPointsAllowed: number | null;
}

/**
 * How friendly this week's matchup is, 0 (brutal) to 1 (a gift).
 *
 * A kicker wants his own team moving the ball; a defence wants an opponent who
 * cannot. Both want an opponent who has been generous.
 */
export function matchupScore(position: string, facts: MatchupFacts): number {
  const pos = position.toUpperCase();
  const norm = (value: number | null, low: number, high: number) => {
    if (value === null || !Number.isFinite(value)) return 0.5;
    return Math.max(0, Math.min(1, (value - low) / (high - low)));
  };

  const generosity = norm(facts.opponentPointsAllowed, 5, 25);
  if (pos === "DEF" || pos === "DST") {
    // Fewer expected opponent points is the whole game for a defence.
    return 0.65 * (1 - norm(facts.impliedOpponent, 14, 30)) + 0.35 * generosity;
  }
  return 0.6 * norm(facts.impliedOwn, 14, 30) + 0.4 * generosity;
}

/** 1 -> "1st", 3 -> "3rd". */
export function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** "vs. CAR, 3rd-easiest matchup" */
export function matchupReason(opponent: string | null, rank: number | null): string {
  if (!opponent) return "Best available for this week";
  if (!rank) return `vs. ${opponent}`;
  return `vs. ${opponent}, ${ordinal(rank)}-easiest matchup`;
}

// --- candidates and fills ---------------------------------------------------

export interface FillCandidate extends MatchupFacts {
  id: string;
  name: string;
  position: string;
  status: string;
  projWeek: number;
  projSeason: number;
  /** Rest-of-season points over the next-best free agent at the position. */
  vor: number;
  /** Normal bid model output, used for everything except K and DEF. */
  bid: number;
  /** One line from the strategy rules, if any applied. */
  ruleNote?: string | null;
}

export interface SlotFill {
  slot: string;
  position: string;
  playerId: string;
  name: string;
  nflTeam: string | null;
  /** Dollars. Always the league minimum for kickers and defences. */
  bid: number;
  /** True when the bid is the league minimum by rule, not by budget. */
  minimumBid: boolean;
  reason: string;
  projWeek: number;
  /** Points this adds to the best starting lineup this week. */
  pointsGain: number;
  /** Guillotine leagues only: change in this week's survival odds. */
  survivalDelta: number | null;
  ruleNote: string | null;
}

export interface StreamSuggestion {
  position: string;
  /** Who is in the lineup now. */
  outName: string;
  inPlayerId: string;
  inName: string;
  bid: number;
  reason: string;
  projWeek: number;
  pointsGain: number;
}

/** Sort candidates for a streamed position and hand each one its ordinal. */
export function rankByMatchup(candidates: FillCandidate[]): {
  candidate: FillCandidate;
  score: number;
  rank: number;
}[] {
  return candidates
    .map((candidate) => ({ candidate, score: matchupScore(candidate.position, candidate), rank: 0 }))
    .sort((a, b) => b.score - a.score || b.candidate.projWeek - a.candidate.projWeek)
    .map((row, i) => ({ ...row, rank: i + 1 }));
}

export interface BuildFillsInput {
  /** The league's starting slot definition. */
  slots: string[];
  /** Positions currently on my roster. */
  rosterPositions: string[];
  /** Every free agent the league can actually field. */
  candidates: FillCandidate[];
  /** Points and survival added by taking a specific player. */
  score?: (candidate: FillCandidate) => { pointsGain: number; survivalDelta: number | null };
}

/**
 * One recommendation per empty starting spot: matchup-driven at the minimum
 * bid for kickers and defences, value over replacement for everyone else.
 */
export function buildFills(input: BuildFillsInput): SlotFill[] {
  const holes = emptySlots(input.slots, input.rosterPositions);
  if (!holes.length) return [];

  const fills: SlotFill[] = [];
  const taken = new Set<string>();

  for (const hole of holes) {
    const pool = input.candidates.filter(
      (c) => !taken.has(c.id) && slotAccepts(hole.slot as Slot, c.position.toUpperCase()),
    );
    if (!pool.length) continue;

    const streamed = isStreamedPosition(hole.position);
    let pick: FillCandidate;
    let reason: string;
    let bid: number;

    if (streamed) {
      const ranked = rankByMatchup(pool.filter((c) => isStreamedPosition(c.position)));
      if (!ranked.length) continue;
      pick = ranked[0]!.candidate;
      reason = matchupReason(pick.opponent, ranked[0]!.rank);
      bid = MIN_BID;
    } else {
      pick = [...pool].sort((a, b) => b.vor - a.vor || b.projSeason - a.projSeason)[0]!;
      reason = `Best ${hole.position} available — ${pick.vor.toFixed(1)} pts over the next one up`;
      bid = Math.max(MIN_BID, Math.round(pick.bid));
    }

    const scored = input.score?.(pick) ?? { pointsGain: 0, survivalDelta: null };
    taken.add(pick.id);
    fills.push({
      slot: hole.slot,
      position: hole.position,
      playerId: pick.id,
      name: pick.name,
      nflTeam: pick.nflTeam,
      bid,
      minimumBid: streamed,
      reason,
      projWeek: Math.round(pick.projWeek * 10) / 10,
      pointsGain: Math.round(scored.pointsGain * 10) / 10,
      survivalDelta: scored.survivalDelta,
      ruleNote: streamed ? null : (pick.ruleNote ?? null),
    });
  }

  return fills;
}

export interface CurrentStreamer {
  name: string;
  position: string;
  projWeek: number;
  facts: MatchupFacts;
}

export interface BuildStreamInput {
  slots: string[];
  /** My current kicker and defence, if I have them. */
  current: CurrentStreamer[];
  candidates: FillCandidate[];
  /** How many NFL teams are ranked, for the top-8 / bottom-8 test. */
  teamCount?: number;
  score?: (candidate: FillCandidate) => { pointsGain: number; survivalDelta: number | null };
}

/**
 * A swap worth making: my starter has one of the worst matchups this week and
 * someone with one of the best is sitting free.
 */
export function buildStream(input: BuildStreamInput): StreamSuggestion | null {
  const startable = new Set(
    input.slots
      .map((s) => String(s).trim().toUpperCase())
      .filter((s) => s && !OPEN_SLOTS.has(s)),
  );
  const teamCount = input.teamCount ?? 32;

  let best: StreamSuggestion | null = null;
  let bestGap = 0;

  for (const holder of input.current) {
    const pos = holder.position.toUpperCase();
    if (!isStreamedPosition(pos)) continue;
    // Never suggest a position the league has no slot for.
    if (![...startable].some((slot) => slotAccepts(slot as Slot, pos))) continue;

    const pool = input.candidates.filter(
      (c) => isStreamedPosition(c.position) && slotAccepts(pos as Slot, c.position.toUpperCase()),
    );
    if (!pool.length) continue;

    // Rank my man against the free agents on the same scale.
    const mineScore = matchupScore(pos, holder.facts);
    const scores = [...pool.map((c) => matchupScore(c.position, c)), mineScore].sort((a, b) => b - a);
    const myRank = scores.indexOf(mineScore) + 1;
    const bottomStart = Math.max(1, teamCount - STREAM_EDGE + 1);
    const myLeagueRank = Math.round((myRank / scores.length) * teamCount);
    if (myLeagueRank < bottomStart) continue;

    const ranked = rankByMatchup(pool);
    const top = ranked[0];
    if (!top) continue;
    const theirLeagueRank = Math.round((top.rank / scores.length) * teamCount);
    if (theirLeagueRank > STREAM_EDGE) continue;
    if (top.score <= mineScore) continue;

    const gap = top.score - mineScore;
    if (gap <= bestGap) continue;
    const scored = input.score?.(top.candidate) ?? { pointsGain: 0, survivalDelta: null };
    bestGap = gap;
    best = {
      position: pos === "PK" ? "K" : pos === "DST" ? "DEF" : pos,
      outName: holder.name,
      inPlayerId: top.candidate.id,
      inName: top.candidate.name,
      bid: MIN_BID,
      reason: `${holder.name} ${matchupReason(holder.facts.opponent, null)} — ${top.candidate.name} ${matchupReason(top.candidate.opponent, top.rank)}`,
      projWeek: Math.round(top.candidate.projWeek * 10) / 10,
      pointsGain: Math.round(scored.pointsGain * 10) / 10,
    };
  }

  return best;
}
