/**
 * The strategy layer. A small book of explicit rules — streaming kickers,
 * value over replacement, proof before a pickup, handcuffs, playoff-week
 * weighting, class tiebreaks, a budget reserve and drop protection — that
 * every recommendation surface reads from. Pure functions only, so each rule
 * can be tested on its own and the same answer is produced on the server and
 * in the browser.
 */

export type RuleKey =
  | "stream-k-def"
  | "value-over-replacement"
  | "waiver-proof"
  | "handcuff-top-rb"
  | "playoff-schedule"
  | "class-tiebreak"
  | "faab-reserve"
  | "protect-top-wire";

export interface StrategyRule {
  key: RuleKey | string;
  category: string;
  rule: string;
  rationale: string;
  weight: number;
  enabled: boolean;
}

/** Mirrors the seeded rows, and stands in whenever the table cannot be read. */
export const DEFAULT_RULES: StrategyRule[] = [
  {
    key: "stream-k-def",
    category: "Roster construction",
    rule: "Stream kickers and defences: never bid above the minimum, never trade for one, never roster two.",
    rationale:
      "Week-to-week kicker and defence scoring is close to random, so paying for one costs you a real roster spot.",
    weight: 1,
    enabled: true,
  },
  {
    key: "value-over-replacement",
    category: "Ranking",
    rule: "Rank every player by their projection minus the best available free agent at the same position in this league, recomputed on every sync.",
    rationale:
      "Nine points from a defence you could replace with an eight-point defence is worth one point; eight from a receiver you could only replace with six is worth two.",
    weight: 1,
    enabled: true,
  },
  {
    key: "waiver-proof",
    category: "Waivers",
    rule: "A waiver pickup only outranks a steady bench player after two strong weeks or a documented role change.",
    rationale:
      "One big game is usually noise. Two weeks, or a stated change in role, is the first point where the new player is genuinely the better bet.",
    weight: 1,
    enabled: true,
  },
  {
    key: "handcuff-top-rb",
    category: "Roster construction",
    rule: "Handcuff your top two running backs before adding bye-week fillers.",
    rationale:
      "A lead back going down costs far more than one empty week, and his backup is the only player who recovers that value.",
    weight: 1,
    enabled: true,
  },
  {
    key: "playoff-schedule",
    category: "Timing",
    rule: "For contenders in the last four regular-season weeks, count the weeks 15 to 17 schedule double.",
    rationale:
      "By then the only games that decide your season are the playoff weeks, so a player with an easy weeks 15 to 17 run is worth more than his season average.",
    weight: 2,
    enabled: true,
  },
  {
    key: "class-tiebreak",
    category: "Team class",
    rule: "When two ideas are level, team class breaks the tie: contenders take the one that helps now, rebuilders take age and picks.",
    rationale: "The same move is right for one team and wrong for another; the standings decide which.",
    weight: 1,
    enabled: true,
  },
  {
    key: "faab-reserve",
    category: "Waivers",
    rule: "Keep a waiver budget reserve — never spend down to nothing before the season is over.",
    rationale:
      "Injuries arrive late as well as early, and a manager with nothing left to bid cannot answer them.",
    weight: 1,
    enabled: true,
  },
  {
    key: "protect-top-wire",
    category: "Waivers",
    rule: "Never recommend dropping a player who would rank in the top five on the wire.",
    rationale:
      "If he would be the best add available the moment you cut him, he is worth more on your bench than the player you were chasing.",
    weight: 1,
    enabled: true,
  },
];

export interface RuleBook {
  rules: StrategyRule[];
  on(key: RuleKey): boolean;
  weight(key: RuleKey): number;
  /** The one-line reason shown whenever a rule changed or suppressed advice. */
  why(key: RuleKey): string;
}

