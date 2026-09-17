import { describe, expect, it } from "vitest";

import { eligiblePositions } from "./eligibility";
import { optimalLineup, type EnginePlayer } from "./engine";
import { parseRosterSlots } from "./ffpc-parse";
import {
  ESPN_SLOT_IDS,
  expandSlots,
  filterSlotCodesByObserved,
  inferEligibility,
  positionsFromSlots,
  resolvedKey,
  slotsFromCodes,
  type LeagueSlot,
} from "./slots";

function keys(slots: LeagueSlot[]): string[] {
  return expandSlots(slots).map(resolvedKey);
}

function player(name: string, position: string, proj: number): EnginePlayer {
  return { id: name, name, position, proj };
}

/** A deep enough bench that any legal lineup can be filled. */
function squad(): EnginePlayer[] {
  const out: EnginePlayer[] = [];
  const positions = ["QB", "RB", "WR", "TE", "K", "DEF", "DL", "LB", "DB"];
  for (const pos of positions) {
    for (let i = 1; i <= 6; i += 1) out.push(player(`${pos}${i}`, pos, 20 - i));
  }
  return out;
}

const STRUCTURES: Record<string, string[]> = {
  standard: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF"],
  superflex: ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "SUPER_FLEX"],
  triFlex: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "FLEX", "FLEX"],
  twoSuperflex: ["QB", "RB", "RB", "WR", "WR", "SUPER_FLEX", "SUPER_FLEX"],
  noTe: ["QB", "RB", "RB", "WR", "WR", "WR", "FLEX", "K", "DEF"],
  tePremium: ["QB", "RB", "RB", "WR", "WR", "TE", "REC_FLEX", "K", "DEF"],
  idp: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "DL", "LB", "DB", "IDP_FLEX"],
  ffpcTwoFlex: ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "FLEX", "K", "DEF"],
};

