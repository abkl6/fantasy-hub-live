import { describe, expect, it, beforeEach } from "vitest";
import { invalidatePlayers, loadAllPlayers, PLAYERS_TTL_MS } from "./shared-data.server";

function fakeDb(rows: unknown[], fail = false) {
  let calls = 0;
  const db = {
    from: () => ({
      select: () => ({
        order: () => ({
          range: async () => {
            calls += 1;
            return fail ? { data: null, error: { message: "boom" } } : { data: rows, error: null };
          },
        }),
      }),
    }),
  };
  return { db: db as never, calls: () => calls };
}

describe("loadAllPlayers", () => {
  beforeEach(() => invalidatePlayers());

  it("downloads once for concurrent and repeat callers within the TTL", async () => {
    const { db, calls } = fakeDb([{ id: "a" }]);
    const [a, b] = await Promise.all([loadAllPlayers(db, 0), loadAllPlayers(db, 10)]);
    await loadAllPlayers(db, PLAYERS_TTL_MS - 1);
    expect(a).toBe(b);
    expect(calls()).toBe(1);
  });

  it("downloads again once the TTL has passed", async () => {
    const { db, calls } = fakeDb([{ id: "a" }]);
    await loadAllPlayers(db, 0);
    await loadAllPlayers(db, PLAYERS_TTL_MS);
    expect(calls()).toBe(2);
  });

  it("does not keep a failed download", async () => {
    const bad = fakeDb([], true);
    await expect(loadAllPlayers(bad.db, 0)).rejects.toThrow("boom");
    const good = fakeDb([{ id: "b" }]);
    expect(await loadAllPlayers(good.db, 1)).toEqual([{ id: "b" }]);
  });
});
