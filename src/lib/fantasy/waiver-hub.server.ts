/**
 * Waivers across every league: the top-120 projected players, grouped by
 * player, showing which of my leagues they are still free in, what FAAB I have
 * left there, and what a winning bid has historically cost in that league.
 * Server-only.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import {
  optimalLineup,
  recommendationImpact,
  simulateSeason,
  teamDistribution,
  type EnginePlayer,
  type Slot,
} from "./engine";
import { bestBallDistribution } from "./format";
import { EMPTY_IMPACT, impactScore, primaryImpactText, type TeamClass } from "./impact";
import { normalizeName } from "./names";
import { loadLeague } from "./proposal.server";
import { fetchAllRows } from "./paginate";
import { loadProjections } from "./projections.server";
import { resolveProjectionSource } from "./projection-source";
import { leagueScoring } from "./scoring";
import type { WaiverHubLeagueEntry, WaiverHubPayload, WaiverHubPlayer } from "./waiver-hub-types";
import { applyBidRules } from "./rules";
import { loadStrategyRules } from "./rules.server";

export type * from "./waiver-hub-types";

type DB = SupabaseClient<Database>;

/** How many projected players the board considers. */
const POOL = 120;

/** Only the best few free agents per league are worth a full simulation. */
const IMPACT_DEPTH = 8;

const SKIP_POSITIONS = new Set(["K", "DEF", "DST"]);

