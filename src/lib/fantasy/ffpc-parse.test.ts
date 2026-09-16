import { describe, expect, it } from "vitest";

import {
  detectAllPlayWeeks,
  detectVictoryPoints,
  discoverLeagueId,
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

  it("accepts a link that carries only the token without mistaking its prefix for the league id", () => {
    expect(parseFfpcUrl("https://myffpc.com/LeagueHome.aspx?ltuid=762-17F0D0BFA8FF")).toEqual({
      leagueId: null,
      ltuid: "762-17F0D0BFA8FF",
    });
  });

  it("discovers the league id from FFPC's hidden page label", () => {
    expect(discoverLeagueId('<div style="display:none;">League ID: 77294</div>')).toBe("77294");
  });

  it("falls back to FFPC roster and logo identifiers", () => {
    expect(discoverLeagueId("<section id='teamRoster_77294_7'></section>")).toBe("77294");
    expect(discoverLeagueId('<img src="LogosUploaded/L77294T5072.png">')).toBe("77294");
  });

  it("still discovers a league id from older query-string links", () => {
    expect(discoverLeagueId('<a href="Standings.aspx?leagueID=98765">Standings</a>')).toBe("98765");
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
