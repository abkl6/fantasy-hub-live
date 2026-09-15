/** Yahoo Fantasy Sports adapter (OAuth 2.0). Server-only. */

const AUTH_URL = "https://api.login.yahoo.com/oauth2/request_auth";
const TOKEN_URL = "https://api.login.yahoo.com/oauth2/get_token";
const API = "https://fantasysports.yahooapis.com/fantasy/v2";

export function yahooConfigured() {
  return Boolean(process.env["YAHOO_CLIENT_ID"] && process.env["YAHOO_CLIENT_SECRET"]);
}

export const YAHOO_NOT_CONFIGURED =
  "Yahoo isn't configured yet. The Yahoo client ID and secret need to be added before sign-in can work.";

function clientCreds() {
  const id = process.env["YAHOO_CLIENT_ID"];
  const secret = process.env["YAHOO_CLIENT_SECRET"];
  if (!id || !secret) throw new Error(YAHOO_NOT_CONFIGURED);
  return { id, secret };
}

export function yahooRedirectUri(origin: string) {
  return `${origin.replace(/\/$/, "")}/api/public/yahoo/callback`;
}

export function yahooAuthorizeUrl(origin: string, state: string) {
  const { id } = clientCreds();
  const params = new URLSearchParams({
    client_id: id,
    redirect_uri: yahooRedirectUri(origin),
    response_type: "code",
    scope: "fspt-r",
    state,
    language: "en-us",
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export interface YahooTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

async function tokenRequest(body: Record<string, string>): Promise<YahooTokens> {
  const { id, secret } = clientCreds();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${id}:${secret}`)}`,
    },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) {
    throw new Error(`Yahoo sign-in failed (${res.status}). Check the client ID, secret and redirect URL.`);
  }
  const json = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 - 60_000,
  };
}

export function yahooExchangeCode(code: string, origin: string) {
  return tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: yahooRedirectUri(origin),
  });
}

export function yahooRefresh(refreshToken: string) {
  return tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
}