/** The platform page where a claim can actually be placed. */
function waiverLink(platform: string, externalId: string | null) {
  const id = externalId ?? "";
  switch (platform) {
    case "sleeper":
      return id
        ? { url: `https://sleeper.com/leagues/${id}/players`, label: "Open on Sleeper" }
        : { url: "https://sleeper.com/leagues", label: "Open on Sleeper" };
    case "yahoo":
      return id
        ? {
            url: `https://football.fantasysports.yahoo.com/f1/${id.split(".").pop()}/players?status=A`,
            label: "Open on Yahoo",
          }
        : { url: "https://football.fantasysports.yahoo.com/f1", label: "Open on Yahoo" };
    case "espn":
      return id
        ? { url: `https://fantasy.espn.com/football/players/add?leagueId=${id}`, label: "Open on ESPN" }
        : { url: "https://fantasy.espn.com/football/", label: "Open on ESPN" };
    case "nfl":
      return id
        ? { url: `https://fantasy.nfl.com/league/${id}/players`, label: "Open on NFL.com" }
        : { url: "https://fantasy.nfl.com", label: "Open on NFL.com" };
    case "ffpc":
      return { url: "https://myffpc.com", label: "Open on FFPC" };
    default:
      return null;
  }
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export async function buildWaiverHub(supabase: DB): Promise<WaiverHubPayload> {
  const { data: leagueRows, error } = await supabase.from("leagues").select("*").order("created_at");
  if (error) throw new Error(error.message);

  const players = await fetchAllRows((from, to) =>
    supabase.from("players").select("*").order("id").range(from, to),
  );

  const byKey = new Map<string, WaiverHubPlayer>();
  const leagueSummaries: WaiverHubPayload["leagues"] = [];
  let week = 1;

  for (const league of leagueRows ?? []) {
    week = league.current_week ?? week;

    const [{ data: spotRows }, { data: teamRows }, { data: bidRows }] = await Promise.all([
      supabase.from("roster_spots").select("player_name").eq("league_id", league.id),
      supabase.from("teams").select("id, is_mine, faab_remaining").eq("league_id", league.id),
      supabase.from("faab_bids").select("amount, won").eq("league_id", league.id).eq("won", true),
    ]);

    const rostered = new Set((spotRows ?? []).map((s) => normalizeName(s.player_name)));
    const mine = (teamRows ?? []).find((t) => t.is_mine) ?? null;
    const faabBudget = Number((league as { faab_budget?: number }).faab_budget ?? 100) || 100;
    const faabRemaining =
      mine && mine.faab_remaining != null ? Number(mine.faab_remaining) : null;

    leagueSummaries.push({
      id: league.id,
      name: league.name,
      color: league.color,
      platform: league.platform,
      faabRemaining,
      faabBudget,
    });

    const scoring = leagueScoring(
      league.scoring_type,
      (league.scoring_rules ?? {}) as Record<string, number>,
    );
    const proj = await loadProjections(supabase, {
      scoring,
      week: league.current_week ?? 1,
      source: resolveProjectionSource(league),
      sos: (league as { sos_adjust?: boolean }).sos_adjust,
    });

    // The top-120 projected players in this league's scoring.
    const ranked = players
      .filter((p) => !SKIP_POSITIONS.has(p.position.toUpperCase()))
      .map((p) => ({
        row: p,
        projWeek: proj.week(p.id, p.full_name, p.position.toUpperCase(), Number(p.proj_points_week)),
      }))
      .sort((a, b) => b.projWeek - a.projWeek)
      .slice(0, POOL);

    const free = ranked.filter((p) => !rostered.has(normalizeName(p.row.full_name)));
    if (!free.length) continue;

    // What each claim is worth: the season is re-simulated with the player in
    // my lineup in place of my weakest bench piece.
    const impactByName = new Map<string, { label: string; rank: number }>();
    let myClass: TeamClass = "middle";
    if (mine) {
      const loaded = await loadLeague(supabase, league.id);
      const slots = loaded.slots as Slot[];
      const myRoster = loaded.rosters.get(mine.id) ?? [];
      const distOf = (roster: EnginePlayer[]) =>
        loaded.bestBall ? bestBallDistribution(roster, slots) : teamDistribution(roster, slots);
      const simTeams = loaded.teams.map((t) => ({
        id: t.id,
        name: t.name,
        isMine: t.isMine,
        wins: t.wins,
        losses: t.losses,
        ties: t.ties,
        pointsFor: t.pointsFor,
        ...distOf(loaded.rosters.get(t.id) ?? []),
      }));
      const baseline = simulateSeason(simTeams, loaded.simConfig, loaded.schedule, 1500, 7);
      const mineBase = baseline.find((r) => r.id === mine.id);
      myClass =
        (mineBase?.titleOdds ?? 0) >= 0.15
          ? "contender"
          : (mineBase?.playoffOdds ?? 0) <= 0.25
            ? "rebuilder"
            : "middle";
      const dropPick = [...optimalLineup(myRoster, slots).bench].sort((a, b) => a.proj - b.proj)[0];
      const valueByTeam: Record<string, number> = {};
      for (const t of loaded.teams) {
        valueByTeam[t.id] = (loaded.rosters.get(t.id) ?? []).reduce(
          (sum, p) => sum + loaded.values.player(p.id, p.name, p.position, p.proj * 17),
          0,
        );
      }

      for (const fa of free.slice(0, IMPACT_DEPTH)) {
        const position = fa.row.position.toUpperCase();
        const incoming: EnginePlayer = {
          id: fa.row.id,
          name: fa.row.full_name,
          position,
          nflTeam: fa.row.nfl_team,
          proj: fa.projWeek,
          volatility: 0.35,
        };
        const nextRoster = dropPick
          ? myRoster.map((p) => (p.name === dropPick.name ? incoming : p))
          : [...myRoster, incoming];
        const addValue = loaded.values.player(incoming.id, incoming.name, position, fa.projWeek * 17);
        const dropValue = dropPick
          ? loaded.values.player(dropPick.id, dropPick.name, dropPick.position, dropPick.proj * 17)
          : 0;
        const impact = myRoster.length
          ? recommendationImpact({
              teams: simTeams,
              config: loaded.simConfig,
              schedule: loaded.schedule,
              teamId: mine.id,
              baseline,
              after: distOf(nextRoster),
              iterations: 900,
              seed: 7,
              dynasty: loaded.isDynasty
                ? { valueByTeam, valueDelta: addValue - dropValue }
                : undefined,
            })
          : EMPTY_IMPACT;
        impactByName.set(normalizeName(fa.row.full_name), {
          label: primaryImpactText(impact, myClass, loaded.isDynasty),
          rank: impactScore(impact, myClass, loaded.isDynasty),
        });
      }
    }

    // Bid history sets the price ceiling; the best free agent sets the top of
    // the ladder and everyone else is priced down from there.
    const wins = (bidRows ?? []).map((b) => Number(b.amount)).filter((n) => n > 0);
    const midWin = median(wins);
    const topWin = wins.length ? Math.max(...wins) : 0;
    const bestFree = Math.max(...free.map((p) => p.projWeek), 1);
    const link = waiverLink(league.platform, league.external_id);

    for (const fa of free) {
      const share = Math.max(0, Math.min(1, fa.projWeek / bestFree));
      let suggestedBid: number;
      let basis: string;
      if (wins.length >= 2) {
        suggestedBid = Math.round(midWin + (topWin - midWin) * share);
        basis = `${wins.length} winning bids here, median $${Math.round(midWin)}`;
      } else if (wins.length === 1) {
        suggestedBid = Math.round(topWin * (0.5 + share * 0.7));
        basis = `One winning bid on record, $${Math.round(topWin)}`;
      } else {
        suggestedBid = Math.round(faabBudget * (0.02 + share * 0.18));
        basis = "No bid history yet — priced off your budget";
      }
      const cap = faabRemaining ?? faabBudget;
      suggestedBid = Math.max(1, Math.min(Math.round(cap), suggestedBid));
      // Streamers go at the minimum, and part of the budget is always held back.
      const capped = applyBidRules(book, {
        position: fa.row.position.toUpperCase(),
        bid: suggestedBid,
        budget: faabBudget,
        remaining: faabRemaining,
        weeksLeft: Math.max(1, (league.regular_season_weeks ?? 17) - (league.current_week ?? 1) + 1),
      });
      suggestedBid = capped.bid;

      const entry: WaiverHubLeagueEntry = {
        leagueId: league.id,
        leagueName: league.name,
        leagueColor: league.color,
        platform: league.platform,
        projWeek: Math.round(fa.projWeek * 10) / 10,
        faabBudget,
        faabRemaining,
        suggestedBid,
        basis,
        url: link?.url ?? null,
        urlLabel: link?.label ?? null,
        impactLabel: impactByName.get(normalizeName(fa.row.full_name))?.label ?? null,
        impactRank: impactByName.get(normalizeName(fa.row.full_name))?.rank ?? 0,
        ruleNote: capped.note,
      };

      const key = `${normalizeName(fa.row.full_name)}::${fa.row.position.toUpperCase()}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.leagues.push(entry);
        existing.bestProj = Math.max(existing.bestProj, entry.projWeek);
        existing.bestImpact = Math.max(existing.bestImpact, entry.impactRank);
      } else {
        byKey.set(key, {
          key,
          name: fa.row.full_name,
          position: fa.row.position.toUpperCase(),
          nflTeam: fa.row.nfl_team,
          status: fa.row.status,
          byeWeek: fa.row.bye_week,
          bestProj: entry.projWeek,
          bestImpact: entry.impactRank,
          rank: 0,
          leagues: [entry],
        });
      }
    }
  }

  const list = [...byKey.values()].sort(
    (a, b) =>
      b.bestImpact - a.bestImpact ||
      b.leagues.length - a.leagues.length ||
      b.bestProj - a.bestProj,
  );
  list.forEach((p, i) => {
    p.rank = i + 1;
  });

  return {
    generatedAt: new Date().toISOString(),
    week,
    leagues: leagueSummaries,
    players: list,
  };
}
