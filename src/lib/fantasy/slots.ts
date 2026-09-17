/**
 * Per-league starting slots.
 *
 * Nothing in the app should ask "is this slot called FLEX?" — a slot is a key,
 * a label, a count and the list of positions that may fill it. The platform
 * maps below only exist to turn an import into that shape once; everything
 * downstream reads the eligibility list.
 */

/** DST and DEF, PK and K are the same thing wearing different labels. */
export function canonicalPosition(position: string): string {
  const p = String(position ?? "").trim().toUpperCase();
  if (p === "DST" || p === "D/ST" || p === "D") return "DEF";
  if (p === "PK") return "K";
  return p;
}


export type SlotSource = "detected" | "inferred" | "user";

export interface LeagueSlot {
  /** Stable key for the slot within its league, e.g. "FLEX" or "WRRB". */
  key: string;
  /** What the lineup tab shows, e.g. "Flex (RB/WR/TE)". */
  label: string;
  count: number;
  eligible: string[];
  source: SlotSource;
}

/** Slots that hold anyone and never start, so they carry no eligibility. */
export const BENCH_SLOTS = new Set(["BN", "BE", "BENCH", "IR", "TAXI", "TX", "RES", "NA"]);

/**
 * Platform slot codes and what they accept. Used only at import time — once a
 * league has stored slots, this map is never consulted for that league again.
 */
export const SLOT_CODES: Record<string, string[]> = {
  QB: ["QB"],
  RB: ["RB"],
  WR: ["WR"],
  TE: ["TE"],
  K: ["K"],
  PK: ["K"],
  DEF: ["DEF"],
  DST: ["DEF"],
  "D/ST": ["DEF"],
  FLEX: ["RB", "WR", "TE"],
  WRRB_FLEX: ["RB", "WR"],
  RB_WR: ["RB", "WR"],
  REC_FLEX: ["WR", "TE"],
  WRTE_FLEX: ["WR", "TE"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
  SUPERFLEX: ["QB", "RB", "WR", "TE"],
  OP: ["QB", "RB", "WR", "TE"],
  QB_FLEX: ["QB", "RB", "WR", "TE"],
  IDP: ["DL", "LB", "DB"],
  IDP_FLEX: ["DL", "LB", "DB"],
  DP: ["DL", "LB", "DB"],
  DL: ["DL", "DE", "DT"],
  DE: ["DE", "DL"],
  DT: ["DT", "DL"],
  LB: ["LB", "OLB", "ILB"],
  DB: ["DB", "CB", "S"],
  CB: ["CB", "DB"],
  S: ["S", "DB"],
};

/** ESPN reports slots as numbers. */
export const ESPN_SLOT_IDS: Record<number, string> = {
  0: "QB",
  2: "RB",
  4: "WR",
  6: "TE",
  16: "DEF",
  17: "K",
  23: "FLEX",
  7: "OP",
  3: "WRRB_FLEX",
  5: "REC_FLEX",
  20: "BN",
  21: "IR",
  24: "TAXI",
  8: "DL",
  9: "DE",
  10: "DT",
  11: "LB",
  12: "DB",
  13: "CB",
  14: "S",
};

/** Yahoo spells its flexes out with slashes. */
export const YAHOO_SLOT_CODES: Record<string, string> = {
  "W/R": "WRRB_FLEX",
  "W/T": "REC_FLEX",
  "W/R/T": "FLEX",
  "Q/W/R/T": "SUPER_FLEX",
  "D/ST": "DEF",
  DEF: "DEF",
  K: "K",
};

/** Readable names for the keys we generate ourselves. */
const LABELS: Record<string, string> = {
  QB: "QB",
  RB: "RB",
  WR: "WR",
  TE: "TE",
  K: "K",
  DEF: "DEF",
  FLEX: "Flex",
  WRRB_FLEX: "RB/WR flex",
  REC_FLEX: "WR/TE flex",
  SUPER_FLEX: "Superflex",
  OP: "Superflex",
  IDP_FLEX: "IDP flex",
};

function uniquePositions(list: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of list) {
    const p = canonicalPosition(String(raw));
    if (p && !out.includes(p)) out.push(p);
  }
  return out;
}

export function slotLabel(key: string, eligible: readonly string[]): string {
  const base = LABELS[key] ?? key.replace(/_/g, " ");
  if (eligible.length > 1) return `${base} (${eligible.join("/")})`;
  return base;
}

/**
 * Reads one platform slot code into its eligibility list. Returns null for
 * bench-like slots, and an empty list when the code means nothing to us — the
 * caller then falls back to inference from real lineups.
 */
export function eligibilityForCode(code: string): string[] | null {
  const raw = String(code ?? "").trim();
  if (!raw) return null;
  const key = raw.toUpperCase();
  if (BENCH_SLOTS.has(key)) return null;

  const known = SLOT_CODES[key];
  if (known) return uniquePositions(known);

  // "FLEX (RB/WR/TE)" and "W/R/T" both spell the positions out.
  const inParens = raw.match(/\(([^)]+)\)/)?.[1];
  const body = inParens ?? key;
  if (/[/|,+]/.test(body)) {
    const parts = uniquePositions(body.split(/[/|,+]/).map((s) => s.trim()));
    if (parts.length) return parts;
  }
  const single = canonicalPosition(key);
  return single ? [single] : [];
}

