import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { LeagueStripPayload } from "@/lib/fantasy/strip-types";

/** Tiles for the persistent league strip. */
export const getLeagueStripFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<LeagueStripPayload> => {
    const { buildLeagueStrip } = await import("./fantasy/strip.server");
    return buildLeagueStrip(context.supabase);
  });

/** Bumps how often a league is opened, which drives the default tile order. */
export const recordLeagueOpenFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ leagueId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row } = await context.supabase
      .from("leagues")
      .select("open_count")
      .eq("id", data.leagueId)
      .maybeSingle();
    await context.supabase
      .from("leagues")
      .update({ open_count: (row?.open_count ?? 0) + 1 } as never)
      .eq("id", data.leagueId);
    return { ok: true };
  });

/** Saves a hand-picked tile order. An empty list goes back to automatic. */
export const saveStripOrderFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ leagueIds: z.array(z.string().uuid()).max(64) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    if (!data.leagueIds.length) {
      await context.supabase
        .from("leagues")
        .update({ strip_order: null } as never)
        .eq("user_id", context.userId);
      return { ok: true };
    }
    for (const [index, id] of data.leagueIds.entries()) {
      await context.supabase
        .from("leagues")
        .update({ strip_order: index } as never)
        .eq("id", id);
    }
    return { ok: true };
  });
