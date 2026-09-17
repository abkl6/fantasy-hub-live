import { describe, expect, it } from "vitest";

import { detectSite, groupByTournament, parseBestballCsv } from "./bestball-parse";
import { leagueScoring } from "./scoring";
import { BESTBALL_SLOTS } from "./bestball";
import { optimalLineup } from "./engine";

const underdog = [
  "draft_id,draft_entry_id,tournament_title,pick_order,overall_pick_number,first_name,last_name,position,team",
  "d1,e1,Best Ball Mania,3,1,Ja'Marr,Chase,WR,CIN",
  "d1,e1,Best Ball Mania,3,2,Josh,Allen,QB,BUF",
  "d1,e1,Best Ball Mania,3,3,Bijan,Robinson,RB,ATL",
  "d2,e2,Best Ball Mania,7,1,Justin,Jefferson,WR,MIN",
  "d3,e3,Puppy,1,1,Brock,Bowers,TE,LV",
].join("\n");

const draftkings = [
  "Contest Name,Entry Key,Draft Position,Pick,Player Name,Position,Team",
  "Millionaire,101,4,1,Saquon Barkley,RB,PHI",
  "Millionaire,101,4,2,CeeDee Lamb,WR,DAL",
  "Millionaire,102,9,1,Amon-Ra St. Brown,WR,DET",
].join("\n");

describe("best ball entries export", () => {
  it("reads an Underdog export into one entry per draft", () => {
    const parsed = parseBestballCsv(underdog);
    expect(parsed.site).toBe("underdog");
    expect(parsed.entries).toHaveLength(3);
    const first = parsed.entries[0]!;
    expect(first.entryId).toBe("e1");
    expect(first.draftSlot).toBe(3);
    expect(first.players.map((p) => p.name)).toEqual([
      "Ja'Marr Chase",
      "Josh Allen",
      "Bijan Robinson",
    ]);
    expect(groupByTournament(parsed.entries).get("Best Ball Mania")).toHaveLength(2);
  });

  it("reads a DraftKings export when the site is given", () => {
    expect(detectSite(["Contest Name", "Entry Key"])).toBe("draftkings");
    const parsed = parseBestballCsv(draftkings, "draftkings");
    expect(parsed.site).toBe("draftkings");
    expect(parsed.entries).toHaveLength(2);
    expect(parsed.entries[0]!.players[0]).toMatchObject({
      name: "Saquon Barkley",
      position: "RB",
      nflTeam: "PHI",
    });
  });

  it("rejects a file that is not an entries export", () => {
    expect(() => parseBestballCsv("a,b\n1,2")).toThrow();
  });
});

describe("best ball scoring", () => {
  const line = { rec: 8, rec_yd: 120, rec_td: 1 };

  it("scores Underdog at half a point a catch and DraftKings at a full point", () => {
    const ud = leagueScoring("underdog", null);
    const dk = leagueScoring("draftkings", null);
    expect(ud.score("WR", line)).toBeCloseTo(0.5 * 8 + 12 + 6, 5);
    // DraftKings adds a three-point bonus for 100 receiving yards.
    expect(dk.score("WR", line)).toBeCloseTo(8 + 12 + 6 + 3, 5);
  });

  it("starts the best eight of a best ball roster", () => {
    const roster = [
      { id: null, name: "QB1", position: "QB", proj: 20 },
      { id: null, name: "QB2", position: "QB", proj: 25 },
      { id: null, name: "RB1", position: "RB", proj: 18 },
      { id: null, name: "RB2", position: "RB", proj: 12 },
      { id: null, name: "RB3", position: "RB", proj: 11 },
      { id: null, name: "WR1", position: "WR", proj: 22 },
      { id: null, name: "WR2", position: "WR", proj: 15 },
      { id: null, name: "WR3", position: "WR", proj: 9 },
      { id: null, name: "TE1", position: "TE", proj: 7 },
    ];
    const best = optimalLineup(roster, BESTBALL_SLOTS);
    expect(best.starters).toHaveLength(8);
    // The better quarterback starts and the flex takes the best leftover.
    const names = best.starters.map((s) => s.player?.name);
    expect(names).toContain("QB2");
    expect(names).not.toContain("QB1");
    expect(names).toContain("RB2");
    expect(best.total).toBeCloseTo(25 + 18 + 12 + 22 + 15 + 9 + 7 + 11, 5);
  });
});
