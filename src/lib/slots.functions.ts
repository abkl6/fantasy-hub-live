import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { clearCache } from "@/lib/fantasy/cache.server";
import { inferUnknownSlots, loadLeagueSlots } from "@/lib/fantasy/slots.server";
import { slotLabel, type LeagueSlot } from "@/lib/fantasy/slots";

const slotInput = z.object({
  key: z.string().min(1).max(24),
  label: z.string().min(1).max(40).optional(),
  count: z.number().int().min(0).max(12),
  eligible: z.array(z.string().min(1).max(6)).max(12),
});

/** The league's starting spots, guessing at anything unread first. */
export const getLeagueSlots = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ leagueId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const slots = await inferUnknownSlots(context.supabase, data.leagueId);
    return {
      slots,
      needsConfirmation: slots.filter((s) => s.source === "inferred"),
    };
  });

/** Saves the member's own answer; a later sync leaves these rows alone. */
export const saveLeagueSlots = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ leagueId: z.string().uuid(), slots: z.array(slotInput).min(1).max(30) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const rows = data.slots
      .filter((s) => s.count > 0)
      .map((s, i) => ({
        user_id: context.userId,
        league_id: data.leagueId,
        slot_key: s.key.toUpperCase(),
        label: s.label?.trim() || slotLabel(s.key.toUpperCase(), s.eligible),
        count: s.count,
        eligible_positions: s.eligible.map((p) => p.toUpperCase()),
        source: "user",
        sort_order: i,
      }));

    const { error } = await context.supabase
      .from("league_slots")
      .upsert(rows as never, { onConflict: "league_id,slot_key" });
    if (error) throw new Error(error.message);

    const keep = rows.map((r) => r.slot_key);
    await context.supabase
      .from("league_slots")
      .delete()
      .eq("league_id", data.leagueId)
      .not("slot_key", "in", `(${keep.map((k) => `"${k}"`).join(",")})`);

    // Every stored result was worked out with the old spots.
    await clearCache(context.supabase, context.userId, data.leagueId);

    const slots: LeagueSlot[] = await loadLeagueSlots(context.supabase, data.leagueId);
    return { slots };
  });

/** Accepts the guessed positions for a slot as they stand. */
export const confirmLeagueSlots = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ leagueId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("league_slots")
      .update({ source: "user" } as never)
      .eq("league_id", data.leagueId)
      .eq("source", "inferred");
    if (error) throw new Error(error.message);
    return { slots: await loadLeagueSlots(context.supabase, data.leagueId) };
  });
