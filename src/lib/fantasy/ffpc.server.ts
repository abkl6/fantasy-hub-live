/**
 * FFPC (myffpc.com) adapter. Server-only.
 *
 * FFPC publishes no API, so a league is read from its own web pages using the
 * private `ltuid` token out of any league URL the manager pastes. That token is
 * the credential: it is stored encrypted, never returned to the browser, and
 * never written to a log or an error message.
 *
 * Every parser is tolerant. When a page's markup changes the adapter reports a
 * parse failure so the caller can keep the last-good data and pause syncing
 * rather than overwrite a league with garbage.
 */

import {
  columnIndex,
  detectAllPlayWeeks,
  detectVictoryPoints,
  findTable,
  idFromLinks,
  parsePlayerCell,
  text,
  toNumber,
  type FfpcPlayer,
  type HtmlTable,
} from "./ffpc-parse";
import { normalizeName } from "./names";

const HOST = "https://myffpc.com";

/** Identifies this app to FFPC, as their terms expect of any automated reader. */
const USER_AGENT =
  "GridironEdge/1.0 (+https://gridiron-edge.lovable.app; league sync on behalf of the account owner)";

/** One request per second per host, shared by every concurrent import. */
let nextSlot = 0;
async function throttle() {
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + 1000;
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

export class FfpcParseError extends Error {
  constructor(
    public page: string,
    message: string,
  ) {
    super(message);
    this.name = "FfpcParseError";
  }
}

async function getPage(
  page: string,
  ltuid: string,
  params: Record<string, string | number> = {},
): Promise<string> {
  await throttle();
  const url = new URL(`${HOST}/${page}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  url.searchParams.set("ltuid", ltuid);

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml",
        cookie: `ltuid=${ltuid}`,
      },
      redirect: "follow",
    });
  } catch {
    // Never echo the URL: it carries the private token.
    throw new FfpcParseError(page, `FFPC did not answer while loading ${page}.`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new FfpcParseError(page, "FFPC rejected the saved link. Paste a fresh league URL.");
  }
  if (!res.ok) throw new FfpcParseError(page, `FFPC returned ${res.status} for ${page}.`);

  const html = await res.text();
  if (/sign\s*in|log\s*in to continue|session (has )?expired/i.test(html.slice(0, 4000)) && !/leaguehome/i.test(html)) {
    throw new FfpcParseError(page, "That FFPC link has expired. Paste a fresh league URL.");
  }
  return html;
}

// ---------------------------------------------------------------- types

export interface FfpcRosterEntry {
  name: string;
  position: string;
  nflTeam: string | null;
  slot: string;
  isStarter: boolean;
}

export interface FfpcTeam {
  externalId: string;
  name: string;
  ownerName: string | null;
  isMine: boolean;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  vp: number;
  division: string | null;
  playoffSeed: number | null;
  faabRemaining: number | null;
  roster: FfpcRosterEntry[];
}

export interface FfpcTransaction {
  date: string | null;
  teamName: string | null;
  kind: string;
  detail: string;
  bid: number | null;
  teamExternalId: string | null;
  addedPlayer: FfpcPlayer | null;
  droppedPlayer: FfpcPlayer | null;
}

export interface FfpcDraftPick {
  round: number;
  pick: number;
  teamExternalId: string | null;
  teamName: string | null;
  playerName: string | null;
}

export interface FfpcFuturePick {
  season: number;
  round: number;
  originalTeamName: string | null;
  ownedByExternalId: string | null;
}

export interface FfpcScoreboardTeam {
  externalId: string | null;
  name: string;
  score: number;
  projected: number;
  inPlay: number;
  yetToPlay: number;
}

export interface FfpcLeagueBundle {
  externalId: string;
  name: string;
  leagueType: string;
  /** FFPC shows an Empire Details panel on empire leagues. */
  hasEmpirePanel: boolean;
  /** Best ball: no opponents, no lineups to set, ranked on total points. */
  isBestBall: boolean;
  season: number;
  currentWeek: number;
  teamCount: number;
  playoffTeams: number;
  regularSeasonWeeks: number;
  scoringType: string;
  scoringRules: Record<string, number>;
  rosterSlots: string[];
  contestFormat: "h2h" | "points" | "hybrid" | "vp";
  allPlayWeeks: number[];
  faabBudget: number;
  myTeamExternalId: string | null;
  teams: FfpcTeam[];
  schedule: {
    week: number;
    homeExternalId: string | null;
    awayExternalId: string | null;
    homeScore: number;
    awayScore: number;
    isFinal: boolean;
  }[];
  transactions: FfpcTransaction[];
  draft: FfpcDraftPick[];
  futurePicks: FfpcFuturePick[];
  scoreboard: FfpcScoreboardTeam[];
}

// ---------------------------------------------------------------- pages

/** Standings, my team, schedule, roster, FAAB, VP and all-play detection. */
export function parseLeagueHome(html: string, leagueId: string) {
  const flat = text(html);
  const infoMatch = html.match(
    /League\s*ID\s*:\s*(\d+)[\s\S]*?League\s*Type\s*Description\s*:\s*([^<]+)[\s\S]*?Team\s*ID\s*:\s*(\d+)/i,
  );
  const infoEnd = infoMatch ? (infoMatch.index ?? 0) + infoMatch[0].length : 0;
  const nameMatch = html.slice(infoEnd).match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i);
  const name = text(nameMatch?.[1] ?? "");
  const selectedSeason = html.match(
    /<select\b[^>]*>[^]*?<option\b[^>]*selected(?:=["'][^"']*["'])?[^>]*value=["'](20\d{2})["']/i,
  ) ?? html.match(/Season\s*:\s*\*\s*(20\d{2})/i);
  const weekMatch = html.match(
    /NFLScoreboardDiv[\s\S]*?upNFLSchedule[\s\S]*?Week(?:&nbsp;|\s)*(\d{1,2})/i,
  );

  // Best ball leagues have no head-to-head record: their standings are a
  // Team | Pts table and there is no weekly opponent anywhere on the page.
  const isBestBall = /best\s*ball/i.test(text(infoMatch?.[2] ?? ""));

  const standings =
    findTable(html, "team", "pts") ??
    findTable(html, "team", "points") ??
    findTable(html, "team", "record") ??
    findTable(html, "standings");

  const teams: FfpcTeam[] = [];
  if (standings) {
    const usesVp = standings.headers.some((header) => /season\s*vp/i.test(header));
    // A record table has its own W column; a points-only table does not.
    const usesRecord = standings.headers.some((header) => /^w$/i.test(header.trim()));
    let division: string | null = null;

    for (let i = 0; i < standings.rows.length; i++) {
      const row = standings.rows[i] ?? [];
      const raw = standings.rawRows[i] ?? [];
      const first = (row[0] ?? "").trim();
      if (row.length === 1 && /^Division\s+\d+/i.test(first)) {
        division = first;
        continue;
      }
      if (!first || /^#|^total/i.test(first)) continue;
      if (row.length < (usesRecord ? 7 : 2)) continue;
      const seedMatch = first.match(/\s+#(\d+)\s*$/);
      const teamName = first.replace(/\s+#\d+\s*$/, "").trim();
      const externalId =
        (raw[0] ?? "").match(/teamRoster_[0-9]+_([0-9]+)/i)?.[1] ??
        idFromLinks(raw[0] ?? "", "viewingTeam", "teamID", "teamid");
      if (!externalId) continue;

      teams.push({
        externalId,
        name: teamName,
        ownerName: null,
        isMine: externalId === (infoMatch?.[3] ?? null),
        wins: usesRecord ? toNumber(row[1]) : 0,
        losses: usesRecord ? toNumber(row[2]) : 0,
        ties: usesRecord ? toNumber(row[3]) : 0,
        pointsFor: usesRecord ? toNumber(row[usesVp ? 5 : 4]) : toNumber(row[1]),
        pointsAgainst: usesRecord ? toNumber(row[usesVp ? 6 : 5]) : 0,
        vp: usesRecord && usesVp ? toNumber(row[4]) : 0,
        division,
        playoffSeed: seedMatch ? Number(seedMatch[1]) : null,
        faabRemaining: null,
        roster: [],
      });
    }
  }

  const myTeamExternalId = infoMatch?.[3] ?? null;

  const faabMatch = flat.match(/Remaining FAAB Dollars:\s*\$([0-9,]+(?:\.\d+)?)/i);
  const budgetMatch = flat.match(/(?:faab budget|starting budget)[^0-9$]*\$?([0-9,]+)/i);

  // My schedule: the home page lists every week's opponent with a viewingTeam link.
  const scheduleTable =
    findTable(html, "week", "opponent") ?? findTable(html, "week", "result");
  const mySchedule: { week: number; opponentExternalId: string | null; homeTeamExternalId: string | null; myScore: number; oppScore: number; isFinal: boolean }[] =
    [];
  if (scheduleTable) {
    const cWeek = Math.max(0, columnIndex(scheduleTable, "week"));
    const cOpp = columnIndex(scheduleTable, "opponent");
    const cScore = columnIndex(scheduleTable, "score", "result");
    for (let i = 0; i < scheduleTable.rows.length; i++) {
      const row = scheduleTable.rows[i] ?? [];
      const raw = scheduleTable.rawRows[i] ?? [];
      const week = toNumber(row[cWeek]);
      if (!week) continue;
      const result = row[cScore] ?? "";
      const resultMatch = result.match(/^\s*([WLT])\s+(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)/i);
      const viewCell = raw.find((cell) => /homeTeamID=/i.test(cell)) ?? "";
      mySchedule.push({
        week,
        opponentExternalId: cOpp >= 0 ? idFromLinks(raw[cOpp] ?? "", "viewingTeam", "teamID") : null,
        homeTeamExternalId: idFromLinks(viewCell, "homeTeamID"),
        myScore: toNumber(resultMatch?.[2]),
        oppScore: toNumber(resultMatch?.[3]),
        isFinal: Boolean(resultMatch && !(resultMatch[1] === "T" && toNumber(resultMatch[2]) === 0 && toNumber(resultMatch[3]) === 0)),
      });
    }
  }

  const myRoster = parseRosterTable(findTable(html, "slot", "player", "pos", "bye"));

  return {
    name: name || `FFPC league ${leagueId}`,
    leagueType: text(infoMatch?.[2] ?? "") || "FFPC",
    isBestBall,
    hasEmpirePanel: /empire\s*details/i.test(html),
    season: selectedSeason ? Number(selectedSeason[1]) : new Date().getFullYear(),
    currentWeek: weekMatch ? Number(weekMatch[1]) : 1,
    teams,
    myTeamExternalId,
    faabRemaining: faabMatch ? toNumber(faabMatch[1]) : null,
    faabBudget: budgetMatch ? toNumber(budgetMatch[1]) : 1000,
    usesVp: standings?.headers.some((header) => /season\s*vp/i.test(header)) ?? detectVictoryPoints(html),
    allPlayWeeks: detectAllPlayWeeks(html),
    mySchedule,
    myRoster,
  };
}

/** leagueRulesFFPC.aspx — roster slots and the scoring table. */
function parseRules(html: string) {
  const flat = text(html);
  const rosterSlots: string[] = [];
  const slotTable = findTable(html, "position", "starters") ?? findTable(html, "position", "start");
  if (slotTable) {
    const cPos = Math.max(0, columnIndex(slotTable, "position"));
    const cCount = columnIndex(slotTable, "starters", "start", "number");
    for (const row of slotTable.rows) {
      const pos = (row[cPos] ?? "").toUpperCase().replace(/[^A-Z/]/g, "");
      const count = cCount >= 0 ? toNumber(row[cCount]) : 0;
      if (!pos || count <= 0) continue;
      const slot = pos === "D/ST" || pos === "DST" ? "DEF" : pos === "PK" ? "K" : pos;
      for (let i = 0; i < Math.min(count, 6); i++) rosterSlots.push(slot);
    }
  }

  const scoringRules: Record<string, number> = {};
  const scoringTable = findTable(html, "scoring") ?? findTable(html, "category", "points");
  if (scoringTable) {
    for (const row of scoringTable.rows) {
      const label = (row[0] ?? "").toLowerCase();
      const value = toNumber(row[row.length - 1]);
      if (!label || !value) continue;
      if (/receptions?\b/.test(label) && /te/.test(label)) scoringRules["rec_te"] = value;
      else if (/receptions?\b/.test(label)) scoringRules["rec"] = value;
      else if (/passing yards?/.test(label)) scoringRules["pass_yd"] = value;
      else if (/passing td/.test(label)) scoringRules["pass_td"] = value;
      else if (/rushing yards?/.test(label)) scoringRules["rush_yd"] = value;
      else if (/rushing td/.test(label)) scoringRules["rush_td"] = value;
      else if (/receiving yards?/.test(label)) scoringRules["rec_yd"] = value;
      else if (/receiving td/.test(label)) scoringRules["rec_td"] = value;
      else if (/interception/.test(label)) scoringRules["pass_int"] = value;
      else if (/fumble/.test(label)) scoringRules["fum_lost"] = value;
    }
  }

  const tePremium = /tight end premium|te premium|1\.5\s*(?:points?|pts)?\s*per reception/i.test(flat);
  const playoffMatch = flat.match(/(\d{1,2})\s*teams?\s*(?:make|qualify for)\s*the\s*playoffs?/i);
  const weeksMatch = flat.match(/regular season[^.]*?week\s*(\d{1,2})/i);

  return {
    rosterSlots,
    scoringRules,
    scoringType: tePremium ? "te_premium" : scoringRules["rec"] ? "ppr" : "standard",
    playoffTeams: playoffMatch ? Number(playoffMatch[1]) : 0,
    regularSeasonWeeks: weeksMatch ? Number(weeksMatch[1]) : 0,
  };
}

export function parseRosterTable(table: HtmlTable | null): FfpcRosterEntry[] {
  if (!table) return [];
  const cSlot = columnIndex(table, "slot", "pos", "position", "lineup");
  const cPlayer = columnIndex(table, "player", "name");
  const out: FfpcRosterEntry[] = [];
  for (const row of table.rows) {
    const playerColumn = cPlayer >= 0 ? cPlayer : 1;
    const playerHtml = table.rawRows[table.rows.indexOf(row)]?.[playerColumn] ?? "";
    const focused = playerHtml.match(/<(?:b|a)\b[^>]*>([\s\S]*?)<\/(?:b|a)>/i)?.[1];
    const playerCell = text(focused ?? row[playerColumn] ?? row[0] ?? "");
    const player = parsePlayerCell(playerCell);
    if (!player) continue;
    const listedPosition = cSlot >= 0 && table.headers.some((header) => /^pos$/i.test(header))
      ? (row[columnIndex(table, "pos")] ?? player.position)
      : player.position;
    const slotRaw = (cSlot >= 0 ? (row[cSlot] ?? "") : "").toUpperCase().trim();
    const slot = slotRaw.replace(/[^A-Z0-9/]/g, "") || player.position;
    const isStarter = !/^(BN|BE|BENCH|IR|TAXI|RES)/.test(slot);
    out.push({
      name: player.name,
      position: listedPosition.toUpperCase() === "PK" ? "K" : listedPosition.toUpperCase() === "DST" ? "DEF" : listedPosition,
      nflTeam: player.nflTeam,
      slot: slot === "BE" ? "BN" : slot,
      isStarter,
    });
  }
  return out;
}

/** Rosters.aspx lists one team per row and one position per column. */
export function parseAllRosters(html: string): Map<string, FfpcRosterEntry[]> {
  const byTeam = new Map<string, FfpcRosterEntry[]>();
  const table = findTable(html, "team", "qb", "rb", "wr", "te");
  if (!table) return byTeam;
  for (let rowIndex = 0; rowIndex < table.rows.length; rowIndex++) {
    const raw = table.rawRows[rowIndex] ?? [];
    const id = idFromLinks(raw[0] ?? "", "viewingTeam");
    if (!id) continue;
    const roster: FfpcRosterEntry[] = [];
    for (let col = 1; col < table.headers.length; col++) {
      const rawCell = raw[col] ?? "";
      const position = (table.headers[col] ?? "").toUpperCase();
      const divRe = /<div\b[^>]*>([\s\S]*?)<\/div>/gi;
      let match: RegExpExecArray | null;
      while ((match = divRe.exec(rawCell))) {
        const playerText = text(match[1] ?? "");
        const team = playerText.match(/\(([A-Z]{2,3})\)/)?.[1] ?? null;
        const name = text((match[1] ?? "").match(/<a\b[^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? "");
        if (!name) continue;
        roster.push({
          name,
          position: position === "PK" ? "K" : position === "DF" || position === "DST" ? "DEF" : position,
          nflTeam: team,
          slot: "BN",
          isStarter: false,
        });
      }
    }
    if (roster.length) byTeam.set(id, roster);
  }
  return byTeam;
}

export function parseTransactions(html: string): FfpcTransaction[] {
  const table =
    findTable(html, "date", "transaction") ??
    findTable(html, "date", "team") ??
    findTable(html, "transaction");
  if (!table) return [];
  const cDate = columnIndex(table, "date");
  const cTeam = columnIndex(table, "team", "franchise");
  const cPlayer = columnIndex(table, "player");
  const cAction = columnIndex(table, "action", "transaction");
  const cBid = columnIndex(table, "bid", "amount", "salary", "$");
  return table.rows.slice(0, 400).map((row, index) => {
    const action = cAction >= 0 ? (row[cAction] ?? "") : "";
    const addedText = action.match(/Added\s+(.+?)(?=\s+Drop Player\s+|$)/i)?.[1] ?? (cPlayer >= 0 ? (row[cPlayer] ?? "") : "");
    const droppedText = action.match(/Drop Player\s+(.+)$/i)?.[1] ?? "";
    const raw = table.rawRows[index] ?? [];
    return {
      date: cDate >= 0 ? (row[cDate] ?? null) : null,
      teamName: cTeam >= 0 ? (row[cTeam] ?? null) : null,
      kind: droppedText ? "add_drop" : "add",
      detail: action,
      bid: cBid >= 0 ? toNumber(row[cBid]) : null,
      teamExternalId: cTeam >= 0 ? idFromLinks(raw[cTeam] ?? "", "viewingTeam") : null,
      addedPlayer: parsePlayerCell(addedText),
      droppedPlayer: droppedText ? parsePlayerCell(droppedText) : null,
    };
  });
}

function parseDraftBoard(html: string): FfpcDraftPick[] {
  const table = findTable(html, "round", "pick") ?? findTable(html, "pick", "player");
  if (!table) return [];
  const cRound = columnIndex(table, "round");
  const cPick = columnIndex(table, "pick", "overall");
  const cTeam = columnIndex(table, "team", "franchise");
  const cPlayer = columnIndex(table, "player", "selection");
  const picks: FfpcDraftPick[] = [];
  for (let i = 0; i < table.rows.length; i++) {
    const row = table.rows[i] ?? [];
    const raw = table.rawRows[i] ?? [];
    const player = cPlayer >= 0 ? parsePlayerCell(row[cPlayer] ?? "") : null;
    picks.push({
      round: cRound >= 0 ? toNumber(row[cRound]) : 0,
      pick: cPick >= 0 ? toNumber(row[cPick]) : i + 1,
      teamExternalId: cTeam >= 0 ? idFromLinks(raw[cTeam] ?? "", "viewingTeam", "teamID") : null,
      teamName: cTeam >= 0 ? (row[cTeam] ?? null) : null,
      playerName: player?.name ?? null,
    });
  }
  return picks;
}

function parsePickPortfolio(html: string): FfpcFuturePick[] {
  const table = findTable(html, "year", "round") ?? findTable(html, "season", "round");
  if (!table) return [];
  const cYear = Math.max(0, columnIndex(table, "year", "season"));
  const cRound = Math.max(0, columnIndex(table, "round"));
  const cFrom = columnIndex(table, "original", "from", "team");
  const cOwner = columnIndex(table, "owner", "held by", "owned");
  const out: FfpcFuturePick[] = [];
  for (let i = 0; i < table.rows.length; i++) {
    const row = table.rows[i] ?? [];
    const raw = table.rawRows[i] ?? [];
    const season = toNumber(row[cYear]);
    const round = toNumber(row[cRound]);
    if (!season || !round) continue;
    out.push({
      season,
      round,
      originalTeamName: cFrom >= 0 ? (row[cFrom] ?? null) : null,
      ownedByExternalId: cOwner >= 0 ? idFromLinks(raw[cOwner] ?? "", "viewingTeam", "teamID") : null,
    });
  }
  return out;
}

function parseScoreboard(html: string): FfpcScoreboardTeam[] {
  const table =
    findTable(html, "team", "proj") ??
    findTable(html, "team", "score") ??
    findTable(html, "team", "points");
  if (!table) return [];
  const cName = Math.max(0, columnIndex(table, "team"));
  const cScore = columnIndex(table, "score", "points", "pts");
  const cProj = columnIndex(table, "proj");
  const cIn = columnIndex(table, "in play", "playing", "live");
  const cYet = columnIndex(table, "yet to play", "to play", "remaining");
  const out: FfpcScoreboardTeam[] = [];
  for (let i = 0; i < table.rows.length; i++) {
    const row = table.rows[i] ?? [];
    const raw = table.rawRows[i] ?? [];
    const name = (row[cName] ?? "").trim();
    if (!name) continue;
    out.push({
      externalId: idFromLinks(raw[cName] ?? "", "viewingTeam", "teamID"),
      name,
      score: cScore >= 0 ? toNumber(row[cScore]) : 0,
      projected: cProj >= 0 ? toNumber(row[cProj]) : 0,
      inPlay: cIn >= 0 ? toNumber(row[cIn]) : 0,
      yetToPlay: cYet >= 0 ? toNumber(row[cYet]) : 0,
    });
  }
  return out;
}

// ---------------------------------------------------------------- bundle

export interface FfpcFetchOptions {
  /** Skip the slow pages (all rosters, draft, transactions) for a quick preview. */
  shallow?: boolean;
  /** Week to read the scoreboard for; defaults to the league's current week. */
  week?: number;
}

/** Reads a whole FFPC league. Throws FfpcParseError when a page can't be read. */
export async function ffpcLeagueBundle(
  leagueIdInput: string | null,
  ltuid: string,
  options: FfpcFetchOptions = {},
): Promise<FfpcLeagueBundle> {
  // Links copied from FFPC often carry only the private token; the league page
  // itself then tells us which league it is.
  const firstHtml = await getPage(
    "LeagueHome.aspx",
    ltuid,
    leagueIdInput ? { leagueID: leagueIdInput } : {},
  );
  const { discoverLeagueId } = await import("./ffpc-parse");
  const leagueId = leagueIdInput ?? discoverLeagueId(firstHtml);
  if (!leagueId) {
    throw new FfpcParseError(
      "LeagueHome.aspx",
      "FFPC answered, but its league number could not be identified from the page.",
    );
  }
  const homeHtml = firstHtml;
  const home = parseLeagueHome(homeHtml, leagueId);
  if (!home.teams.length) {
    throw new FfpcParseError(
      "LeagueHome.aspx",
      "FFPC answered, but its standings could not be read from the page.",
    );
  }


  let rules = {
    rosterSlots: [] as string[],
    scoringRules: {} as Record<string, number>,
    scoringType: "te_premium",
    playoffTeams: 0,
    regularSeasonWeeks: 0,
  };
  try {
    rules = parseRules(await getPage("leagueRulesFFPC.aspx", ltuid, { leagueID: leagueId }));
  } catch {
    // Rules are optional: FFPC's standard lineup is the fallback.
  }
  const rosterSlots = rules.rosterSlots.length
    ? rules.rosterSlots
    : ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "TE", "FLEX", "K", "DEF"];

  const week = options.week ?? home.currentWeek;

  // Rosters for everyone, then per-team lineups so the slot each player is in
  // is the real one rather than an estimate.
  const rosters = new Map<string, FfpcRosterEntry[]>();
  if (!options.shallow) {
    try {
      for (const [id, roster] of parseAllRosters(
        await getPage("Rosters.aspx", ltuid, { leagueID: leagueId }),
      )) {
        rosters.set(id, roster);
      }
    } catch {
      /* fall through to per-team lineups */
    }
    // Best ball has no lineups to set — FFPC scores the best roster itself.
    for (const team of home.isBestBall ? [] : home.teams) {
      try {
        const html = await getPage("SetLineup.aspx", ltuid, {
          leagueID: leagueId,
          viewingTeam: team.externalId,
          weekNum: week,
        });
        const lineup = parseRosterTable(findTable(html, "slot", "player") ?? findTable(html, "player"));
        if (lineup.length) {
          const fullRoster = rosters.get(team.externalId) ?? [];
          const slots = new Map(
            lineup.map((player) => [`${normalizeName(player.name)}|${player.nflTeam ?? ""}`, player]),
          );
          const merged = fullRoster.map((player) => {
            const lineupPlayer = slots.get(`${normalizeName(player.name)}|${player.nflTeam ?? ""}`);
            return lineupPlayer ?? player;
          });
          for (const player of lineup) {
            if (!merged.some((candidate) => normalizeName(candidate.name) === normalizeName(player.name) && candidate.nflTeam === player.nflTeam)) {
              merged.push(player);
            }
          }
          rosters.set(team.externalId, merged);
        }
      } catch {
        /* keep whatever Rosters.aspx gave us */
      }
    }
  }

  let transactions: FfpcTransaction[] = [];
  let draft: FfpcDraftPick[] = [];
  let futurePicks: FfpcFuturePick[] = [];
  if (!options.shallow) {
    try {
      transactions = parseTransactions(
        await getPage("Transactions.aspx", ltuid, { leagueID: leagueId }),
      );
    } catch {
      /* optional */
    }
    try {
      draft = parseDraftBoard(await getPage("DraftBoard.aspx", ltuid, { leagueID: leagueId }));
    } catch {
      /* optional */
    }
    try {
      futurePicks = parsePickPortfolio(
        await getPage("DraftPickPortfolio.aspx", ltuid, { leagueID: leagueId }),
      );
    } catch {
      /* optional — redraft leagues have no portfolio */
    }
  }

  let scoreboard: FfpcScoreboardTeam[] = [];
  try {
    scoreboard = parseScoreboard(
      await getPage("Scoreboard.aspx", ltuid, { leagueID: leagueId, weekNum: week }),
    );
  } catch {
    /* optional */
  }

  if (!home.myTeamExternalId) {
    throw new FfpcParseError("LeagueHome.aspx", "FFPC answered, but your Team ID could not be read.");
  }
  const teams: FfpcTeam[] = home.teams.map((t) => ({
    ...t,
    isMine: t.externalId === home.myTeamExternalId,
    faabRemaining: t.externalId === home.myTeamExternalId ? home.faabRemaining : null,
    roster: rosters.get(t.externalId) ?? (t.externalId === home.myTeamExternalId ? home.myRoster : []),
  }));

  // FFPC only shows my own schedule; every week I play someone, which gives the
  // matchup rows the rest of the app needs.
  const schedule = home.mySchedule
    .filter((s) => s.opponentExternalId)
    .map((s) => ({
      week: s.week,
      homeExternalId: s.homeTeamExternalId,
      awayExternalId: s.homeTeamExternalId === home.myTeamExternalId ? s.opponentExternalId : home.myTeamExternalId,
      homeScore: s.homeTeamExternalId === home.myTeamExternalId ? s.myScore : s.oppScore,
      awayScore: s.homeTeamExternalId === home.myTeamExternalId ? s.oppScore : s.myScore,
      isFinal: s.isFinal && s.week < week,
    }));

  const teamCount = teams.length;
  return {
    externalId: leagueId,
    name: home.name,
    leagueType: home.leagueType,
    isBestBall: home.isBestBall,
    hasEmpirePanel: home.hasEmpirePanel,
    season: home.season,
    currentWeek: week,
    teamCount,
    playoffTeams: rules.playoffTeams || Math.max(2, Math.floor(teamCount / 3)),
    regularSeasonWeeks: rules.regularSeasonWeeks || 14,
    scoringType: rules.scoringType,
    scoringRules: rules.scoringRules,
    rosterSlots,
    contestFormat: home.usesVp ? "vp" : home.isBestBall ? "points" : "h2h",
    allPlayWeeks: home.allPlayWeeks,
    faabBudget: home.faabBudget,
    myTeamExternalId: home.myTeamExternalId,
    teams,
    schedule,
    transactions,
    draft,
    futurePicks,
    scoreboard,
  };
}
