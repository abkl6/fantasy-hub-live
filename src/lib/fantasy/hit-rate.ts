/**
 * How good the advice has actually been.
 *
 * The weekly recap grades every recommendation you took or ignored. Over the
 * last six weeks those grades become a hit rate per kind of advice, which both
 * gets shown to you and decides how prominently that kind is offered.
 *
 * Pure math, no I/O.
 */

export const HIT_RATE_WEEKS = 6;
/** Below this many graded calls the rate is noise; treat it as neutral. */
export const MIN_GRADED = 3;

export type Grade = "right" | "wrong" | "missed" | "dodged" | "push";

export interface GradedRow {
  kind: string;
  week: number;
  grade: Grade | string | null;
}

export interface HitRate {
  kind: string;
  hits: number;
  graded: number;
  rate: number | null;
  /** Multiplier for how prominently this kind of advice is shown. */
  weight: number;
  label: string | null;
}

/** "Right" and "dodged" both mean the app told you the truth. */
function isHit(grade: string | null): boolean {
  return grade === "right" || grade === "dodged";
}

function counts(grade: string | null): boolean {
  return grade === "right" || grade === "wrong" || grade === "missed" || grade === "dodged";
}

const KIND_NAMES: Record<string, string> = {
  waiver: "Waiver picks",
  add: "Waiver picks",
  start: "Lineup calls",
  "start-sit": "Lineup calls",
  lineup: "Lineup calls",
  trade: "Trade ideas",
  drop: "Drop calls",
};

export function kindLabel(kind: string): string {
  return KIND_NAMES[kind] ?? `${kind.charAt(0).toUpperCase()}${kind.slice(1)} advice`;
}

export function hitRates(
  rows: GradedRow[],
  currentWeek: number,
  trailingWeeks = HIT_RATE_WEEKS,
): HitRate[] {
  const since = currentWeek - trailingWeeks;
  const byKind = new Map<string, GradedRow[]>();
  for (const r of rows) {
    if (r.week <= since) continue;
    if (!counts(r.grade ?? null)) continue;
    const list = byKind.get(r.kind) ?? [];
    list.push(r);
    byKind.set(r.kind, list);
  }

  return [...byKind.entries()]
    .map(([kind, list]) => {
      const hits = list.filter((r) => isHit(r.grade ?? null)).length;
      const graded = list.length;
      const rate = graded >= MIN_GRADED ? Math.round((hits / graded) * 100) / 100 : null;
      return {
        kind,
        hits,
        graded,
        rate,
        // A kind that has been right lately gets pushed up the page; one that
        // has been wrong drops down. Never far enough to hide it entirely.
        weight: rate === null ? 1 : Math.round(Math.max(0.6, Math.min(1.4, 0.6 + rate)) * 100) / 100,
        label: rate === null ? null : `${kindLabel(kind)}: ${hits} of ${graded} right this season`,
      };
    })
    .sort((a, b) => b.graded - a.graded);
}

export function weightFor(rates: HitRate[], kind: string): number {
  return rates.find((r) => r.kind === kind)?.weight ?? 1;
}
