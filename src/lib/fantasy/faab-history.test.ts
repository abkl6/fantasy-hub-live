import { describe, expect, it } from "vitest";

import { bidsFromTransactions, weekOfTransaction } from "./faab-history.server";

const NOW = new Date("2026-09-17T12:00:00Z");

describe("weekOfTransaction", () => {
  it("keeps this week's claims in the current week", () => {
    expect(weekOfTransaction("2026-09-16", 3, NOW)).toBe(3);
  });

  it("counts earlier claims back a week at a time", () => {
    expect(weekOfTransaction("2026-09-09", 3, NOW)).toBe(2);
    expect(weekOfTransaction("2026-09-02", 3, NOW)).toBe(1);
  });

  it("never runs below week one, and falls back when the date is unreadable", () => {
    expect(weekOfTransaction("2026-01-01", 3, NOW)).toBe(1);
    expect(weekOfTransaction("not a date", 4, NOW)).toBe(4);
    expect(weekOfTransaction(null, 4, NOW)).toBe(4);
  });
});

describe("bidsFromTransactions", () => {
  const t = (over: Partial<Parameters<typeof bidsFromTransactions>[0][number]>) => ({
    date: "2026-09-16",
    bid: 25,
    teamExternalId: "7",
    addedPlayer: { name: "Brock Bowers" },
    ...over,
  });

  it("keeps only claims that cost budget", () => {
    const rows = bidsFromTransactions(
      [t({}), t({ bid: 0, addedPlayer: { name: "Free Agent" } }), t({ bid: null, addedPlayer: { name: "Nobody" } })],
      3,
      NOW,
    );
    expect(rows).toEqual([
      { week: 3, teamExternalId: "7", playerName: "Brock Bowers", amount: 25 },
    ]);
  });

  it("ignores rows with no added player", () => {
    expect(bidsFromTransactions([t({ addedPlayer: null })], 3, NOW)).toHaveLength(0);
  });

  it("does not record the same claim twice when the page is read again", () => {
    const page = [t({}), t({})];
    expect(bidsFromTransactions(page, 3, NOW)).toHaveLength(1);
    expect(bidsFromTransactions([...page, ...page], 3, NOW)).toHaveLength(1);
  });

  it("separates the same player won in different weeks", () => {
    const rows = bidsFromTransactions([t({}), t({ date: "2026-09-09", bid: 40 })], 3, NOW);
    expect(rows.map((r) => [r.week, r.amount])).toEqual([
      [3, 25],
      [2, 40],
    ]);
  });
});
