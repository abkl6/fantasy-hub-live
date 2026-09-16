import { describe, expect, it } from "vitest";

import {
  asLeagueType,
  asTypeSource,
  asVariant,
  detectLeagueType,
  effectiveFormat,
  showsPickValues,
  showsSurvival,
  typeSourceLabel,
} from "./league-type";

describe("coercion", () => {
  it("falls back to safe defaults", () => {
    expect(asLeagueType("dynasty")).toBe("dynasty");
    expect(asLeagueType("nonsense")).toBe("redraft");
    expect(asVariant("empire")).toBe("empire");
    expect(asVariant(null)).toBe("none");
    expect(asTypeSource("user")).toBe("user");
    expect(asTypeSource(undefined)).toBe("inferred");
  });
});

describe("effectiveFormat", () => {
  it("maps type and variant onto the engine format", () => {
    expect(effectiveFormat("dynasty", "none")).toBe("dynasty");
    expect(effectiveFormat("redraft", "guillotine")).toBe("guillotine");
    expect(effectiveFormat("redraft", "none", "best_ball")).toBe("best_ball");
  });
});

describe("feature switches", () => {
  it("shows pick values outside plain redraft", () => {
    expect(showsPickValues("dynasty", "none")).toBe(true);
    expect(showsPickValues("keeper", "none")).toBe(true);
    expect(showsPickValues("redraft", "empire")).toBe(true);
    expect(showsPickValues("redraft", "none")).toBe(false);
  });
  it("shows survival only for guillotine", () => {
    expect(showsSurvival("guillotine")).toBe(true);
    expect(showsSurvival("none")).toBe(false);
  });
});

describe("detectLeagueType", () => {
  it("reads Sleeper settings.type", () => {
    expect(detectLeagueType({ sleeperType: 2 })).toMatchObject({
      leagueType: "dynasty",
      typeSource: "detected",
    });
    expect(detectLeagueType({ sleeperType: 1 })).toMatchObject({
      leagueType: "keeper",
      typeSource: "detected",
    });
    expect(detectLeagueType({ sleeperType: 0 })).toMatchObject({
      leagueType: "redraft",
      typeSource: "detected",
    });
  });

  it("infers dynasty from future picks even when Sleeper says redraft", () => {
    expect(detectLeagueType({ sleeperType: 0, hasFuturePicks: true })).toMatchObject({
      leagueType: "dynasty",
      typeSource: "inferred",
    });
  });

  it("reads ESPN keeper counts and prior seasons", () => {
    expect(detectLeagueType({ keeperCount: 2 })).toMatchObject({
      leagueType: "keeper",
      typeSource: "detected",
    });
    expect(detectLeagueType({ keeperCount: 20 })).toMatchObject({ leagueType: "dynasty" });
    expect(detectLeagueType({ previousSeasons: [2024, 2025] })).toMatchObject({
      leagueType: "keeper",
      typeSource: "inferred",
    });
  });

  it("reads Yahoo renewal", () => {
    expect(detectLeagueType({ yahooRenew: "399_12345" })).toMatchObject({
      leagueType: "keeper",
      typeSource: "detected",
    });
  });

  it("reads FFPC type text, Empire panel and Chop", () => {
    expect(
      detectLeagueType({ typeDescription: "Dynasty League", hasEmpirePanel: true }),
    ).toMatchObject({ leagueType: "dynasty", variant: "empire", typeSource: "detected" });
    expect(detectLeagueType({ typeDescription: "Chop League" })).toMatchObject({
      variant: "guillotine",
    });
  });

  it("infers guillotine from a shrinking league", () => {
    expect(detectLeagueType({ shrinkingTeamCount: true })).toMatchObject({
      variant: "guillotine",
      typeSource: "inferred",
    });
    expect(detectLeagueType({ rulesText: "the lowest scorer is eliminated" })).toMatchObject({
      variant: "guillotine",
    });
  });

  it("defaults to redraft", () => {
    expect(detectLeagueType({})).toEqual({
      leagueType: "redraft",
      variant: "none",
      typeSource: "inferred",
    });
  });
});

describe("typeSourceLabel", () => {
  it("names the platform when detected", () => {
    expect(typeSourceLabel("detected", "sleeper")).toBe("detected from Sleeper");
    expect(typeSourceLabel("user")).toBe("set by you");
    expect(typeSourceLabel("inferred")).toBe("inferred");
  });
});
