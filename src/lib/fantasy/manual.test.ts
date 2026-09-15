import { describe, expect, it } from "vitest";

import { generateSchedule, parsePlayerLine, parseSchedule, parseTransactionLog } from "./manual.server";
import { manualFreshness } from "./manual-types";

describe("parsePlayerLine", () => {
  it("reads a pick with a parenthesised position and team", () => {
    expect(parsePlayerLine("1.01 Ja'Marr Chase (WR - CIN)")).toEqual({
      name: "Ja'Marr Chase",
      position: "WR",
      nflTeam: "CIN",
    });
  });

  it("reads bare trailing tokens", () => {
    expect(parsePlayerLine("Bijan Robinson RB ATL")).toEqual({
      name: "Bijan Robinson",
      position: "RB",
      nflTeam: "ATL",
    });
  });

  it("keeps generational suffixes in the name", () => {
    expect(parsePlayerLine("12. Marvin Harrison Jr. (WR - ARI)")?.name).toBe("Marvin Harrison Jr.");
  });

  it("ignores lines with no player", () => {
    expect(parsePlayerLine("Round 3")).not.toBeNull();
    expect(parsePlayerLine("   ")).toBeNull();
  });
});

describe("generateSchedule", () => {
  it("pairs every team once a week", () => {
    const games = generateSchedule(["a", "b", "c", "d"], 3);
    expect(games).toHaveLength(6);
    const week1 = games.filter((g) => g.week === 1);
    expect(new Set(week1.flatMap((g) => [g.home, g.away])).size).toBe(4);
  });

  it("skips the odd team out", () => {
    const games = generateSchedule(["a", "b", "c"], 1);
    expect(games).toHaveLength(1);
  });
});

describe("parseSchedule", () => {
  it("reads week headings and inline weeks", () => {
    const games = parseSchedule("Week 2:\nTeam A vs Team B\nWeek 3: Team C @ Team D", [
      "Team A",
      "Team B",
      "Team C",
      "Team D",
    ]);
    expect(games).toEqual([
      { week: 2, home: "Team A", away: "Team B" },
      { week: 3, home: "Team C", away: "Team D" },
    ]);
  });
});

describe("parseTransactionLog", () => {
  it("reads adds and drops with a stable dedupe key", () => {
    const rows = parseTransactionLog(
      "2026-09-10 Team A added Jaylen Warren RB PIT\n2026-09-10 Team A dropped Tyjae Spears",
      ["Team A"],
    );
    expect(rows.map((r) => r.kind)).toEqual(["add", "drop"]);
    expect(rows[0]!.dedupeKey).toBe("2026-09-10|add|jaylen warren");
    expect(rows[0]!.toTeam).toBe("Team A");
    expect(rows[1]!.fromTeam).toBe("Team A");
  });
});

describe("manualFreshness", () => {
  const now = new Date("2026-09-15T12:00:00Z");
  it("grades by how long ago the rosters were confirmed", () => {
    expect(manualFreshness("2026-09-14T12:00:00Z", now).state).toBe("synced");
    expect(manualFreshness("2026-09-09T12:00:00Z", now).state).toBe("tracking");
    expect(manualFreshness("2026-08-20T12:00:00Z", now).state).toBe("stale");
    expect(manualFreshness(null, now).state).toBe("stale");
  });
});
