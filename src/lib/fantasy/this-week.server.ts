/**
 * "This week" — one prioritized to-do list across every league for the days
 * between Monday night and the first kickoff. Server-only.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { buildAnalysis } from "./analysis.server";
import { nextKickoff, nextWaiverRun } from "./gamewindow";

type DB = SupabaseClient<Database>;

export type ThisWeekKind = "claim" | "lineup" | "trade-offer" | "waiver-deadline" | "rising";

export interface ThisWeekItem {
  id: string;
  kind: ThisWeekKind;
  /** Lower sorts first. */
  priority: number;
  leagueId: string;
  leagueName: string;
  leagueColor: string | null;
  title: string;
  detail: string;
  /** Short right-hand note, such as time remaining. */
  meta: string | null;
  /** Which league tab the row opens. */
  tab: "lineup" | "moves" | "league";
  swap: string | null;
  replacement: string | null;
}

export interface ThisWeekLeague {
  id: string;
  name: string;
  platform: string;
  color: string | null;
  teamName: string;
  record: string;
  week: number;
  items: ThisWeekItem[];
}

export interface ThisWeekPayload {
  generatedAt: string;
  kickoffAt: string;
  kickoffLabel: string;
  waiverRunAt: string;
  leagues: ThisWeekLeague[];
  items: ThisWeekItem[];
}

const PRIORITY: Record<ThisWeekKind, number> = {
  lineup: 0,
  claim: 1,
  "trade-offer": 2,
  "waiver-deadline": 3,
  rising: 4,
};

export async function buildThisWeek(supabase: DB): Promise<ThisWeekPayload> {
  const now = new Date();
  const kickoff = nextKickoff(now);
  const waiverRun = nextWaiverRun(now);

  const { data: leagueRows, error } = await supabase
    .from("leagues")
    .select("id, name, platform, color, current_week")
    .order("created_at");
  if (error) throw new Error(error.message);

  const leagues: ThisWeekLeague[] = [];

  for (const row of leagueRows ?? []) {
    const analysis = await buildAnalysis(supabase, row.id);
    if (!analysis.myTeam) continue;
    const week = row.current_week;
    const items: ThisWeekItem[] = [];

    const add = (
      kind: ThisWeekKind,
      id: string,
      title: string,
      detail: string,
      meta: string | null,
      tab: ThisWeekItem["tab"],
      swap: string | null = null,
      replacement: string | null = null,
    ) => {
      items.push({
        id: `${row.id}:${kind}:${id}`,
        kind,
        priority: PRIORITY[kind],
        leagueId: row.id,
        leagueName: row.name,
        leagueColor: row.color,
        title,
        detail,
        meta,
        tab,
        swap,
        replacement,
      });
    };

    // 1. Starters who are hurt, out or on bye for the coming week.
    const startSits = analysis.suggestions.filter((s) => s.kind === "start-sit");
    const starters = new Set(analysis.lineup.map((p) => p.name));
    for (const alert of analysis.alerts) {
      if (alert.kind === "news") continue;
      if (!starters.has(alert.playerName)) continue;
      const swapIdea = startSits.find((s) => s.dropName === alert.playerName);
      const replacement = swapIdea?.addName ?? bestBenchFor(analysis, alert.position);
      add(
        "lineup",
        alert.id,
        `${alert.playerName} — ${alert.kind === "bye" ? "on bye" : alert.message}`,
        replacement ? `Best replacement: ${replacement}` : "No clean replacement on your bench.",
        alert.severity === "high" ? "Urgent" : null,
        "lineup",
        alert.playerName,
        replacement,
      );
    }

    // 2. Waiver claims still waiting to process.
    const { data: bids } = await supabase
      .from("faab_bids")
      .select("id, player_name, amount, week, won")
      .eq("league_id", row.id)
      .eq("week", week)
      .eq("won", false);
    for (const bid of bids ?? []) {
      add(
        "claim",
        bid.id,
        `Claim in for ${bid.player_name}`,
        `$${bid.amount} bid, still pending`,
        "Pending",
        "moves",
      );
    }

    // 3. Trade offers you logged as still open.
    const { data: offers } = await supabase
      .from("trade_history")
      .select("id, partner_team_name, verdict, status, created_at")
      .eq("league_id", row.id)
      .in("status", ["pending", "offered", "proposed"]);
    for (const offer of offers ?? []) {
      add(
        "trade-offer",
        offer.id,
        `Trade offer from ${offer.partner_team_name ?? "another manager"}`,
        offer.verdict || "Open offer waiting on your answer.",
        "Open",
        "moves",
      );
    }

    // 4. The waiver clock itself.
    add(
      "waiver-deadline",
      "run",
      "Waivers process Wednesday 3:00am ET",
      (bids ?? []).length
        ? `${(bids ?? []).length} claim${(bids ?? []).length === 1 ? "" : "s"} in so far`
        : "No claims in yet",
      null,
      "moves",
    );

    // 5. Available players trending up.
    const rising = analysis.suggestions
      .filter((s) => s.kind === "waiver" && s.pointsDelta > 0)
      .slice(0, 3);
    for (const move of rising) {
      add(
        "rising",
        move.id,
        `${move.addName ?? move.headline} is available`,
        move.detail,
        `+${move.pointsDelta.toFixed(1)} pts`,
        "moves",
        null,
        move.addName ?? null,
      );
    }

    items.sort((a, b) => a.priority - b.priority);
    leagues.push({
      id: row.id,
      name: row.name,
      platform: row.platform,
      color: row.color,
      teamName: analysis.myTeam.name,
      record: analysis.myTeam.record,
      week,
      items,
    });
  }

  const items = leagues
    .flatMap((l) => l.items)
    .sort((a, b) => a.priority - b.priority || a.leagueName.localeCompare(b.leagueName));

  return {
    generatedAt: now.toISOString(),
    kickoffAt: kickoff.at.toISOString(),
    kickoffLabel: kickoff.label,
    waiverRunAt: waiverRun.toISOString(),
    leagues,
    items,
  };
}

/** Highest projected healthy bench player who plays the same position. */
function bestBenchFor(
  analysis: Awaited<ReturnType<typeof buildAnalysis>>,
  position: string,
): string | null {
  const best = analysis.bench
    .filter((p) => p.position === position && p.status === "Active" && p.name !== "Empty")
    .sort((a, b) => b.proj - a.proj)[0];
  return best?.name ?? null;
}
