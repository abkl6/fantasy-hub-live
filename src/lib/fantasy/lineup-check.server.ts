/** Builds the pre-kickoff lineup check across every league. Server-only. */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { buildAnalysis } from "./analysis.server";
import { slotAccepts, type Slot } from "./engine";
import type {
  LineupCheckLeague,
  LineupCheckPayload,
  LineupIssue,
  LineupState,
} from "./lineup-check-types";

export type * from "./lineup-check-types";

type DB = SupabaseClient<Database>;

const OUT_STATUSES = new Set(["Out", "IR", "Suspended", "Doubtful", "Inactive"]);
const RISKY_STATUSES = new Set(["Questionable", "Probable", "Limited"]);

/** The platform page where the manager can actually set their lineup. */
function externalLineupLink(platform: string, externalId: string | null) {
  const id = externalId ?? "";
  switch (platform) {
    case "sleeper":
      return id
        ? { url: `https://sleeper.com/leagues/${id}/team`, label: "Open on Sleeper" }
        : { url: "https://sleeper.com/leagues", label: "Open on Sleeper" };
    case "yahoo":
      return id
        ? { url: `https://football.fantasysports.yahoo.com/f1/${id.split(".").pop()}`, label: "Open on Yahoo" }
        : { url: "https://football.fantasysports.yahoo.com/f1", label: "Open on Yahoo" };
    case "espn":
      return id
        ? { url: `https://fantasy.espn.com/football/team?leagueId=${id}`, label: "Open on ESPN" }
        : { url: "https://fantasy.espn.com/football/", label: "Open on ESPN" };
    case "nfl":
      return id
        ? { url: `https://fantasy.nfl.com/league/${id}`, label: "Open on NFL.com" }
        : { url: "https://fantasy.nfl.com", label: "Open on NFL.com" };
    case "ffpc":
      return { url: "https://myffpc.com", label: "Open on FFPC" };
    default:
      return null;
  }
}

export async function buildLineupCheck(supabase: DB): Promise<LineupCheckPayload> {
  const { data: leagueRows, error } = await supabase
    .from("leagues")
    .select("id, name, platform, color, external_id, current_week")
    .order("created_at");
  if (error) throw new Error(error.message);

  const leagues: LineupCheckLeague[] = [];

  for (const row of leagueRows ?? []) {
    const analysis = await buildAnalysis(supabase, row.id);
    if (!analysis.myTeam) continue;

    const week = row.current_week;
    const bench = analysis.bench.filter((p) => p.name !== "Empty");
    const issues: LineupIssue[] = [];

    for (const starter of analysis.lineup) {
      if (starter.name === "Empty") continue;

      // Best healthy bench player who can legally fill this slot.
      const options = bench
        .filter((p) => slotAccepts(starter.slot as Slot, p.position))
        .filter((p) => !OUT_STATUSES.has(p.status) && p.byeWeek !== week)
        .sort((a, b) => b.proj - a.proj);
      const best = options[0] ?? null;
      const gain = best ? Number((best.proj - starter.proj).toFixed(1)) : null;

      const onBye = starter.byeWeek === week;
      const isOut = OUT_STATUSES.has(starter.status);

      if (isOut || onBye) {
        issues.push({
          id: `${row.id}:${starter.slot}:${starter.name}:out`,
          severity: "red",
          kind: onBye ? "bye" : "out",
          starter: starter.name,
          starterPosition: starter.position,
          slot: starter.slot,
          problem: onBye ? `On bye in week ${week}` : `Listed ${starter.status}`,
          replacement: best?.name ?? null,
          replacementPosition: best?.position ?? null,
          gain,
        });
        continue;
      }

      if (RISKY_STATUSES.has(starter.status)) {
        issues.push({
          id: `${row.id}:${starter.slot}:${starter.name}:risk`,
          severity: "yellow",
          kind: "questionable",
          starter: starter.name,
          starterPosition: starter.position,
          slot: starter.slot,
          problem: `Listed ${starter.status} — check before kickoff`,
          replacement: best?.name ?? null,
          replacementPosition: best?.position ?? null,
          gain,
        });
        continue;
      }

      if (best && gain !== null && gain >= 3) {
        issues.push({
          id: `${row.id}:${starter.slot}:${starter.name}:upgrade`,
          severity: "yellow",
          kind: "upgrade",
          starter: starter.name,
          starterPosition: starter.position,
          slot: starter.slot,
          problem: `${best.name} projects ${gain} points higher`,
          replacement: best.name,
          replacementPosition: best.position,
          gain,
        });
      }
    }

    const state: LineupState = issues.some((i) => i.severity === "red")
      ? "red"
      : issues.length
        ? "yellow"
        : "green";
    const reds = issues.filter((i) => i.severity === "red").length;
    const summary =
      state === "green"
        ? "Lineup looks good"
        : state === "red"
          ? `${reds} starter${reds === 1 ? "" : "s"} can't play`
          : `${issues.length} thing${issues.length === 1 ? "" : "s"} to look at`;

    const link = externalLineupLink(row.platform, row.external_id);

    leagues.push({
      id: row.id,
      name: row.name,
      platform: row.platform,
      color: row.color,
      teamName: analysis.myTeam.name,
      week,
      state,
      summary,
      issues,
      externalUrl: link?.url ?? null,
      externalLabel: link?.label ?? null,
    });
  }

  const rank: Record<LineupState, number> = { red: 0, yellow: 1, green: 2 };
  leagues.sort((a, b) => rank[a.state] - rank[b.state] || a.name.localeCompare(b.name));

  return { generatedAt: new Date().toISOString(), leagues };
}
