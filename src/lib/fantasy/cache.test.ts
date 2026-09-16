import { describe, expect, it, vi } from "vitest";

import { cached, hashParts } from "./cache.server";
import { simulateSeason } from "./engine";

/** Minimal stand-in for the Supabase client shape cache.server uses. */
function fakeSupabase() {
  const rows: Record<string, unknown>[] = [];

  const matcher = (filters: Record<string, unknown>) => (row: Record<string, unknown>) =>
    Object.entries(filters).every(([k, v]) => row[k] === v);

  return {
    rows,
    from() {
      const filters: Record<string, unknown> = {};
      const builder: Record<string, unknown> = {
        select() {
          return builder;
        },
        eq(column: string, value: unknown) {
          filters[column] = value;
          return builder;
        },
        is(column: string, value: unknown) {
          filters[column] = value;
          return builder;
        },
        filter(column: string, _op: string, value: unknown) {
          filters[column] = value;
          return builder;
        },
        maybeSingle() {
          return Promise.resolve({ data: rows.find(matcher(filters)) ?? null });
        },
        delete() {
          const del = {
            eq(column: string, value: unknown) {
              filters[column] = value;
              return del;
            },
            is(column: string, value: unknown) {
              filters[column] = value;
              return del;
            },
            filter(column: string, _op: string, value: unknown) {
              filters[column] = value;
              return del;
            },
            then(resolve: (v: unknown) => void) {
              for (let i = rows.length - 1; i >= 0; i--) {
                if (matcher(filters)(rows[i]!)) rows.splice(i, 1);
              }
              return Promise.resolve({ error: null }).then(resolve);
            },
          };
          return del;
        },
        insert(row: Record<string, unknown>) {
          rows.push(row);
          return Promise.resolve({ error: null });
        },
      };
      return builder;
    },
  };
}

const OPTS = { userId: "u1", leagueId: "l1", kind: "analysis" as const };

const SIM_TEAMS = [
  { id: "a", name: "A", isMine: true, mean: 100, sd: 20 },
  { id: "b", name: "B", isMine: false, mean: 95, sd: 20 },
];
const SIM_CONFIG = { playoffTeams: 1, regularSeasonWeeks: 14, currentWeek: 13 };

describe("analysis cache", () => {
  it("does not recompute — or re-simulate — when the inputs hash is unchanged", async () => {
    const db = fakeSupabase();
    const hash = hashParts(["rosters", "ppr", 3]);
    const compute = vi.fn(async () => {
      simulateSeason(SIM_TEAMS, SIM_CONFIG, [], 100, 7);
      return { value: 1 };
    });

    const first = await cached(db as never, OPTS, hash, compute);
    const second = await cached(db as never, OPTS, hash, compute);

    expect(first).toEqual({ value: 1 });
    expect(second).toEqual({ value: 1 });
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("recomputes when any input changes", async () => {
    const db = fakeSupabase();
    const compute = vi.fn(async () => ({ value: 1 }));

    await cached(db as never, OPTS, hashParts(["ppr", 3]), compute);
    await cached(db as never, OPTS, hashParts(["half-ppr", 3]), compute);
    await cached(db as never, OPTS, hashParts(["half-ppr", 4]), compute);

    expect(compute).toHaveBeenCalledTimes(3);
  });

  it("recomputes an expired entry even when the hash still matches", async () => {
    const db = fakeSupabase();
    const hash = hashParts(["ppr", 3]);
    const compute = vi.fn(async () => ({ value: 1 }));

    await cached(db as never, { ...OPTS, ttlMs: -1 }, hash, compute);
    await cached(db as never, OPTS, hash, compute);

    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("keeps cached results apart per kind and per league", async () => {
    const db = fakeSupabase();
    const hash = hashParts(["ppr", 3]);
    const compute = vi.fn(async () => ({ value: 1 }));

    await cached(db as never, OPTS, hash, compute);
    await cached(db as never, { ...OPTS, kind: "playoff" }, hash, compute);
    await cached(db as never, { ...OPTS, leagueId: "l2" }, hash, compute);

    expect(compute).toHaveBeenCalledTimes(3);
  });
});
