/** Builds rival-manager profiles from a league's own trade history. Server-only. */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { normalizeName } from "./names";
import { buildManagerProfile, type ManagerMove, type ManagerProfile } from "./manager-profile";

type DB = SupabaseClient<Database>;

interface PlayerFact {
  age: number | null;
  position: string;
  value: number;
}

/**
 * Every recorded trade in this league, read from each rival's point of view:
 * who they took in, who they sent out, and how the market value landed.
 */
export async function loadManagerProfiles(
  supabase: DB,
  leagueId: string,
  facts: (name: string) => PlayerFact,
): Promise<Map<string, ManagerProfile>> {
  const { data: rows } = await supabase
    .from("manual_transactions")
    .select("occurred_on, kind, player_name, position, from_team_id, to_team_id")
    .eq("league_id", leagueId)
    .eq("kind", "trade");

  // One trade is several rows — group them by the day and the two teams.
  const moves = new Map<string, Map<string, ManagerMove>>();
  const blank = (): ManagerMove => ({
    gotAges: [],
    gotPositions: [],
    gotPicks: 0,
    gaveAges: [],
    gavePositions: [],
    gavePicks: 0,
    valueGap: 0,
    // Only completed trades are recorded, so every one of them was a yes.
    accepted: true,
  });

  const touch = (teamId: string, dealKey: string) => {
    const perTeam = moves.get(teamId) ?? new Map<string, ManagerMove>();
    const move = perTeam.get(dealKey) ?? blank();
    perTeam.set(dealKey, move);
    moves.set(teamId, perTeam);
    return move;
  };

  for (const row of rows ?? []) {
    if (!row.from_team_id || !row.to_team_id) continue;
    const dealKey = `${row.occurred_on}:${[row.from_team_id, row.to_team_id].sort().join("|")}`;
    const fact = facts(normalizeName(row.player_name));
    const position = (row.position ?? fact.position ?? "").toUpperCase();

    const receiver = touch(row.to_team_id, dealKey);
    if (fact.age !== null) receiver.gotAges.push(fact.age);
    if (position) receiver.gotPositions.push(position);
    receiver.valueGap += fact.value;

    const sender = touch(row.from_team_id, dealKey);
    if (fact.age !== null) sender.gaveAges.push(fact.age);
    if (position) sender.gavePositions.push(position);
    sender.valueGap -= fact.value;
  }

  const profiles = new Map<string, ManagerProfile>();
  for (const [teamId, perTeam] of moves) {
    profiles.set(teamId, buildManagerProfile(teamId, [...perTeam.values()]));
  }
  return profiles;
}

export interface PlayerConstraint {
  normName: string;
  playerName: string;
  tag: "untouchable" | "shopping";
}

/** The manager's own hands-off and actively-shopped list for this league. */
export async function loadPlayerConstraints(
  supabase: DB,
  leagueId: string,
): Promise<{ untouchable: Set<string>; shopping: Set<string>; rows: PlayerConstraint[] }> {
  const { data } = await supabase
    .from("player_constraints")
    .select("player_name, norm_name, tag")
    .eq("league_id", leagueId);

  const rows: PlayerConstraint[] = (data ?? []).map((r) => ({
    normName: r.norm_name,
    playerName: r.player_name,
    tag: r.tag === "untouchable" ? "untouchable" : "shopping",
  }));
  return {
    untouchable: new Set(rows.filter((r) => r.tag === "untouchable").map((r) => r.normName)),
    shopping: new Set(rows.filter((r) => r.tag === "shopping").map((r) => r.normName)),
    rows,
  };
}
