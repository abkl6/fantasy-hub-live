/**
 * Player name matching.
 *
 * Fantasy platforms disagree on spellings: Sleeper says "Kenneth Walker",
 * other feeds say "Kenneth Walker III". Everything in the app matches players
 * through these helpers so the same human is never treated as two players
 * (which used to put a rostered player back on the waiver wire).
 *
 * NEVER compare player names with raw `.toLowerCase()` — always go through
 * `normalizeName` / `playerKey` / `playerIndex`.
 *
 * Mirrors the SQL function public.norm_player_name.
 */

/** Generational suffixes, including numeric spellings some feeds use. */
const SUFFIX = /\s+(jr|sr|ii|iii|iv|vi{0,3}|2nd|3rd|4th|5th)$/;

/** Common defense aliases so "Ravens D/ST" and "Baltimore Defense" agree. */
const DEFENSE = /\b(dst|d st|def|defense|defence|special teams)\b/g;

/** Lowercase, fold accents, strip punctuation, drop generational suffixes. */
export function normalizeName(name: string | null | undefined): string {
  let base = (name ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // accents: José -> Jose
    .toLowerCase()
    .replace(/[.,'`’]/g, "") // A.J. -> aj, O'Neal -> oneal
    .replace(/[-/\\]/g, " ") // Amon-Ra -> amon ra, D/ST -> d st
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  base = base.replace(DEFENSE, "dst").replace(/\s+/g, " ").trim();

  // Strip stacked suffixes ("Walker Jr II") until none remain.
  let prev = "";
  while (prev !== base) {
    prev = base;
    base = base.replace(SUFFIX, "").trim();
  }
  return base;
}

/** Normalised name plus position — the strongest match we can make offline. */
export function playerKey(name: string | null | undefined, position: string | null | undefined): string {
  return `${normalizeName(name)}|${normalizePosition(position)}`;
}

/** Position labels differ across platforms; fold the equivalent ones. */
export function normalizePosition(position: string | null | undefined): string {
  const p = (position ?? "").toUpperCase().trim();
  if (p === "DST" || p === "D/ST" || p === "DEF") return "DEF";
  if (p === "PK") return "K";
  return p;
}

/** The platform identifiers we store alongside every canonical player. */
export const PLATFORM_ID_FIELDS = ["sleeper_id", "espn_id", "yahoo_id", "ktc_slug"] as const;
export type PlatformIdField = (typeof PLATFORM_ID_FIELDS)[number];

type IdBearing = Partial<Record<PlatformIdField, string | null>>;

/**
 * Builds a lookup that resolves a (name, position) pair to a canonical player,
 * falling back to the name alone when the position differs (DEF/DST, LB/DL).
 *
 * Where a platform identifier is known it always wins: identifiers never
 * change, names do. `findWithId` also reports whether the match came from the
 * identifier, so an import can write the identifier back and never have to
 * match that player by name again.
 */
export function playerIndex<
  T extends { full_name: string; position: string; nfl_team?: string | null } & IdBearing,
>(rows: T[]) {
  const byKey = new Map<string, T>();
  const byNameTeam = new Map<string, T>();
  const byName = new Map<string, T>();
  const byId = new Map<string, T>();
  for (const row of rows) {
    byKey.set(playerKey(row.full_name, row.position), row);
    const n = normalizeName(row.full_name);
    const team = (row.nfl_team ?? "").toUpperCase().trim();
    if (team) byNameTeam.set(`${n}|${team}`, row);
    if (!byName.has(n)) byName.set(n, row);
    for (const field of PLATFORM_ID_FIELDS) {
      const value = row[field];
      if (value) byId.set(`${field}|${value}`, row);
    }
  }

  const byNameOnly = (
    name: string | null | undefined,
    position?: string | null,
    nflTeam?: string | null,
  ): T | null => {
    const normalized = normalizeName(name);
    const team = (nflTeam ?? "").toUpperCase().trim();
    return (
      (team ? byNameTeam.get(`${normalized}|${team}`) : undefined) ??
      byKey.get(playerKey(name, position)) ??
      byName.get(normalized) ??
      null
    );
  };

  return {
    find: byNameOnly,
    findBy(field: PlatformIdField, id: string | null | undefined): T | null {
      if (!id) return null;
      return byId.get(`${field}|${id}`) ?? null;
    },
    /** Identifier first, name second; `matchedById` says which one hit. */
    findWithId(
      field: PlatformIdField,
      id: string | null | undefined,
      name: string | null | undefined,
      position?: string | null,
      nflTeam?: string | null,
    ): { row: T | null; matchedById: boolean } {
      const byIdentifier = id ? (byId.get(`${field}|${id}`) ?? null) : null;
      if (byIdentifier) return { row: byIdentifier, matchedById: true };
      return { row: byNameOnly(name, position, nflTeam), matchedById: false };
    },
  };
}
