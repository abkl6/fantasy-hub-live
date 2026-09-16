/**
 * Vegas implied team totals: how many points each NFL team is expected to
 * score this week. Pulled from the public scoreboard feed, which carries the
 * game total and the spread. Server-only.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

import { buildImpliedBook, type ImpliedBook, type ImpliedRow, NEUTRAL_IMPLIED } from "./implied";
import { FEED_HEADERS } from "./live.server";

type DB = SupabaseClient<Database>;

const ESPN_SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";

async function getJson<T>(url: string): Promise<T | null> {
  for (const init of [{ headers: FEED_HEADERS }, {}]) {
    try {
      const res = await fetch(url, init);
      if (!res.ok) continue;
      return (await res.json()) as T;
    } catch {
      // try the next header set
    }
  }
  return null;
}

interface Board {
  events?: {
    competitions?: {
      competitors?: { homeAway?: string; team?: { abbreviation?: string } }[];
      odds?: { overUnder?: number; spread?: number; details?: string }[];
    }[];
  }[];
}

/** One week of implied totals, read from the scoreboard's betting lines. */
export async function fetchImpliedTotals(season: number, week: number): Promise<ImpliedRow[]> {
  let board = await getJson<Board>(`${ESPN_SCOREBOARD}?week=${week}`);
  if (!board?.events?.length) {
    board = await getJson<Board>(`${ESPN_SCOREBOARD}?dates=${season}&seasontype=2&week=${week}`);
  }

  const rows: ImpliedRow[] = [];
  for (const event of board?.events ?? []) {
    const comp = event.competitions?.[0];
    const odds = comp?.odds?.[0];
    const total = Number(odds?.overUnder);
    if (!Number.isFinite(total) || total <= 0) continue;

    const home = comp?.competitors?.find((c) => c.homeAway === "home")?.team?.abbreviation;
    const away = comp?.competitors?.find((c) => c.homeAway === "away")?.team?.abbreviation;
    if (!home || !away) continue;

    // ESPN quotes the spread from the favourite's point of view, negative for
    // the home team when the home team is favoured.
    const spread = Number(odds?.spread);
    const edge = Number.isFinite(spread) ? spread / 2 : 0;
    rows.push({ week, nflTeam: home.toUpperCase(), implied: total / 2 - edge });
    rows.push({ week, nflTeam: away.toUpperCase(), implied: total / 2 + edge });
  }
  return rows;
}

/** Pull a range of weeks and save them. Hand-edited rows are left alone. */
export async function refreshImpliedTotals(
  admin: DB,
  season: number,
  weeks: number[],
): Promise<{ rows: number }> {
  const { data: manual } = await admin
    .from("team_implied_totals")
    .select("week, nfl_team")
    .eq("season", season)
    .eq("source", "user");
  const held = new Set((manual ?? []).map((m) => `${m.week}|${m.nfl_team}`));

  const upserts: Record<string, unknown>[] = [];
  for (const week of weeks) {
    const rows = await fetchImpliedTotals(season, week);
    for (const row of rows) {
      if (held.has(`${row.week}|${row.nflTeam}`)) continue;
      upserts.push({
        season,
        week: row.week,
        nfl_team: row.nflTeam,
        implied: Math.round(row.implied * 10) / 10,
        source: "odds",
      });
    }
  }
  if (!upserts.length) return { rows: 0 };

  for (let i = 0; i < upserts.length; i += 300) {
    const { error } = await admin
      .from("team_implied_totals")
      .upsert(upserts.slice(i, i + 300) as never, { onConflict: "season,week,nfl_team" });
    if (error) throw new Error(error.message);
  }
  return { rows: upserts.length };
}

/** Everything known about this season's lines, ready to scale projections. */
export async function loadImpliedBook(supabase: DB, season: number): Promise<ImpliedBook> {
  const { data } = await supabase
    .from("team_implied_totals")
    .select("week, nfl_team, implied")
    .eq("season", season);
  if (!data?.length) return NEUTRAL_IMPLIED;
  return buildImpliedBook(
    data.map((r) => ({ week: r.week, nflTeam: r.nfl_team, implied: Number(r.implied) })),
  );
}

/** Raw line for one team and week, for the opponent tooltip. */
export async function impliedFor(
  supabase: DB,
  season: number,
  week: number,
): Promise<Map<string, number>> {
  const { data } = await supabase
    .from("team_implied_totals")
    .select("nfl_team, implied")
    .eq("season", season)
    .eq("week", week);
  return new Map((data ?? []).map((r) => [r.nfl_team.toUpperCase(), Number(r.implied)]));
}
