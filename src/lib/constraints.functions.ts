/** Per-league manager choices: hands-off players, shop list, team class. */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizeName } from "@/lib/fantasy/names";

const TAGS = ["untouchable", "shopping"] as const;

export const listPlayerConstraintsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ leagueId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("player_constraints")
      .select("player_name, norm_name, tag")
      .eq("league_id", data.leagueId);
    if (error) throw new Error(error.message);
    return {
      players: (rows ?? []).map((r) => ({
        name: r.player_name,
        normName: r.norm_name,
        tag: r.tag as (typeof TAGS)[number],
      })),
    };
  });

/** Marks a player untouchable or on the block; "none" clears the tag. */
export const setPlayerConstraintFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        leagueId: z.string().uuid(),
        playerName: z.string().min(1),
        playerId: z.string().uuid().nullable().optional(),
        tag: z.enum(["untouchable", "shopping", "none"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const normName = normalizeName(data.playerName);
    if (data.tag === "none") {
      const { error } = await context.supabase
        .from("player_constraints")
        .delete()
        .eq("league_id", data.leagueId)
        .eq("norm_name", normName);
      if (error) throw new Error(error.message);
      return { ok: true, tag: null };
    }

    const { error } = await context.supabase.from("player_constraints").upsert(
      {
        user_id: context.userId,
        league_id: data.leagueId,
        player_id: data.playerId ?? null,
        player_name: data.playerName,
        norm_name: normName,
        tag: data.tag,
      },
      { onConflict: "user_id,league_id,norm_name" },
    );
    if (error) throw new Error(error.message);
    return { ok: true, tag: data.tag };
  });

/**
 * A manager can tell the app how to treat their team whatever the record says;
 * "auto" hands the decision back to the standings.
 */
export const setTeamClassOverrideFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        leagueId: z.string().uuid(),
        teamClass: z.enum(["contender", "middle", "rebuilder", "auto"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("leagues")
      .update({ class_override: data.teamClass === "auto" ? null : data.teamClass })
      .eq("id", data.leagueId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
