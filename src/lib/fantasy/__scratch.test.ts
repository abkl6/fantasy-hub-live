import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { parseLeagueSettings } from "@/lib/fantasy/ffpc-settings";
test("settings", () => {
  const html = readFileSync("src/lib/fantasy/ffpc/__fixtures__/league-home.html", "utf8");
  console.log(JSON.stringify(parseLeagueSettings(html), null, 1));
  expect(1).toBe(1);
});
