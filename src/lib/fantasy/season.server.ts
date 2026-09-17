/**
 * The Season tab: how the rest of the year could go for my team — the spread
 * of finishes, win totals and seeds from the same season run the rest of the
 * page uses, the week-by-week odds trail, and the games still to play.
 * Server-only.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { simulateSeason, type ScheduleGame, type SimTeamInput, type SimTeamResult } from "./engine";
import type {
  SeasonGame,
  SeasonMarker,
  SeasonOutcome,
  SeasonPayload,
  SeasonSimSnapshot,
  SeasonWeekOdds,
} from "./season-types";

type DB = SupabaseClient<Database>;

function erf(x: number) {
  const sign = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-a * a);
  return sign * y;
}

const normalCdf = (x: number) => 0.5 * (1 + erf(x / Math.sqrt(2)));

/** Reads a team's spread out of a finished simulation. */
export function outcomeOf(result: SimTeamResult): SeasonOutcome {
  return {
    iterations: result.iterations ?? 0,
    titleOdds: result.titleOdds,
    playoffOdds: result.playoffOdds,
    projWins: result.projWins,
    projLosses: result.projLosses,
    finish: result.finish ?? {
      missed: 1 - result.playoffOdds,
      wildCard: 0,
      bye: 0,
      semifinal: 0,
      final: 0,
      champion: result.titleOdds,
    },
    winSpread: (result.winCounts ?? [])
      .map((share, wins) => ({ wins, share }))
      .filter((row) => row.share > 0.0005),
    seedSpread: (result.seedCounts ?? [])
      .map((share, i) => ({ seed: i + 1, share }))
      .filter((row) => row.share > 0.0005),
  };
}

/** Wins the last team into the bracket usually finishes on. */
export function playoffCutLine(results: SimTeamResult[], playoffTeams: number): number | null {
  if (!results.length) return null;
  const byWins = [...results].sort((a, b) => b.projWins - a.projWins);
  const last = byWins[Math.min(byWins.length, Math.max(1, playoffTeams)) - 1];
  return last ? Math.round(last.projWins * 10) / 10 : null;
}

/** Re-runs the season with some results locked in. */
export function runScenario(
  sim: SeasonSimSnapshot,
  myTeamId: string,
  forced: { week: number; win: boolean }[],
): SeasonOutcome {
  const results = simulateSeason(
    sim.teams,
    {
      ...sim.config,
      distributions: true,
      forced: forced.map((f) => ({ week: f.week, teamId: myTeamId, win: f.win })),
    },
    sim.schedule,
    2000,
    7,
  );
  const mine = results.find((r) => r.id === myTeamId);
  return mine
    ? outcomeOf(mine)
    : {
        iterations: 0,
        titleOdds: 0,
        playoffOdds: 0,
        projWins: 0,
        projLosses: 0,
        finish: { missed: 1, wildCard: 0, bye: 0, semifinal: 0, final: 0, champion: 0 },
        winSpread: [],
        seedSpread: [],
      };
}

interface BuildInput {
  leagueId: string;
  season: number;
  currentWeek: number;
  playoffTeams: number;
  myTeamId: string;
  myTeamName: string;
  currentRecord: string;
  currentWins: number;
  simInputs: SimTeamInput[];
  simConfig: SeasonSimSnapshot["config"];
  schedule: ScheduleGame[];
  baseline: SimTeamResult[];
  teamNames: Map<string, string>;
  rosterPlayerIds: string[];
}

