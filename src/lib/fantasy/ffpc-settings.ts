/**
 * Reads a FFPC league's playoff and rules settings off LeagueHome.aspx.
 *
 * Pure string work, no I/O, and every field degrades to null / empty rather
 * than throwing: a page whose markup changed must leave the stored settings
 * untouched, never overwrite them with nonsense.
 */

import { text, toNumber } from "./ffpc-parse";

export interface FfpcConsolationBracket {
  label: string;
  weeks: number[];
  prize: string | null;
}

export interface FfpcAllPlayWeek {
  week: number;
  rule: string;
}

export interface FfpcLeagueSettings {
  /** First playoff week, e.g. 15 for a 15–17 postseason. */
  playoffWeekStart: number | null;
  /** Every playoff week in order. */
  playoffWeeks: number[];
  playoffTeams: number | null;
  playoffByes: number | null;
  thirdPlaceGame: boolean;
  consolation: FfpcConsolationBracket[];
  allPlay: FfpcAllPlayWeek[];
  waiverType: "faab" | "waivers" | null;
  waiverRunTimes: string[];
  divisions: string[];
  playoffSeedType: "division_winners_first" | "overall" | null;
  usesVp: boolean;
}

const DAY_NAMES: Record<string, string> = {
  MON: "Mon", TUE: "Tue", TUES: "Tue", WED: "Wed", THU: "Thu", THUR: "Thu",
  THURS: "Thu", FRI: "Fri", SAT: "Sat", SUN: "Sun",
};

/** Contents of the div whose id ends with the given suffix. */
function divById(html: string, suffix: string): string | null {
  const open = new RegExp(`<div\\b[^>]*id="[^"]*${suffix}"[^>]*>`, "i");
  const match = html.match(open);
  if (!match || match.index === undefined) return null;
  let depth = 0;
  const re = /<div\b[^>]*>|<\/div>/gi;
  re.lastIndex = match.index;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[0].startsWith("</")) {
      depth -= 1;
      if (depth === 0) return html.slice(match.index + match[0].length, m.index);
    } else {
      depth += 1;
    }
  }
  return null;
}

function weeksFromHeaders(fragment: string): number[] {
  const headerRow = fragment.match(/<tr\b[^>]*>([\s\S]*?)<\/tr>/i)?.[1] ?? "";
  const weeks: number[] = [];
  const re = /<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi;
  let cell: RegExpExecArray | null;
  while ((cell = re.exec(headerRow))) {
    const week = text(cell[1] ?? "").match(/^Week\s*(\d{1,2})\b/i);
    if (week) weeks.push(Number(week[1]));
  }
  return [...new Set(weeks)].sort((a, b) => a - b);
}

/** Playoff weeks from the Championship Leaderboard column headers. */
function parsePlayoffWeeks(html: string): number[] {
  const at = html.search(/Championship\s+Leaderboard/i);
  if (at >= 0) {
    const weeks = weeksFromHeaders(html.slice(at));
    if (weeks.length) return weeks;
  }
  const spans = [...html.matchAll(/spn\w*(?:RoundOne|SemiFinals|Championship)Week[^>]*>\s*(\d{1,2})\s*</gi)]
    .map((m) => Number(m[1]))
    .filter((w) => w >= 1 && w <= 18);
  return [...new Set(spans)].sort((a, b) => a - b);
}

/**
 * The seeds shown against the standings rows are the projected playoff field.
 * FFPC ships every bracket layout in the page and shows one with JavaScript, so
 * the bracket that matches that field size is the league's real bracket.
 */
function parseBracket(html: string, playoffTeams: number | null) {
  const brackets = [...html.matchAll(/<div\b[^>]*id="[^"]*playoffs_(\d+)T(\d+)W"/gi)].map((m) => ({
    id: `playoffs_${m[1]}T${m[2]}W`,
    teams: Number(m[1]),
  }));
  const chosen =
    brackets.find((b) => playoffTeams != null && b.teams === playoffTeams) ??
    (brackets.length === 1 ? brackets[0] : undefined);
  if (!chosen) return { byes: null, thirdPlace: false, teams: playoffTeams };
  const fragment = divById(html, chosen.id);
  if (!fragment) return { byes: null, thirdPlace: false, teams: chosen.teams };
  const byes = (fragment.match(/>\s*BYE\s*</gi) ?? []).length;
  return {
    byes,
    thirdPlace: /3rd\s*Place/i.test(fragment),
    teams: chosen.teams,
  };
}

