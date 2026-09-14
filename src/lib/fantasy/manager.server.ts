import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { buildAnalysis, type Alert, type MoveSuggestion } from "./analysis.server";
import { normalizeName } from "./names";

type DB = SupabaseClient<Database>;

export interface ManagerHubPayload {
  leagues: {
    id: string;
    name: string;
    platform: string;
    teamName: string;
    record: string;
    titleOdds: number;
    playoffOdds: number;
  }[];
  moves: (MoveSuggestion & { leagueId: string; leagueName: string })[];
  /** Trade ideas only, best title impact first. */
  trades: (MoveSuggestion & { leagueId: string; leagueName: string })[];
  /** Waiver / free-agent adds only, best title impact first. */
  waivers: (MoveSuggestion & { leagueId: string; leagueName: string })[];
  alerts: (Alert & { leagueId: string; leagueName: string })[];
  exposure: {
    name: string;
    position: string;
    nflTeam: string | null;
    leagues: number;
    totalLeagues: number;
    status: string;
    leagueNames: string[];
  }[];
  /** Week-by-week title and playoff odds for my team in each league. */
  weeklyOdds: {
    leagueId: string;
    leagueName: string;
    teamName: string;
    points: { week: number; titleOdds: number; playoffOdds: number }[];
  }[];
}

export async function buildManagerHub(supabase: DB): Promise<ManagerHubPayload> {
  const { data: leagueRows, error } = await supabase.from("leagues").select("id").order("created_at");
  if (error) throw new Error(error.message);

  const analyses = await Promise.all((leagueRows ?? []).map((league) => buildAnalysis(supabase, league.id)));
  const leagues = analyses.flatMap((analysis) =>
    analysis.myTeam
      ? [{
          id: analysis.league.id,
          name: analysis.league.name,
          platform: analysis.league.platform,
          teamName: analysis.myTeam.name,
          record: analysis.myTeam.record,
          titleOdds: analysis.myTeam.titleOdds,
          playoffOdds: analysis.myTeam.playoffOdds,
        }]
      : [],
  );

  const allSuggestions = analyses
    .flatMap((analysis) => analysis.suggestions.map((move) => ({
      ...move,
      leagueId: analysis.league.id,
      leagueName: analysis.league.name,
    })))
    .sort((a, b) => b.titleDelta - a.titleDelta || b.pointsDelta - a.pointsDelta);

  const moves = allSuggestions.slice(0, 12);
  const trades = allSuggestions.filter((m) => m.kind === "trade").slice(0, 8);
  const waivers = allSuggestions.filter((m) => m.kind === "waiver").slice(0, 10);

  const alerts = analyses
    .flatMap((analysis) => analysis.alerts.map((alert) => ({
      ...alert,
      leagueId: analysis.league.id,
      leagueName: analysis.league.name,
    })))
    .sort((a, b) => ({ high: 0, medium: 1, low: 2 })[a.severity] - ({ high: 0, medium: 1, low: 2 })[b.severity]);

  const exposureMap = new Map<string, ManagerHubPayload["exposure"][number]>();
  for (const analysis of analyses) {
    const roster = [...analysis.lineup, ...analysis.bench].filter((player) => player.name !== "Empty");
    for (const player of roster) {
      const key = `${normalizeName(player.name)}::${player.position}`;
      const current = exposureMap.get(key);
      if (current) {
        current.leagues += 1;
        current.leagueNames.push(analysis.league.name);
        if (current.status === "Active" && player.status !== "Active") current.status = player.status;
      } else {
        exposureMap.set(key, {
          name: player.name,
          position: player.position,
          nflTeam: player.nflTeam,
          leagues: 1,
          totalLeagues: leagues.length,
          status: player.status,
          leagueNames: [analysis.league.name],
        });
      }
    }
  }

  const exposure = [...exposureMap.values()].sort((a, b) => {
    const riskA = a.status === "Active" ? 0 : 1;
    const riskB = b.status === "Active" ? 0 : 1;
    return riskB - riskA || b.leagues - a.leagues || a.name.localeCompare(b.name);
  });

  const weeklyOdds = (
    await Promise.all(
      analyses.map(async (analysis) => {
        if (!analysis.myTeam) return [];
        const { data: rows } = await supabase
          .from("weekly_snapshots")
          .select("week, title_odds, playoff_odds")
          .eq("league_id", analysis.league.id)
          .eq("team_id", analysis.myTeam.id)
          .order("week", { ascending: true });
        const points = (rows ?? []).map((row) => ({
          week: row.week,
          titleOdds: Number(row.title_odds),
          playoffOdds: Number(row.playoff_odds),
        }));
        if (!points.length) {
          points.push({
            week: analysis.league.current_week ?? 1,
            titleOdds: analysis.myTeam.titleOdds,
            playoffOdds: analysis.myTeam.playoffOdds,
          });
        }
        return [{
          leagueId: analysis.league.id,
          leagueName: analysis.league.name,
          teamName: analysis.myTeam.name,
          points,
        }];
      }),
    )
  ).flat();

  return { leagues, moves, trades, waivers, alerts, exposure, weeklyOdds };
}