async function yget<T>(path: string, accessToken: string): Promise<T> {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${API}${path}${sep}format=json`, {
    headers: { Authorization: `Bearer ${accessToken}`, accept: "application/json" },
  });
  if (res.status === 401) throw new Error("Your Yahoo sign-in expired. Connect Yahoo again.");
  if (!res.ok) throw new Error(`Yahoo request failed (${res.status}).`);
  return (await res.json()) as T;
}

// --- Yahoo's JSON is deeply nested arrays; these helpers flatten it. -------

type Any = Record<string, unknown>;

function flat(node: unknown): Any {
  if (Array.isArray(node)) {
    const out: Any = {};
    for (const item of node) Object.assign(out, flat(item));
    return out;
  }
  if (node && typeof node === "object") return node as Any;
  return {};
}

function list(node: unknown): unknown[] {
  if (!node || typeof node !== "object") return [];
  const obj = node as Any;
  return Object.keys(obj)
    .filter((k) => /^\d+$/.test(k))
    .sort((a, b) => Number(a) - Number(b))
    .map((k) => obj[k]);
}

function deepFind(node: unknown, key: string): unknown {
  if (!node || typeof node !== "object") return undefined;
  if (!Array.isArray(node) && key in (node as Any)) return (node as Any)[key];
  for (const value of Object.values(node as Any)) {
    const hit = deepFind(value, key);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

const num = (v: unknown, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export interface YahooLeagueSummary {
  leagueKey: string;
  name: string;
  season: string;
  teamCount: number;
  currentWeek: number;
}

export async function yahooLeagues(accessToken: string): Promise<YahooLeagueSummary[]> {
  const json = await yget<Any>("/users;use_login=1/games;game_codes=nfl/leagues", accessToken);
  const out: YahooLeagueSummary[] = [];
  const users = list(deepFind(json, "users"));
  for (const u of users) {
    const games = list(deepFind(u, "games"));
    for (const g of games) {
      const leagues = list(deepFind(g, "leagues"));
      for (const l of leagues) {
        const league = flat((l as Any)["league"]);
        if (!league["league_key"]) continue;
        out.push({
          leagueKey: String(league["league_key"]),
          name: String(league["name"] ?? "Yahoo League"),
          season: String(league["season"] ?? new Date().getFullYear()),
          teamCount: num(league["num_teams"], 12),
          currentWeek: num(league["current_week"], 1),
        });
      }
    }
  }
  return out;
}

export interface YahooTeam {
  externalId: string;
  name: string;
  ownerName: string | null;
  isMine: boolean;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  roster: { name: string; position: string; nflTeam: string | null; slot: string; isStarter: boolean }[];
}

export interface YahooLeagueBundle {
  externalId: string;
  name: string;
  season: number;
  currentWeek: number;
  teamCount: number;
  playoffTeams: number;
  regularSeasonWeeks: number;
  scoringType: string;
  rosterSlots: string[];
  teams: YahooTeam[];
  schedule: {
    week: number;
    homeExternalId: string | null;
    awayExternalId: string | null;
    homeScore: number;
    awayScore: number;
    isFinal: boolean;
  }[];
}

function normalizeSlot(raw: string): string {
  const s = raw.toUpperCase();
  if (s === "W/R/T" || s === "W/T" || s === "W/R") return "FLEX";
  if (s === "Q/W/R/T") return "SUPER_FLEX";
  if (s === "DEF" || s === "D/ST") return "DEF";
  if (s === "IR" || s === "IL" || s === "NA") return "BN";
  return s;
}

export async function yahooLeagueBundle(
  leagueKey: string,
  accessToken: string,
): Promise<YahooLeagueBundle> {
  const [settingsJson, teamsJson] = await Promise.all([
    yget<Any>(`/league/${leagueKey};out=settings`, accessToken),
    yget<Any>(`/league/${leagueKey}/teams;out=roster,standings`, accessToken),
  ]);

  const leagueMeta = flat(deepFind(settingsJson, "league"));
  const settings = flat(deepFind(settingsJson, "settings"));

  const rosterPositions = list(settings["roster_positions"] ?? deepFind(settings, "roster_positions"))
    .map((rp) => flat((rp as Any)["roster_position"] ?? rp))
    .flatMap((rp) => {
      const slot = normalizeSlot(String(rp["position"] ?? ""));
      const count = num(rp["count"], 0);
      if (!slot || slot === "BN" || !count) return [];
      return Array.from({ length: count }, () => slot);
    });

  const statModifiers = list(deepFind(settings, "stat_modifiers")).map((m) => flat((m as Any)["stat"] ?? m));
  const recPoints = statModifiers.find((m) => String(m["stat_id"]) === "11");
  const recValue = num(recPoints?.["value"], 0);

  const teams: YahooTeam[] = list(deepFind(teamsJson, "teams")).flatMap((t) => {
    const team = flat((t as Any)["team"] ?? t);
    const key = team["team_key"];
    if (!key) return [];
    const standings = flat(deepFind(t, "team_standings"));
    const outcome = flat(deepFind(standings, "outcome_totals"));
    const managers = list(deepFind(team, "managers")).map((m) => flat((m as Any)["manager"] ?? m));
    const mine = managers.some((m) => num(m["is_current_login"], 0) === 1);

    const players = list(deepFind(t, "players")).flatMap((p) => {
      const player = flat((p as Any)["player"] ?? p);
      const name = flat(player["name"])["full"];
      if (!name) return [];
      const selected = flat(deepFind(p, "selected_position"));
      const slot = normalizeSlot(String(selected["position"] ?? "BN"));
      return [
        {
          name: String(name),
          position: normalizeSlot(String(player["display_position"] ?? player["primary_position"] ?? "FLEX")).split(",")[0]!,
          nflTeam: player["editorial_team_abbr"] ? String(player["editorial_team_abbr"]).toUpperCase() : null,
          slot,
          isStarter: slot !== "BN",
        },
      ];
    });

    return [
      {
        externalId: String(key),
        name: String(team["name"] ?? "Yahoo Team"),
        ownerName: managers[0]?.["nickname"] ? String(managers[0]["nickname"]) : null,
        isMine: mine,
        wins: num(outcome["wins"]),
        losses: num(outcome["losses"]),
        ties: num(outcome["ties"]),
        pointsFor: num(standings["points_for"]),
        pointsAgainst: num(standings["points_against"]),
        roster: players,
      },
    ];
  });

  const currentWeek = Math.max(1, num(leagueMeta["current_week"], 1));
  const endWeek = Math.min(num(leagueMeta["end_week"], 17), 18);
  const playoffStart = num(settings["playoff_start_week"], 15);

  // Schedule: pull every scoreboard week so future opponents are known.
  const weeks = Array.from({ length: Math.max(1, Math.min(playoffStart - 1, endWeek)) }, (_, i) => i + 1);
  const schedule: YahooLeagueBundle["schedule"] = [];
  const scoreboards = await Promise.all(
    weeks.map(async (week) => {
      try {
        return { week, json: await yget<Any>(`/league/${leagueKey}/scoreboard;week=${week}`, accessToken) };
      } catch {
        return { week, json: null };
      }
    }),
  );
  for (const { week, json } of scoreboards) {
    if (!json) continue;
    for (const m of list(deepFind(json, "matchups"))) {
      const matchup = flat((m as Any)["matchup"] ?? m);
      const sideTeams = list(deepFind(m, "teams")).map((t) => flat((t as Any)["team"] ?? t));
      const [home, away] = sideTeams;
      if (!home || !away) continue;
      schedule.push({
        week,
        homeExternalId: home["team_key"] ? String(home["team_key"]) : null,
        awayExternalId: away["team_key"] ? String(away["team_key"]) : null,
        homeScore: num(flat(deepFind(sideTeams[0], "team_points"))["total"]),
        awayScore: num(flat(deepFind(sideTeams[1], "team_points"))["total"]),
        isFinal: String(matchup["status"] ?? "") === "postevent",
      });
    }
  }

  return {
    externalId: leagueKey,
    name: String(leagueMeta["name"] ?? "Yahoo League"),
    season: num(leagueMeta["season"], new Date().getFullYear()),
    currentWeek,
    teamCount: num(leagueMeta["num_teams"], teams.length || 12),
    playoffTeams: num(settings["num_playoff_teams"], 6),
    regularSeasonWeeks: Math.max(4, playoffStart - 1),
    scoringType: recValue >= 1 ? "ppr" : recValue > 0 ? "half_ppr" : "standard",
    // Yahoo exposes how the league is won: "head" or "point".
    contestFormat: String(leagueMeta["scoring_type"] ?? "head").startsWith("point")
      ? ("points" as const)
      : ("h2h" as const),
    rosterSlots: rosterPositions.length
      ? rosterPositions
      : ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF"],
    teams,
    schedule,
  };
}
