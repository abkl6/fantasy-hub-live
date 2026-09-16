import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  detectAllPlayWeeks,
  detectVictoryPoints,
  discoverLeagueId,
  parseFfpcUrl,
  parsePlayerCell,
} from "./ffpc-parse";
import { parseAllRosters, parseLeagueHome } from "./ffpc.server";
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

describe("FFPC captured league pages", () => {
  const fixture = (name: string) =>
    readFileSync(new URL(`./ffpc/__fixtures__/${name}`, import.meta.url), "utf8");

  it("parses LeagueHome using FFPC's labelled blocks and shifted standings rows", () => {
    const home = parseLeagueHome(fixture("league-home.html"), "77294");
    const divisions = new Set(home.teams.map((team) => team.division));
    const mingos = home.teams.find((team) => team.name === "Mingos (C)");
    const hurts = home.myRoster.find((player) => player.name === "Jalen Hurts");

    expect(home.name).toBe("$100 Empire Standard Dynasty #39");
    expect(home.leagueType).toBe("Dynasty League");
    expect(home.season).toBe(2026);
    expect(home.currentWeek).toBe(2);
    expect(home.myTeamExternalId).toBe("7");
    expect(home.teams).toHaveLength(12);
    expect(divisions).toEqual(new Set(["Division 1", "Division 2", "Division 3"]));
    expect(mingos).toMatchObject({
      externalId: "7",
      wins: 1,
      losses: 0,
      ties: 0,
      vp: 4,
      pointsFor: 162.95,
      playoffSeed: 3,
      division: "Division 1",
    });
    expect(home.usesVp).toBe(true);
    expect(home.faabRemaining).toBe(1000);
    expect(home.myRoster).toHaveLength(19);
    expect(hurts).toMatchObject({ name: "Jalen Hurts", nflTeam: "PHI", slot: "QB", isStarter: true });
    expect(home.mySchedule[0]).toMatchObject({
      week: 1,
      opponentExternalId: "8",
      homeTeamExternalId: "7",
      myScore: 162.95,
      oppScore: 109.95,
      isFinal: true,
    });
    expect(home.mySchedule[1]).toMatchObject({ week: 2, homeTeamExternalId: "4", isFinal: false });
  });

  it("parses every team row from Rosters.aspx", () => {
    const rosters = parseAllRosters(fixture("rosters.html"));
    expect(rosters.size).toBe(12);
    expect(rosters.get("7")?.length).toBeGreaterThanOrEqual(19);
    expect(rosters.get("7")).toContainEqual(
      expect.objectContaining({ name: "Jalen Hurts", nflTeam: "PHI", position: "QB" }),
    );
  });
});
