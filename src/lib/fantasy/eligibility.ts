/**
 * Which positions a league can actually use.
 *
 * A league that has no kicker slot should never be told to bid on a kicker,
 * and a league with defensive players should see them everywhere. Both facts
 * come from the same place: the roster slots the platform reported.
 */

import { SLOT_CODES, canonicalPosition } from "./slots";

export { canonicalPosition };

/** Slots that hold anyone, so they say nothing about eligibility. */
const OPEN_SLOTS = new Set(["BN", "BE", "BENCH", "IR", "TAXI", "TX", "RES", "NA"]);

/** Shown in this order wherever positions are listed. */
export const CANONICAL_ORDER = [
  "QB",
  "RB",
  "WR",
  "TE",
  "K",
  "DEF",
  "DL",
  "DE",
  "DT",
  "LB",
  "OLB",
  "ILB",
  "DB",
  "CB",
  "S",
];

/** Used when a league has no slots recorded yet. */
export const DEFAULT_ELIGIBLE = ["QB", "RB", "WR", "TE", "K", "DEF"];

/**
 * Every position that can fill at least one slot, with flex slots expanded.
 * Unknown platform slots are read as their own position so a custom slot never
 * silently hides its players.
 */
export function eligiblePositions(slots: unknown): string[] {
  const list = Array.isArray(slots) ? slots.map((s) => String(s)) : [];
  const found = new Set<string>();

  for (const raw of list) {
    const cell = raw.trim().toUpperCase();
    // A spot may state its own eligibility in brackets: "FLEX (RB/WR/TE)".
    const inBrackets = cell.match(/\(([^)]*)\)/)?.[1]?.trim();
    const slot = inBrackets || cell.replace(/\([^)]*\)/, "").trim();
    if (!slot || OPEN_SLOTS.has(slot)) continue;
    const flex = SLOT_CODES[slot];
    if (flex) {
      for (const pos of flex) found.add(canonicalPosition(pos));
      continue;
    }
    // A custom flex the platform spells out, e.g. "RB/WR" or "QB-RB-WR-TE".
    if (/[/|,+-]/.test(slot)) {
      for (const part of slot.split(/[/|,+-]/)) {
        const p = canonicalPosition(part);
        if (p) found.add(p);
      }
      continue;
    }
    found.add(canonicalPosition(slot));
  }

  if (found.size === 0) return [...DEFAULT_ELIGIBLE];

  const ordered = CANONICAL_ORDER.filter((p) => found.has(p));
  const extras = [...found].filter((p) => !CANONICAL_ORDER.includes(p)).sort();
  return [...ordered, ...extras];
}

/** Reads the stored list, falling back to the slots when it is missing. */
export function asEligiblePositions(stored: unknown, slots: unknown): string[] {
  if (Array.isArray(stored) && stored.length) {
    return stored.map((s) => canonicalPosition(String(s)));
  }
  return eligiblePositions(slots);
}

/** True when this league can actually field the position. */
export function isEligiblePosition(position: string, eligible: readonly string[]): boolean {
  if (!eligible.length) return true;
  const p = canonicalPosition(position);
  if (!p) return false;
  if (eligible.includes(p)) return true;
  // A league with a generic DL slot can still use a DE, and so on.
  for (const e of eligible) {
    const group = SLOT_CODES[e];
    if (group?.map(canonicalPosition).includes(p)) return true;
  }
  return false;
}

/** Convenience for filtering any list of things that carry a position. */
export function eligibilityFilter(eligible: readonly string[]) {
  return <T extends { position?: string | null }>(row: T) =>
    isEligiblePosition(String(row.position ?? ""), eligible);
}