/** Groups a flat list of slot codes into counted slots, preserving order. */
export function slotsFromCodes(
  codes: readonly (string | number)[],
  source: SlotSource = "detected",
): LeagueSlot[] {
  const out: LeagueSlot[] = [];
  for (const raw of codes) {
    const code = typeof raw === "number" ? (ESPN_SLOT_IDS[raw] ?? String(raw)) : String(raw);
    const mapped = YAHOO_SLOT_CODES[code.toUpperCase()] ?? code;
    const eligible = eligibilityForCode(mapped);
    if (eligible === null) continue;
    const key = slotKeyFor(mapped, eligible);
    const existing = out.find((s) => s.key === key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    out.push({
      key,
      label: slotLabel(key, eligible),
      count: 1,
      eligible,
      // No eligibility means we still have to work out what goes here.
      source: eligible.length ? source : "inferred",
    });
  }
  return out;
}

function slotKeyFor(code: string, eligible: readonly string[]): string {
  const key = code.toUpperCase().replace(/\s*\([^)]*\)\s*/g, "").trim();
  if (SLOT_CODES[key] || !eligible.length) return key || "SLOT";
  // A spelled-out custom flex gets a key from its own positions.
  return eligible.length > 1 ? eligible.join("_") : eligible[0]!;
}

/** Flattens counted slots back into one entry per starting spot. */
export function expandSlots(slots: readonly LeagueSlot[]): LeagueSlot[] {
  const out: LeagueSlot[] = [];
  for (const slot of slots) {
    for (let i = 0; i < slot.count; i += 1) out.push(slot);
  }
  return out;
}

/** Every position this league can field, in the order the slots list them. */
export function positionsFromSlots(slots: readonly LeagueSlot[]): string[] {
  return uniquePositions(slots.flatMap((s) => s.eligible));
}

/**
 * Can this player fill this slot? The only eligibility question the app asks.
 */
export function slotTakes(slot: LeagueSlot, position: string): boolean {
  if (!slot.eligible.length) return true;
  return slot.eligible.includes(canonicalPosition(position));
}

/**
 * Works out what a slot accepts from the positions teams actually started in
 * it. Used when the platform gives a code we do not recognise.
 */
export function inferEligibility(observed: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const raw of observed) {
    const p = canonicalPosition(String(raw));
    if (!p) continue;
    counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (!total) return [];
  // One-off mistakes and mid-week oddities should not widen a slot.
  return [...counts.entries()]
    .filter(([, n]) => n / total >= 0.05)
    .sort((a, b) => b[1] - a[1])
    .map(([p]) => p);
}

/**
 * Drops slot codes for positions nobody in the league actually rosters.
 *
 * Used when a platform page could not be read and we would otherwise assume a
 * standard lineup: a league that starts no kicker or defence has none on any
 * roster, so those spots must not be invented.
 */
export function filterSlotCodesByObserved(
  codes: readonly (string | number)[],
  observed: readonly string[],
  teamCount: number,
): (string | number)[] {
  const counts = new Map<string, number>();
  for (const raw of observed) {
    const p = canonicalPosition(String(raw));
    if (p) counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  if (!counts.size) return [...codes];
  const threshold = Math.max(2, Math.ceil(Math.max(1, teamCount) * 0.25));
  const present = (p: string) => (counts.get(p) ?? 0) >= threshold;
  return codes.filter((code) => {
    const eligible = eligibilityForCode(String(code));
    if (!eligible || !eligible.length) return true;
    return eligible.some(present);
  });
}

/** Used when a league has nothing stored yet. */
export const DEFAULT_SLOTS: LeagueSlot[] = slotsFromCodes([
  "QB",
  "RB",
  "RB",
  "WR",
  "WR",
  "TE",
  "FLEX",
  "K",
  "DEF",
]);

/**
 * The key a calculation uses for a slot. Standard codes keep their name; a
 * league-specific slot becomes its own position list ("RB/WR/TE"), so the key
 * alone says what may fill it and nothing has to look the slot up by name.
 */
export function resolvedKey(slot: LeagueSlot): string {
  const key = slot.key.toUpperCase();
  const standard = SLOT_CODES[key];
  if (standard && sameSet(standard, slot.eligible)) return key;
  if (!slot.eligible.length) return key;
  return slot.eligible.join("/");
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const bs = new Set(b.map(canonicalPosition));
  return a.every((x) => bs.has(canonicalPosition(x)));
}

/** Screen labels for each resolved key, e.g. "RB/WR/TE" → "Flex (RB/WR/TE)". */
export function slotLabels(slots: readonly LeagueSlot[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const slot of slots) out[resolvedKey(slot)] = slot.label;
  return out;
}

/** How many positions a slot accepts — breadth, not its name, marks a flex. */
export function slotBreadth(key: string): number {
  return (eligibilityForCode(key) ?? []).length;
}
