import { describe, expect, it } from "vitest";
import { bidLadder, desperationOf, willingToPay } from "./faab";

describe("desperationOf", () => {
  it("reads average risk as moderate and the low scorer as frantic", () => {
    const average = desperationOf(1 - 1 / 12, 12);
    expect(average).toBeGreaterThan(0.3);
    expect(average).toBeLessThan(0.4);
    expect(desperationOf(0.5, 12)).toBeGreaterThan(0.9);
    expect(desperationOf(0.999, 12)).toBeLessThan(0.05);
  });
});

describe("willingToPay", () => {
  it("never exceeds the money a team actually has", () => {
    expect(willingToPay(100, 8, 0.5, 0.3, 12, 6)).toBeLessThanOrEqual(8);
  });
  it("pays more when desperate than when safe", () => {
    const desperate = willingToPay(100, 100, 0.5, 0.2, 12, 6);
    const safe = willingToPay(100, 100, 0.99, 0.2, 12, 6);
    expect(desperate).toBeGreaterThan(safe);
  });
});

describe("bidLadder", () => {
  const base = {
    budget: 100,
    myRemaining: 100,
    mySurviveWeekOdds: 0.95,
    mySurvivalGain: 0.05,
    teamCount: 12,
    weeksLeft: 8,
  };

  it("orders the three bids", () => {
    const l = bidLadder({
      ...base,
      rivals: [
        { id: "a", name: "Rival A", surviveWeekOdds: 0.5, survivalGain: 0.1, faabRemaining: 80 },
      ],
    });
    expect(l.passive).toBeLessThanOrEqual(l.optimal);
    expect(l.optimal).toBeLessThan(l.aggressive);
  });

  it("stays cheap when no rival can pay", () => {
    const l = bidLadder({
      ...base,
      rivals: [{ id: "a", name: "Broke", surviveWeekOdds: 0.5, survivalGain: 0.1, faabRemaining: 1 }],
    });
    expect(l.expectedTopRival).toBeLessThanOrEqual(1);
    expect(l.optimal).toBeLessThan(20);
  });

  it("never bids more than my remaining budget", () => {
    const l = bidLadder({
      ...base,
      myRemaining: 5,
      mySurviveWeekOdds: 0.4,
      mySurvivalGain: 0.3,
      rivals: [{ id: "a", name: "Rich", surviveWeekOdds: 0.5, survivalGain: 0.2, faabRemaining: 90 }],
    });
    expect(l.aggressive).toBeLessThanOrEqual(5);
  });
});
