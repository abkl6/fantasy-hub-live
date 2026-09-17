/**
 * Best ball tournaments (Underdog, DraftKings).
 *
 * A tournament is stored as a league with one "entry" per draft. There are no
 * opponents, no waivers and no lineup decisions: each week the highest
 * scoring valid lineup counts automatically. Pure values, no I/O.
 */

export const BESTBALL_SITES = ["underdog", "draftkings"] as const;
export type BestballSite = (typeof BESTBALL_SITES)[number];

export const BESTBALL_SITE_LABELS: Record<BestballSite, string> = {
  underdog: "Underdog",
  draftkings: "DraftKings",
};

/** Each site's lineup: 1 QB, 2 RB, 3 WR, 1 TE, 1 FLEX. */
export const BESTBALL_SLOTS: string[] = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX"];

/** Round one of both sites' main tournaments runs through week 14. */
export const ROUND_ONE_LAST_WEEK = 14;

/** The scoring preset each site uses. */
export const BESTBALL_SCORING: Record<BestballSite, string> = {
  underdog: "underdog",
  draftkings: "draftkings",
};

export function isBestballSite(platform: string | null | undefined): platform is BestballSite {
  return (BESTBALL_SITES as readonly string[]).includes(String(platform ?? "").toLowerCase());
}

export function asBestballSite(value: unknown): BestballSite | null {
  const v = String(value ?? "").toLowerCase();
  return isBestballSite(v) ? (v as BestballSite) : null;
}

/** A stable id for a tournament so a re-import replaces its entries. */
export function tournamentKey(site: BestballSite, tournament: string): string {
  const slug = tournament
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${site}:${slug || "tournament"}`;
}
