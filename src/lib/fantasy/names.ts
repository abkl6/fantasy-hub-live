/**
 * Player name matching.
 *
 * Fantasy platforms disagree on spellings: Sleeper says "Kenneth Walker",
 * other feeds say "Kenneth Walker III". Everything in the app matches players
 * through these helpers so the same human is never treated as two players
 * (which used to put a rostered player back on the waiver wire).
 *
 * Mirrors the SQL function public.norm_player_name.
 */

const SUFFIX = / (jr|sr|ii|iii|iv|v)$/;

/** Lowercase, strip punctuation, collapse spaces, drop a generational suffix. */
export function normalizeName(name: string | null | undefined): string {
  const base = (name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return base.replace(SUFFIX, "").trim();
}

/** Normalised name plus position — the strongest match we can make offline. */
export function playerKey(name: string | null | undefined, position: string | null | undefined): string {
  return `${normalizeName(name)}|${(position ?? "").toUpperCase()}`;
}

/**
 * Builds a lookup that resolves a (name, position) pair to a canonical player,
 * falling back to the name alone when the position differs (DEF/DST, LB/DL).
 */
export function playerIndex<T extends { full_name: string; position: string }>(rows: T[]) {
  const byKey = new Map<string, T>();
  const byName = new Map<string, T>();
  for (const row of rows) {
    byKey.set(playerKey(row.full_name, row.position), row);
    const n = normalizeName(row.full_name);
    if (!byName.has(n)) byName.set(n, row);
  }
  return {
    find(name: string | null | undefined, position?: string | null): T | null {
      return byKey.get(playerKey(name, position)) ?? byName.get(normalizeName(name)) ?? null;
    },
  };
}
