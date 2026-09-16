/** ESPN Fantasy Football adapter. Server-only.
 *
 * ESPN has no developer app / client-secret programme. Public leagues are
 * readable with just the league ID; private leagues need the two session
 * values (SWID and espn_s2) the manager copies out of their own browser.
 */

import { detectLeagueType, type LeagueType, type LeagueVariant } from "./league-type";

const HOST = "https://lm-api-reads.fantasy.espn.com";

const POSITION_BY_ID: Record<number, string> = {
  1: "QB",
  2: "RB",
  3: "WR",
  4: "TE",
  5: "K",
  16: "DEF",
};

const SLOT_BY_ID: Record<number, string> = {
  0: "QB",
  2: "RB",
  3: "RB",
  4: "WR",
  5: "WR",
  6: "TE",
  7: "OP",
  16: "DEF",
  17: "K",
  20: "BN",
  21: "IR",
  23: "FLEX",
};

const PRO_TEAM: Record<number, string> = {
  0: "FA", 1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL", 7: "DEN",
  8: "DET", 9: "GB", 10: "TEN", 11: "IND", 12: "KC", 13: "LV", 14: "LAR", 15: "MIA",
  16: "MIN", 17: "NE", 18: "NO", 19: "NYG", 20: "NYJ", 21: "PHI", 22: "ARI",
  23: "PIT", 24: "LAC", 25: "SF", 26: "SEA", 27: "TB", 28: "WAS", 29: "CAR",
  30: "JAX", 33: "BAL", 34: "HOU",
};

export interface EspnCredentials {
  swid?: string | null;
  espnS2?: string | null;
}

export interface EspnTeam {
  externalId: string;
  name: string;
  ownerName: string | null;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  roster: {
    name: string;
    position: string;
    nflTeam: string | null;
    slot: string;
    isStarter: boolean;
  }[];
}

export interface EspnLeagueBundle {
  externalId: string;
  name: string;
  season: number;
  currentWeek: number;
  teamCount: number;
  playoffTeams: number;
  regularSeasonWeeks: number;
  scoringType: string;
  rosterSlots: string[];
  contestFormat?: "h2h" | "points" | "hybrid";
  leagueType?: LeagueType;
  variant?: LeagueVariant;
  typeSource?: "detected" | "inferred";
  teams: EspnTeam[];
  schedule: {
    week: number;
    homeExternalId: string | null;
    awayExternalId: string | null;
    homeScore: number;
    awayScore: number;
    isFinal: boolean;
  }[];
}

function cookieHeader(creds: EspnCredentials | undefined) {
  if (!creds?.swid || !creds.espnS2) return undefined;
  const swid = creds.swid.startsWith("{") ? creds.swid : `{${creds.swid}}`;
  return `SWID=${swid}; espn_s2=${creds.espnS2}`;
}

async function espnGet<T>(path: string, creds?: EspnCredentials): Promise<T> {
  const cookie = cookieHeader(creds);
  const res = await fetch(`${HOST}${path}`, {
    headers: {
      accept: "application/json",
      ...(cookie ? { cookie } : {}),
    },
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      cookie
        ? "ESPN rejected those session values. Copy SWID and espn_s2 again from your ESPN tab."
        : "That ESPN league is private. Add your SWID and espn_s2 values to connect it.",
    );
  }
  if (res.status === 404) throw new Error("No ESPN league was found with that ID for this season.");
  if (!res.ok) throw new Error(`ESPN request failed (${res.status}).`);
  return (await res.json()) as T;
}

interface RawTeam {
  id: number;
  name?: string;
  location?: string;
  nickname?: string;
  abbrev?: string;
  primaryOwner?: string;
  owners?: string[];
  record?: { overall?: { wins?: number; losses?: number; ties?: number; pointsFor?: number; pointsAgainst?: number } };
  roster?: {
    entries?: {
      lineupSlotId?: number;
      playerPoolEntry?: {
        player?: { fullName?: string; defaultPositionId?: number; proTeamId?: number };
      };
      playerId?: number;
    }[];
  };
}

interface RawLeague {
  id: number;
  seasonId: number;
  scoringPeriodId?: number;
  status?: { currentMatchupPeriod?: number; finalScoringPeriod?: number };
  settings?: {
    name?: string;
    size?: number;
    scoringSettings?: { scoringItems?: { statId: number; points?: number; pointsOverrides?: Record<string, number> }[] };
    scheduleSettings?: { matchupPeriodCount?: number; playoffTeamCount?: number };
    rosterSettings?: { lineupSlotCounts?: Record<string, number> };
  };
  teams?: RawTeam[];
  members?: { id: string; displayName?: string; firstName?: string; lastName?: string }[];
  schedule?: {
    matchupPeriodId?: number;
    winner?: string;
    home?: { teamId?: number; totalPoints?: number };
    away?: { teamId?: number; totalPoints?: number };
  }[];
}