describe("league slot structures", () => {
  for (const [name, codes] of Object.entries(STRUCTURES)) {
    it(`${name}: fills every spot with an eligible player`, () => {
      const slots = slotsFromCodes(codes);
      const lineup = optimalLineup(squad(), keys(slots));
      expect(lineup.starters).toHaveLength(codes.length);
      for (const { slot, player: chosen } of lineup.starters) {
        expect(chosen, `${name} left ${slot} empty`).not.toBeNull();
        const allowed = slots.find((s) => resolvedKey(s) === slot)!.eligible;
        expect(allowed).toContain(chosen!.position);
      }
    });
  }

  it("a superflex league exposes no kicker, defence or defensive player", () => {
    const slots = slotsFromCodes(["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "SUPER_FLEX"]);
    const positions = positionsFromSlots(slots);
    for (const hidden of ["K", "DEF", "DL", "LB", "DB"]) {
      expect(positions).not.toContain(hidden);
    }
    expect(positions).toEqual(expect.arrayContaining(["QB", "RB", "WR", "TE"]));
  });

  it("an IDP flex exposes DL, LB and DB", () => {
    const positions = positionsFromSlots(slotsFromCodes(["QB", "RB", "WR", "IDP_FLEX"]));
    expect(positions).toEqual(expect.arrayContaining(["DL", "LB", "DB"]));
  });

  it("counts repeated codes rather than listing them twice", () => {
    const slots = slotsFromCodes(["QB", "RB", "RB", "FLEX", "FLEX", "FLEX"]);
    expect(slots.find((s) => s.key === "RB")!.count).toBe(2);
    expect(slots.find((s) => s.key === "FLEX")!.count).toBe(3);
  });

  it("reads ESPN slot numbers and Yahoo slot codes", () => {
    expect(ESPN_SLOT_IDS[23]).toBe("FLEX");
    const espn = slotsFromCodes([0, 2, 2, 4, 4, 6, 23, 17, 16, 20]);
    expect(keys(espn)).toEqual(["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF"]);
    const yahoo = slotsFromCodes(["QB", "W/R/T", "Q/W/R/T", "D/ST"]);
    expect(keys(yahoo)).toEqual(["QB", "FLEX", "SUPER_FLEX", "DEF"]);
  });

  it("keeps a custom spot's own position list", () => {
    const slots = slotsFromCodes(["FLEX (WR/TE)"]);
    expect(slots[0]!.eligible).toEqual(["WR", "TE"]);
    expect(eligiblePositions(["FLEX (WR/TE)"])).toEqual(["WR", "TE"]);
    const lineup = optimalLineup(squad(), keys(slots));
    expect(["WR", "TE"]).toContain(lineup.starters[0]!.player!.position);
  });

  it("infers a spot's positions from what teams have started there", () => {
    expect(inferEligibility(["RB", "WR", "WR", "TE", "RB"])).toEqual(
      expect.arrayContaining(["RB", "WR", "TE"]),
    );
    expect(inferEligibility([])).toEqual([]);
  });
});

describe("FFPC rules page", () => {
  const html = `
    <table>
      <tr><th>Position</th><th>Starters</th></tr>
      <tr><td>QB</td><td>1</td></tr>
      <tr><td>RB</td><td>2</td></tr>
      <tr><td>WR</td><td>3</td></tr>
      <tr><td>TE</td><td>1</td></tr>
      <tr><td>FLEX (RB/WR/TE)</td><td>2</td></tr>
      <tr><td>PK</td><td>1</td></tr>
      <tr><td>D/ST</td><td>1</td></tr>
    </table>`;

  it("sets eligibility from the roster slot list", () => {
    const codes = parseRosterSlots(html);
    const slots = slotsFromCodes(codes);
    expect(slots.find((s) => s.key === "FLEX")!.count).toBe(2);
    expect(slots.find((s) => s.key === "FLEX")!.eligible).toEqual(["RB", "WR", "TE"]);
    expect(positionsFromSlots(slots)).toEqual(["QB", "RB", "WR", "TE", "K", "DEF"]);
    expect(keys(slots)).toHaveLength(11);
  });
});

describe("leagues that do not start a kicker or defence", () => {
  const typical = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "TE", "FLEX", "K", "DEF"];

  function rosterPositions(teams: number, perTeam: string[]): string[] {
    const out: string[] = [];
    for (let t = 0; t < teams; t += 1) out.push(...perTeam);
    return out;
  }

  it("drops K and DEF when nobody rosters them", () => {
    const observed = rosterPositions(18, ["QB", "QB", "RB", "RB", "RB", "WR", "WR", "WR", "TE"]);
    const codes = filterSlotCodesByObserved(typical, observed, 18);
    expect(codes).toEqual(["QB", "RB", "RB", "WR", "WR", "WR", "TE", "TE", "FLEX"]);
    const slots = slotsFromCodes(codes);
    expect(positionsFromSlots(slots)).toEqual(["QB", "RB", "WR", "TE"]);
    expect(positionsFromSlots(slots)).not.toContain("K");
    expect(positionsFromSlots(slots)).not.toContain("DEF");
  });

  it("keeps K and DEF when teams really do roster them", () => {
    const observed = rosterPositions(12, ["QB", "RB", "RB", "WR", "WR", "TE", "K", "DEF"]);
    expect(filterSlotCodesByObserved(typical, observed, 12)).toEqual(typical);
  });

  it("keeps the standard lineup when no rosters are known yet", () => {
    expect(filterSlotCodesByObserved(typical, [], 12)).toEqual(typical);
  });

  it("reads a sentence-style FFPC starting lineup", () => {
    const html = `<div><p>Starting Lineup: 1 QB, 2 RB, 3 WR, 2 TE, 1 FLEX (RB/WR/TE)</p></div>`;
    const codes = parseRosterSlots(html);
    const slots = slotsFromCodes(codes);
    expect(codes).toHaveLength(9);
    expect(slots.find((s) => s.key === "WR")!.count).toBe(3);
    expect(slots.find((s) => s.key === "FLEX")!.eligible).toEqual(["RB", "WR", "TE"]);
    expect(positionsFromSlots(slots)).toEqual(["QB", "RB", "WR", "TE"]);
  });
});