/** Builds a rule book from stored rows, filling any gaps from the defaults. */
export function ruleBook(rows: StrategyRule[] | null | undefined): RuleBook {
  const merged = new Map<string, StrategyRule>();
  for (const r of DEFAULT_RULES) merged.set(r.key, r);
  for (const r of rows ?? []) merged.set(r.key, { ...merged.get(r.key), ...r });
  const rules = [...merged.values()];
  const find = (key: RuleKey) => merged.get(key);
  return {
    rules,
    on: (key) => find(key)?.enabled ?? false,
    weight: (key) => {
      const r = find(key);
      return r && r.enabled ? Number(r.weight) || 1 : 1;
    },
    why: (key) => find(key)?.rationale ?? "",
  };
}

// --- positions -------------------------------------------------------------

const STREAM_POSITIONS = new Set(["K", "PK", "DEF", "DST", "D/ST"]);

/** Kickers and defences: rented weekly, never bought. */
export function isStreamPosition(position: string): boolean {
  return STREAM_POSITIONS.has(String(position ?? "").trim().toUpperCase());
}

// --- value over replacement -------------------------------------------------

/**
 * The best free agent at the same position who is not this player. A player at
 * the top of his position is measured against the next name down, so being the
 * only good option at a thin position is worth something, and being the ninth
 * interchangeable defence is worth almost nothing.
 */
export function replacementLevels(
  pool: { id: string; position: string; proj: number }[],
): Map<string, { best: number; next: number }> {
  const byPos = new Map<string, number[]>();
  for (const p of pool) {
    const pos = p.position.toUpperCase();
    const list = byPos.get(pos) ?? [];
    list.push(p.proj);
    byPos.set(pos, list);
  }
  const out = new Map<string, { best: number; next: number }>();
  for (const [pos, list] of byPos) {
    const sorted = list.sort((a, b) => b - a);
    out.set(pos, { best: sorted[0] ?? 0, next: sorted[1] ?? sorted[0] ?? 0 });
  }
  return out;
}

/** Projection minus the best available replacement at that position. */
export function valueOverReplacement(
  proj: number,
  position: string,
  levels: Map<string, { best: number; next: number }>,
): number {
  const level = levels.get(position.toUpperCase());
  if (!level) return proj;
  // Measuring the best player at a position against himself would always give
  // zero, so he is measured against the next man up instead.
  const bar = proj >= level.best - 1e-9 ? level.next : level.best;
  return Math.round((proj - bar) * 100) / 100;
}

// --- bids -------------------------------------------------------------------

export interface BidRuleInput {
  position: string;
  /** The bid the pricing model came up with. */
  bid: number;
  budget: number;
  /** What is left of my budget, when the league tracks it. */
  remaining: number | null;
  /** Regular-season weeks still to play. */
  weeksLeft: number;
}

export interface BidRuleResult {
  bid: number;
  /** The rule that moved the number, if any. */
  note: string | null;
}

/** The smallest bid a league will accept. */
export const MIN_BID = 1;

/**
 * The reserve grows with the season left to play: a dollar a week plus a tenth
 * of the budget, so there is always something to answer an injury with.
 */
export function faabReserve(budget: number, weeksLeft: number): number {
  return Math.min(budget, Math.round(budget * 0.1) + Math.max(0, weeksLeft));
}

/** Applies the streaming cap and the budget reserve to a suggested bid. */
export function applyBidRules(book: RuleBook, input: BidRuleInput): BidRuleResult {
  let bid = Math.max(0, Math.round(input.bid));
  let note: string | null = null;

  if (book.on("stream-k-def") && isStreamPosition(input.position) && bid > MIN_BID) {
    bid = MIN_BID;
    note = book.why("stream-k-def");
  }

  if (book.on("faab-reserve")) {
    const pot = input.remaining ?? input.budget;
    const reserve = faabReserve(input.budget, input.weeksLeft);
    const spendable = Math.max(MIN_BID, pot - reserve);
    if (bid > spendable) {
      bid = Math.round(spendable);
      note = book.why("faab-reserve");
    }
  }

  return { bid, note };
}

// --- pickups ----------------------------------------------------------------