/** Consolation brackets: their label, the weeks they run, and what they win. */
function parseConsolation(html: string): FfpcConsolationBracket[] {
  const out: FfpcConsolationBracket[] = [];
  for (const m of html.matchAll(/<div\b[^>]*id="([^"]*Consolation[^"]*)"[^>]*>/gi)) {
    const id = m[1] ?? "";
    if (/menu|link|div[A-Z]/i.test(id) && !/Playoffs/i.test(id)) continue;
    const fragment = divById(html, id);
    if (!fragment || !/<table\b/i.test(fragment)) continue;
    const headerRow = fragment.match(/<tr\b[^>]*>([\s\S]*?)<\/tr>/i)?.[1] ?? "";
    const headerCells = [...headerRow.matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) =>
      text(c[1] ?? ""),
    );
    const weeks = weeksFromHeaders(fragment);
    const labels = headerCells
      .map((cell) => cell.replace(/^Week\s*\d{1,2}\s*/i, "").trim())
      .filter((cell) => cell && !/^Team$/i.test(cell));
    const label = labels.find((l) => /playoff|consolation|toilet|pick/i.test(l)) ?? "Consolation";
    const prize = labels[labels.length - 1] ?? null;
    out.push({ label, weeks, prize: prize && prize !== label ? prize : null });
  }
  return out;
}

/** "All-Play Week: top 6 scoring teams in W6 get a win..." */
export function parseAllPlay(html: string): FfpcAllPlayWeek[] {
  const flat = text(html);
  const out: FfpcAllPlayWeek[] = [];
  for (const m of flat.matchAll(
    /All[\s-]?Play\s*Week[^.]*?\bW(?:eek)?\s*(\d{1,2})\b[^.]*\./gi,
  )) {
    const week = Number(m[1]);
    if (week >= 1 && week <= 18 && !out.some((a) => a.week === week)) {
      out.push({ week, rule: "top half win, bottom half lose" });
    }
  }
  return out;
}

/** "Acquisitions: Free Agent Auction Bidding (WED, SUN @10:00PM ET)" */
export function parseAcquisitions(html: string): {
  waiverType: "faab" | "waivers" | null;
  runTimes: string[];
} {
  const flat = text(html);
  const line = flat.match(/Acquisitions:\s*([^|]{0,120}?)(?:\s{2,}|$|Commissioner|Teams:)/i)?.[1] ?? "";
  if (!line) return { waiverType: null, runTimes: [] };
  const waiverType = /auction|bidding|faab|blind bid/i.test(line)
    ? "faab"
    : /waiver/i.test(line)
      ? "waivers"
      : null;
  const inside = line.match(/\(([^)]*)\)/)?.[1] ?? "";
  const time = inside.match(/@?\s*(\d{1,2}(?::\d{2})?\s*(?:AM|PM))\s*([A-Z]{2,3})?/i);
  const clock = time ? `${(time[1] ?? "").toUpperCase().replace(/\s+/g, "")}${time[2] ? ` ${time[2].toUpperCase()}` : ""}` : "";
  const runTimes: string[] = [];
  for (const day of inside.match(/\b(MON|TUES?|WED|THURS?|FRI|SAT|SUN)\b/gi) ?? []) {
    const name = DAY_NAMES[day.toUpperCase()] ?? day;
    runTimes.push(clock ? `${name} ${clock}` : name);
  }
  return { waiverType, runTimes };
}

/** Division headings in the standings table. */
function parseDivisions(html: string): string[] {
  const found = new Set<string>();
  for (const m of html.matchAll(/<td\b[^>]*colspan="\d+"[^>]*>([\s\S]*?)<\/td>/gi)) {
    const label = text(m[1] ?? "");
    if (/^Division\b/i.test(label) || /^Conference\b/i.test(label)) found.add(label);
  }
  return [...found];
}

export function parseLeagueSettings(html: string): FfpcLeagueSettings {
  const playoffWeeks = parsePlayoffWeeks(html);
  const seeds = [...html.matchAll(/playoffsSeeding[^>]*>\s*#?(\d{1,2})/gi)].map((m) =>
    toNumber(m[1]),
  );
  const seededTeams = seeds.length ? new Set(seeds).size : null;
  const bracket = parseBracket(html, seededTeams);
  const divisions = parseDivisions(html);
  const acquisitions = parseAcquisitions(html);

  return {
    playoffWeekStart: playoffWeeks[0] ?? null,
    playoffWeeks,
    playoffTeams: seededTeams ?? bracket.teams ?? null,
    playoffByes: bracket.byes,
    thirdPlaceGame: bracket.thirdPlace,
    consolation: parseConsolation(html),
    allPlay: parseAllPlay(html),
    waiverType: acquisitions.waiverType,
    waiverRunTimes: acquisitions.runTimes,
    divisions,
    playoffSeedType: divisions.length ? "division_winners_first" : "overall",
    usesVp: /Season\s*VP/i.test(html),
  };
}
