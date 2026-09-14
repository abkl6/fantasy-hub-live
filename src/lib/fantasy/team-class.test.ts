import { describe, expect, it } from "vitest";

import { classifyTeam, isWinNow } from "./team-class";
import { acceptanceBandOf, acceptanceScore } from "./proposal.server";

describe("classifyTeam", () => {
  it("names the best redraft team the top seed", () => {
    const badge = classifyTeam({
      titleOdds: 0.28,
      playoffOdds: 0.9,
      oddsRank: 1,
      teamCount: 12,
      isDynasty: false,
    });
    expect(badge.key).toBe("top-seed");
  });

  it("calls a weak redraft team a bottom feeder", () => {
    const badge = classifyTeam({
      titleOdds: 0.01,
      playoffOdds: 0.05,
      oddsRank: 12,
      teamCount: 12,
      isDynasty: false,
    });
    expect(badge.key).toBe("bottom");
  });

  it("crowns a dynasty king when the team wins now and owns the best future", () => {
    const badge = classifyTeam({
      titleOdds: 0.3,
      playoffOdds: 0.85,
      oddsRank: 1,
      teamCount: 12,
      isDynasty: true,
      dynastyRank: 1,
    });
    expect(badge.key).toBe("dynasty-king");
  });

  it("marks a rebuild with a strong future as a future star", () => {
    const badge = classifyTeam({
      titleOdds: 0.01,
      playoffOdds: 0.1,
      oddsRank: 11,
      teamCount: 12,
      isDynasty: true,
      dynastyRank: 2,
    });
    expect(badge.key).toBe("future-star");
  });

  it("treats a top-three seed as win-now", () => {
    expect(isWinNow({ titleOdds: 0.1, playoffOdds: 0.4, oddsRank: 2, teamCount: 12, isDynasty: true })).toBe(true);
  });
});

describe("acceptanceScore", () => {
  const base = {
    bSendValue: 5000,
    bReceiveValue: 5000,
    bTitleDelta: 0,
    bPlayoffDelta: 0,
    bDynastyDelta: 0,
    bWinNow: false,
    isDynasty: true,
  };

  it("is near a coin flip for an even deal", () => {
    expect(acceptanceBandOf(acceptanceScore(base))).toBe("Coin flip");
  });

  it("rises when the other side gains market value", () => {
    expect(acceptanceScore({ ...base, bReceiveValue: 8000, bDynastyDelta: 3000 })).toBeGreaterThan(
      acceptanceScore(base),
    );
  });

  it("falls when the other side is fleeced", () => {
    expect(acceptanceScore({ ...base, bReceiveValue: 2000, bDynastyDelta: -3000 })).toBeLessThan(0.3);
  });

  it("weights this season more heavily for a win-now team", () => {
    const winNow = acceptanceScore({ ...base, bWinNow: true, bTitleDelta: 0.05, bPlayoffDelta: 0.1 });
    const rebuild = acceptanceScore({ ...base, bTitleDelta: 0.05, bPlayoffDelta: 0.1 });
    expect(winNow).toBeGreaterThan(rebuild);
  });
});