export interface ProofInput {
  /** Weeks this season where he scored like a starter. */
  strongWeeks: number;
  /** His role changed and we can point at the news that says so. */
  roleChange: boolean;
  /** Season projection of the bench player he would displace. */
  benchProj: number;
  /** His own season projection. */
  proj: number;
}

export const PROOF_WEEKS = 2;

/**
 * True when a hot waiver name may be ranked above a steady bench player. Below
 * that bar the pickup still shows, it just cannot jump the queue.
 */
export function hasProof(input: ProofInput): boolean {
  if (input.roleChange) return true;
  if (input.strongWeeks >= PROOF_WEEKS) return true;
  // He is simply better on the projection, which needs no anecdote.
  return input.proj > input.benchProj * 1.15;
}

/** Same-team backup to one of my two best running backs. */
export function isHandcuff(
  candidate: { position: string; nflTeam: string | null },
  myBacks: { position: string; nflTeam: string | null; proj: number }[],
): boolean {
  if (candidate.position.toUpperCase() !== "RB" || !candidate.nflTeam) return false;
  const topTwo = myBacks
    .filter((p) => p.position.toUpperCase() === "RB")
    .sort((a, b) => b.proj - a.proj)
    .slice(0, 2);
  return topTwo.some((p) => p.nflTeam && p.nflTeam === candidate.nflTeam);
}

// --- timing -----------------------------------------------------------------

export const PLAYOFF_WEEKS = [15, 16, 17];
export const PLAYOFF_PUSH_WEEKS = 4;

/**
 * How heavily the weeks 15 to 17 schedule counts right now. Doubles for a
 * contender inside the last four regular-season weeks; neutral otherwise.
 */
export function playoffScheduleWeight(
  book: RuleBook,
  args: { currentWeek: number; regularSeasonWeeks: number; contender: boolean },
): number {
  if (!book.on("playoff-schedule") || !args.contender) return 1;
  const left = args.regularSeasonWeeks - args.currentWeek + 1;
  if (left > PLAYOFF_PUSH_WEEKS || left < 0) return 1;
  return book.weight("playoff-schedule");
}

// --- drops ------------------------------------------------------------------

export const PROTECTED_WIRE_RANK = 5;

/**
 * A drop is refused when the player would immediately be one of the five best
 * names on the wire.
 */
export function dropAllowed(
  book: RuleBook,
  dropProj: number,
  topWireProjections: number[],
): { allowed: boolean; note: string | null } {
  if (!book.on("protect-top-wire")) return { allowed: true, note: null };
  const bar = [...topWireProjections].sort((a, b) => b - a)[PROTECTED_WIRE_RANK - 1];
  if (bar === undefined) return { allowed: true, note: null };
  if (dropProj > bar) return { allowed: false, note: book.why("protect-top-wire") };
  return { allowed: true, note: null };
}

/** Contenders never trade for a streamer; nobody rosters two. */
export function tradeAllowed(
  book: RuleBook,
  positions: string[],
): { allowed: boolean; note: string | null } {
  if (book.on("stream-k-def") && positions.some((p) => isStreamPosition(p))) {
    return { allowed: false, note: book.why("stream-k-def") };
  }
  return { allowed: true, note: null };
}

/** Never carry a second kicker or defence. */
export function duplicateStreamer(
  book: RuleBook,
  position: string,
  rosterPositions: string[],
): string | null {
  if (!book.on("stream-k-def") || !isStreamPosition(position)) return null;
  const pos = position.toUpperCase();
  const same = rosterPositions.filter((p) => {
    const r = p.toUpperCase();
    if (pos === "K" || pos === "PK") return r === "K" || r === "PK";
    return isStreamPosition(r) && r !== "K" && r !== "PK";
  });
  return same.length >= 1 ? book.why("stream-k-def") : null;
}

/** Combines a list of rule notes into the single line the screens show. */
export function ruleNote(notes: (string | null | undefined)[]): string | null {
  const first = notes.find((n) => n && n.trim().length);
  return first ? String(first) : null;
}
