import { describe, expect, it } from "vitest";

import { buildFills, buildStream, emptySlots, isStreamedPosition, type FillCandidate } from "./slot-fill";
import { rankWaivers } from "./waiver-rank";
import { MIN_BID } from "./rules";

const SLOTS = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF", "BN", "BN"];

function candidate(over: Partial<FillCandidate> & { id: string; position: string }): FillCandidate {
  return {
    name: over.id,
    status: "Active",
    projWeek: 8,
    projSeason: 120,
    vor: 2,
    bid: 20,
    nflTeam: "BUF",
    opponent: "CAR",
    impliedOwn: 27,
    impliedOpponent: 16,
    opponentPointsAllowed: 22,
    ...over,
  } as FillCandidate;
}

const POOL = [
  candidate({ id: "k1", position: "K", projWeek: 9 }),
  candidate({ id: "k2", position: "K", projWeek: 7, impliedOwn: 15, opponentPointsAllowed: 6 }),
  candidate({ id: "d1", position: "DEF", projWeek: 8 }),
  candidate({ id: "rb1", position: "RB", projWeek: 14, vor: 5 }),
];

describe("fill strip", () => {
  it("shows a fill row at the minimum bid when the kicker slot is empty", () => {
    const fills = buildFills({
      slots: SLOTS,
      rosterPositions: ["QB", "RB", "RB", "WR", "WR", "TE", "RB", "DEF"],
      candidates: POOL,
    });
    const kicker = fills.find((f) => f.position === "K");
    expect(kicker).toBeTruthy();
    expect(kicker!.bid).toBe(MIN_BID);
    expect(kicker!.minimumBid).toBe(true);
    expect(kicker!.reason).toContain("CAR");
  });

  it("never lists a kicker in the main wire, even with a kicker rostered", () => {
    const ranked = rankWaivers(
      [
        { id: "k1", position: "K", projWeek: 12, projSeason: 180 },
        { id: "rb1", position: "RB", projWeek: 9, projSeason: 130 },
      ].map((r) => ({
        ...r,
        name: r.id,
        nflTeam: "BUF",
        status: "Active",
        vor: 3,
        bid: 5,
        titleDelta: 0,
        survivalDelta: null,
        impactRank: 0,
        fromCutTeam: false,
      })) as never,
      { sort: "impact", survival: false, showInjured: false },
    );
    expect(ranked.map((r) => r.id)).toEqual(["rb1"]);
  });

  it("keeps a kicker's bid at the minimum whatever the bid model says", () => {
    const fills = buildFills({
      slots: SLOTS,
      rosterPositions: ["QB", "RB", "RB", "WR", "WR", "TE", "RB", "DEF"],
      candidates: [candidate({ id: "k1", position: "K", bid: 45 })],
    });
    expect(fills[0]!.bid).toBe(MIN_BID);
  });

  it("never shows a position the league has no slot for", () => {
    const noKicker = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "BN"];
    expect(emptySlots(noKicker, []).some((s) => s.position === "K")).toBe(false);
    const fills = buildFills({ slots: noKicker, rosterPositions: [], candidates: POOL });
    expect(fills.some((f) => isStreamedPosition(f.position))).toBe(false);
    const stream = buildStream({
      slots: noKicker,
      current: [
        {
          name: "Old Kicker",
          position: "K",
          projWeek: 6,
          facts: {
            nflTeam: "NYJ",
            opponent: "SF",
            impliedOwn: 14,
            impliedOpponent: 28,
            opponentPointsAllowed: 5,
          },
        },
      ],
      candidates: POOL,
    });
    expect(stream).toBeNull();
  });
});