export async function buildSeason(supabase: DB, input: BuildInput): Promise<SeasonPayload | null> {
  const mine = input.baseline.find((r) => r.id === input.myTeamId);
  if (!mine) return null;

  const byId = new Map(input.simInputs.map((t) => [t.id, t]));
  const me = byId.get(input.myTeamId);

  const remaining: SeasonGame[] = input.schedule
    .filter(
      (g) =>
        g.week >= input.currentWeek &&
        (g.homeTeamId === input.myTeamId || g.awayTeamId === input.myTeamId),
    )
    .sort((a, b) => a.week - b.week)
    .map((g) => {
      const opponentId = g.homeTeamId === input.myTeamId ? g.awayTeamId : g.homeTeamId;
      const them = byId.get(opponentId);
      const spread =
        me && them ? Math.sqrt(me.sd * me.sd + them.sd * them.sd) || 1 : 1;
      const winProb =
        me && them ? Math.round(normalCdf((me.mean - them.mean) / spread) * 1000) / 1000 : 0.5;
      return {
        week: g.week,
        opponentId,
        opponentName: input.teamNames.get(opponentId) ?? "Opponent",
        winProb,
      };
    });

  const history = await buildHistory(supabase, input);

  return {
    myTeamId: input.myTeamId,
    myTeamName: input.myTeamName,
    currentRecord: input.currentRecord,
    currentWins: input.currentWins,
    playoffCut: playoffCutLine(input.baseline, input.playoffTeams),
    outcome: outcomeOf(mine),
    history,
    remaining,
    sim: { teams: input.simInputs, config: input.simConfig, schedule: input.schedule },
  };
}

/** The odds trail, with what happened alongside each week. */
async function buildHistory(supabase: DB, input: BuildInput): Promise<SeasonWeekOdds[]> {
  const [snapshots, trades, results, news] = await Promise.all([
    supabase
      .from("weekly_snapshots")
      .select("week, title_odds, playoff_odds")
      .eq("league_id", input.leagueId)
      .eq("team_id", input.myTeamId)
      .order("week"),
    supabase
      .from("trade_history")
      .select("week, partner_team_name, status")
      .eq("league_id", input.leagueId)
      .eq("team_id", input.myTeamId),
    supabase
      .from("matchups")
      .select("week, home_team_id, away_team_id, home_score, away_score, is_final")
      .eq("league_id", input.leagueId)
      .or(`home_team_id.eq.${input.myTeamId},away_team_id.eq.${input.myTeamId}`),
    input.rosterPlayerIds.length
      ? supabase
          .from("player_news")
          .select("player_name, status, published_at")
          .in("player_id", input.rosterPlayerIds.slice(0, 200))
          .in("status", ["out", "Out", "IR", "ir", "doubtful", "Doubtful"])
          .order("published_at", { ascending: false })
          .limit(60)
      : Promise.resolve({ data: [] as { player_name: string; status: string; published_at: string }[] }),
  ]);

  const markers = new Map<number, SeasonMarker[]>();
  const push = (week: number, marker: SeasonMarker) => {
    const list = markers.get(week) ?? [];
    if (list.length < 3) list.push(marker);
    markers.set(week, list);
  };

  for (const t of trades.data ?? []) {
    if (t.status === "rejected") continue;
    push(t.week, { kind: "trade", label: `Trade with ${t.partner_team_name ?? "another team"}` });
  }

  for (const m of results.data ?? []) {
    if (!m.is_final) continue;
    const mineHome = m.home_team_id === input.myTeamId;
    const my = Number(mineHome ? m.home_score : m.away_score);
    const their = Number(mineHome ? m.away_score : m.home_score);
    push(m.week, {
      kind: "result",
      label: `${my > their ? "Won" : my < their ? "Lost" : "Tied"} ${my.toFixed(1)}–${their.toFixed(1)}`,
    });
  }

  // News carries a date, not a week; weeks are seven days apart, so counting
  // back from this week places each item closely enough for a marker.
  for (const n of (news as { data?: { player_name: string; published_at: string }[] }).data ?? []) {
    const daysAgo = (Date.now() - new Date(n.published_at).getTime()) / 86_400_000;
    const week = input.currentWeek - Math.floor(Math.max(0, daysAgo) / 7);
    if (week < 1) continue;
    push(week, { kind: "injury", label: `${n.player_name} listed out` });
  }

  const rows = (snapshots.data ?? []).map((s) => ({
    week: s.week,
    titleOdds: Number(s.title_odds),
    playoffOdds: Number(s.playoff_odds),
    markers: markers.get(s.week) ?? [],
  }));

  // Always finish on this week, even before a snapshot has been written.
  if (!rows.some((r) => r.week === input.currentWeek)) {
    const mine = input.baseline.find((r) => r.id === input.myTeamId);
    if (mine)
      rows.push({
        week: input.currentWeek,
        titleOdds: mine.titleOdds,
        playoffOdds: mine.playoffOdds,
        markers: markers.get(input.currentWeek) ?? [],
      });
  }

  return rows.sort((a, b) => a.week - b.week);
}
