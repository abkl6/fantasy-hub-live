import { describe, expect, it } from "vitest";

import { buildBuySell, filterBuySellForClass } from "./buy-sell";
import {
  EMPTY_IMPACT,
  impactAddKey,
  impactScore,
  impactSwapKey,
  primaryImpactText,
  teamClassOf,
  titleText,
} from "./impact";

const impact = (over: Partial<typeof EMPTY_IMPACT>) => ({ ...EMPTY_IMPACT, ...over });

describe("team class", () => {
  it("splits badges into contender, middle and rebuilder", () => {
    expect(teamClassOf("top-seed")).toBe("contender");
    expect(teamClassOf("bottom")).toBe("rebuilder");
    expect(teamClassOf("bubble")).toBe("middle");
  });
});

describe("impact text", () => {
  it("formats title odds as a signed percentage", () => {
    expect(titleText(impact({ titleDelta: 0.018 }))).toBe("+1.8% title");
    expect(titleText(impact({ titleDelta: -0.023 }))).toBe("-2.3% title");
  });

  it("shows title odds to a contender and dynasty rank to a rebuilder", () => {
    const move = impact({ titleDelta: 0.018, dynastyRankDelta: 2, dynastyValueDelta: 4000 });
    expect(primaryImpactText(move, "contender", true)).toBe("+1.8% title");
    expect(primaryImpactText(move, "rebuilder", true)).toBe("+2 dynasty rank");
    expect(primaryImpactText(move, "middle", true)).toContain("·");
  });

  it("falls back to market value when the rank does not move", () => {
    expect(primaryImpactText(impact({ dynastyValueDelta: 1500 }), "rebuilder", true)).toBe(
      "+1,500 dynasty value",
    );
  });

  it("ranks by what the team is playing for", () => {
    const winNow = impact({ titleDelta: 0.04 });
    const future = impact({ dynastyRankDelta: 3 });
    expect(impactScore(winNow, "contender", true)).toBeGreaterThan(
      impactScore(future, "contender", true),
    );
    expect(impactScore(future, "rebuilder", true)).toBeGreaterThan(
      impactScore(winNow, "rebuilder", true),
    );
  });

  it("builds stable keys for swaps and adds", () => {
    expect(impactSwapKey("A.J. Brown", "Mike Evans Jr.")).toBe("swap:aj brown|mike evans");
    expect(impactAddKey("A.J. Brown")).toBe("add:aj brown");
  });
});

describe("buy and sell", () => {
  const pool = Array.from({ length: 12 }, (_, i) => ({
    name: `WR${i + 1}`,
    position: "WR",
    value: 5000 - i * 100,
    production: 200 - i * 10,
    mine: i % 2 === 0,
  }));

  it("flags a player whose production is well ahead of his price", () => {
    const candidates = pool.map((p) =>
      p.name === "WR12" ? { ...p, production: 400 } : p,
    );
    const rows = buildBuySell(candidates);
    const wr12 = rows.find((r) => r.name === "WR12");
    expect(wr12?.side).toBe("buy");
    expect(wr12?.gap).toBeGreaterThanOrEqual(8);
  });

  it("flags a player whose price is well ahead of his production", () => {
    const candidates = pool.map((p) => (p.name === "WR1" ? { ...p, production: 5 } : p));
    const rows = buildBuySell(candidates);
    expect(rows.find((r) => r.name === "WR1")?.side).toBe("sell");
  });

  it("ignores pools too small to rank", () => {
    expect(buildBuySell(pool.slice(0, 5))).toEqual([]);
  });

  it("shows a contender the buys and a rebuilder the sells", () => {
    const candidates = pool.map((p) =>
      p.name === "WR12" ? { ...p, production: 400 } : p.name === "WR1" ? { ...p, production: 5 } : p,
    );
    const rows = buildBuySell(candidates);
    expect(filterBuySellForClass(rows, "contender").every((r) => r.side === "buy" || r.mine)).toBe(
      true,
    );
    expect(filterBuySellForClass(rows, "rebuilder").every((r) => r.side === "sell" || !r.mine)).toBe(
      true,
    );
  });
});