function teamName(t: RawTeam) {
  if (t.name) return t.name;
  const joined = [t.location, t.nickname].filter(Boolean).join(" ").trim();
  return joined || `Team ${t.id}`;
}

function slotsFromCounts(counts: Record<string, number> | undefined): string[] {
  if (!counts) return [];
  const slots: string[] = [];
  for (const [id, count] of Object.entries(counts)) {
    const slot = SLOT_BY_ID[Number(id)];
    if (!slot || slot === "BN" || slot === "IR") continue;
    for (let i = 0; i < count; i++) slots.push(slot === "OP" ? "SUPER_FLEX" : slot);
  }
  const order = ["QB", "RB", "WR", "TE", "FLEX", "SUPER_FLEX", "K", "DEF"];
  return slots.sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

function scoringTypeOf(raw: RawLeague): string {
  const rec = raw.settings?.scoringSettings?.scoringItems?.find((i) => i.statId === 53);
  const pts = rec?.points ?? Number(rec?.pointsOverrides?.["16"] ?? 0);
  if (pts >= 1) return "ppr";
  if (pts > 0) return "half_ppr";
  return "standard";
}

/** Reads one ESPN league, public or private, into our internal shape. */
export async function espnLeagueBundle(
  leagueId: string,
  season: number,
  creds?: EspnCredentials,
): Promise<EspnLeagueBundle> {
  const views = ["mTeam", "mRoster", "mSettings", "mMatchupScore", "mNav"]
    .map((v) => `view=${v}`)
    .join("&");
  const raw = await espnGet<RawLeague | RawLeague[]>(
    `/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${encodeURIComponent(leagueId)}?${views}`,
    creds,
  );
  const league = Array.isArray(raw) ? raw[0]! : raw;
  if (!league?.teams?.length) throw new Error("That ESPN league returned no teams.");

  const memberName = new Map(
    (league.members ?? []).map((m) => [
      m.id,
      m.displayName || [m.firstName, m.lastName].filter(Boolean).join(" ") || null,
    ]),
  );

  const currentWeek = Math.max(
    1,
    league.status?.currentMatchupPeriod ?? league.scoringPeriodId ?? 1,
  );

  const teams: EspnTeam[] = league.teams.map((t) => {
    const overall = t.record?.overall ?? {};
    return {
      externalId: String(t.id),
      name: teamName(t),
      ownerName: memberName.get(t.primaryOwner ?? t.owners?.[0] ?? "") ?? null,
      wins: overall.wins ?? 0,
      losses: overall.losses ?? 0,
      ties: overall.ties ?? 0,
      pointsFor: Math.round((overall.pointsFor ?? 0) * 100) / 100,
      pointsAgainst: Math.round((overall.pointsAgainst ?? 0) * 100) / 100,
      roster: (t.roster?.entries ?? []).flatMap((e) => {
        const p = e.playerPoolEntry?.player;
        if (!p?.fullName) return [];
        const position = POSITION_BY_ID[p.defaultPositionId ?? 0] ?? "FLEX";
        const slot = SLOT_BY_ID[e.lineupSlotId ?? 20] ?? "BN";
        return [
          {
            name: p.fullName,
            position,
            nflTeam: PRO_TEAM[p.proTeamId ?? 0] ?? null,
            slot: slot === "IR" ? "BN" : slot,
            isStarter: slot !== "BN" && slot !== "IR",
          },
        ];
      }),
    };
  });

  const schedule = (league.schedule ?? [])
    .filter((g) => g.home?.teamId != null || g.away?.teamId != null)
    .map((g) => ({
      week: g.matchupPeriodId ?? 1,
      homeExternalId: g.home?.teamId != null ? String(g.home.teamId) : null,
      awayExternalId: g.away?.teamId != null ? String(g.away.teamId) : null,
      homeScore: Math.round((g.home?.totalPoints ?? 0) * 100) / 100,
      awayScore: Math.round((g.away?.totalPoints ?? 0) * 100) / 100,
      isFinal: Boolean(g.winner && g.winner !== "UNDECIDED"),
    }));

  const slots = slotsFromCounts(league.settings?.rosterSettings?.lineupSlotCounts);

  return {
    externalId: String(league.id),
    name: league.settings?.name ?? `ESPN League ${league.id}`,
    season: league.seasonId ?? season,
    currentWeek,
    teamCount: league.settings?.size ?? teams.length,
    playoffTeams: league.settings?.scheduleSettings?.playoffTeamCount ?? 6,
    regularSeasonWeeks: league.settings?.scheduleSettings?.matchupPeriodCount ?? 14,
    scoringType: scoringTypeOf(league),
    // ESPN reports H2H_POINTS / TOTAL_POINTS on the scoring settings.
    contestFormat:
      String(
        (league.settings?.scoringSettings as { scoringType?: string } | undefined)?.scoringType ?? "",
      ).toUpperCase() === "TOTAL_POINTS"
        ? ("points" as const)
        : ("h2h" as const),
    rosterSlots: slots.length ? slots : ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF"],
    teams,
    schedule,
  };
}
