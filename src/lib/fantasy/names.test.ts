import { describe, expect, it } from "vitest";
import { normalizeName, playerKey, playerIndex } from "./names";

const same = (a: string, b: string) => expect(normalizeName(a)).toBe(normalizeName(b));

describe("normalizeName", () => {
  it("drops generational suffixes", () => {
    same("Kenneth Walker III", "Kenneth Walker");
    same("Marvin Harrison Jr.", "Marvin Harrison");
    same("Michael Pittman Jr", "Michael Pittman");
    same("Odell Beckham Jr.", "Odell Beckham");
    same("Deebo Samuel Sr.", "Deebo Samuel");
    same("Walker, III", "Walker");
    same("Robert Griffin IV", "Robert Griffin");
  });

  it("handles stacked and numeric suffixes", () => {
    same("Bob Smith Jr II", "Bob Smith");
    same("Bob Smith 3rd", "Bob Smith III");
  });

  it("ignores punctuation, hyphens and accents", () => {
    same("Amon-Ra St. Brown", "Amon Ra St Brown");
    same("A.J. Brown", "AJ Brown");
    same("Ja'Marr Chase", "JaMarr Chase");
  });

  it("folds defense spellings", () => {
    same("Ravens D/ST", "Ravens DST");
    same("Ravens Defense", "Ravens DST");
  });

  it("never collapses different players", () => {
    expect(normalizeName("Josh Allen")).not.toBe(normalizeName("Keenan Allen"));
    expect(normalizeName("Michael Carter")).not.toBe(normalizeName("Michael Carter II Jets"));
  });
});

describe("playerKey / playerIndex", () => {
  it("folds equivalent position labels", () => {
    expect(playerKey("Ravens DST", "DST")).toBe(playerKey("Ravens D/ST", "DEF"));
    expect(playerKey("Justin Tucker", "PK")).toBe(playerKey("Justin Tucker", "K"));
  });

  it("finds a player whichever spelling the feed used", () => {
    const idx = playerIndex([
      { full_name: "Kenneth Walker III", position: "RB" },
      { full_name: "Marvin Harrison Jr.", position: "WR" },
    ]);
    expect(idx.find("Kenneth Walker", "RB")?.full_name).toBe("Kenneth Walker III");
    expect(idx.find("Marvin Harrison", "WR")?.full_name).toBe("Marvin Harrison Jr.");
    expect(idx.find("Nobody Here", "WR")).toBeNull();
  });
});
