import { describe, expect, it } from "vitest";

import {
  detectAllPlayWeeks,
  detectVictoryPoints,
  parseFfpcUrl,
  parsePlayerCell,
} from "./ffpc-parse";
import { normalizeName } from "./names";

describe("FFPC player cells", () => {
  it("reads 'Last, First TEAM (POS)'", () => {
    expect(parsePlayerCell("Jeanty, Ashton LV (RB)")).toEqual({
      name: "Ashton Jeanty",
      position: "RB",
      nflTeam: "LV",
    });
  });

  it("matches suffixed names through the shared normaliser", () => {
    const parsed = parsePlayerCell("Walker III, Kenneth SEA (RB)");
    expect(normalizeName(parsed?.name)).toBe(normalizeName("Kenneth Walker"));
  });

  it("returns null for header or empty cells", () => {
    expect(parsePlayerCell("")).toBeNull();
    expect(parsePlayerCell("Player")).toBeNull();
  });
});

describe("FFPC league link", () => {
  it("pulls the league id and token out of any league URL", () => {
    expect(parseFfpcUrl("https://myffpc.com/LeagueHome.aspx?leagueID=98765&ltuid=abc123")).toEqual({
      leagueId: "98765",
      ltuid: "abc123",
    });
  });

  it("rejects links from other sites", () => {
    expect(parseFfpcUrl("https://example.com/LeagueHome.aspx?leagueID=1")).toBeNull();
  });
});

describe("FFPC league rules detection", () => {
  it("spots victory point leagues", () => {
    expect(detectVictoryPoints("<th>Season VP</th>")).toBe(true);
    expect(detectVictoryPoints("<th>Points For</th>")).toBe(false);
  });

  it("reads all-play weeks from a league notice", () => {
    expect(detectAllPlayWeeks("All-Play weeks: 12, 13 and 14")).toEqual([12, 13, 14]);
  });
});
