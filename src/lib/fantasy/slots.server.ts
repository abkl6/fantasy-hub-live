/**
 * Reading and keeping up to date each league's own starting slots.
 *
 * A league's slots are stored once (detected from the platform, inferred from
 * real lineups, or confirmed by the member) and every calculation reads them
 * from there. Server-only.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import {
  DEFAULT_CODES,
  DEFAULT_SLOTS,
  expandSlots,
  filterSlotCodesByObserved,
  inferEligibility,
  resolvedKey,
  slotLabel,
  slotLabels,
  slotsFromCodes,
  type LeagueSlot,
  type SlotSource,
} from "./slots";

type DB = SupabaseClient<Database>;

interface SlotRow {
  slot_key: string;
  label: string;
  count: number;
  eligible_positions: string[] | null;
  source: string;
  sort_order: number;
}

function toSlot(row: SlotRow): LeagueSlot {
  return {
    key: row.slot_key,
    label: row.label,
    count: row.count,
    eligible: row.eligible_positions ?? [],
    source: (["detected", "inferred", "user"].includes(row.source) ? row.source : "detected") as SlotSource,
  };
}

/** The slot keys the optimiser walks, one entry per starting spot. */
export function lineupSlotKeys(slots: readonly LeagueSlot[]): string[] {
  return expandSlots(slots).map(resolvedKey);
}

/** Slot key to the positions it accepts — the only eligibility table used. */
export function slotEligibility(slots: readonly LeagueSlot[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const slot of slots) out[resolvedKey(slot).toUpperCase()] = [...slot.eligible];
  return out;
}

async function persist(
  supabase: DB,
  userId: string,
  leagueId: string,
  slots: readonly LeagueSlot[],
): Promise<void> {
  if (!slots.length) return;
  await supabase.from("league_slots").upsert(
    slots.map((slot, i) => ({
      user_id: userId,
      league_id: leagueId,
      slot_key: slot.key,
      label: slot.label,
      count: slot.count,
      eligible_positions: slot.eligible,
      source: slot.source,
      sort_order: i,
    })) as never,
    { onConflict: "league_id,slot_key" },
  );
}

/**
 * A league whose platform never told us its lineup gets one worked out from
 * what its teams actually roster, so positions nobody holds (often kicker and
 * defence) never become starting spots.
 */
async function guessSlotsFromRosters(supabase: DB, leagueId: string): Promise<LeagueSlot[]> {
  const { data: spots } = await supabase
    .from("roster_spots")
    .select("position, team_id")
    .eq("league_id", leagueId);
  if (!spots?.length) return [...DEFAULT_SLOTS];
  const teamCount = new Set(spots.map((s) => s.team_id)).size;
  const codes = filterSlotCodesByObserved(
    DEFAULT_CODES,
    spots.map((s) => String(s.position ?? "")),
    teamCount,
  );
  const slots = slotsFromCodes(codes, "inferred");
  return slots.length ? slots : [...DEFAULT_SLOTS];
}

/**
 * The league's slots, filling them in from the platform's slot list the first
 * time they are asked for.
 */
export async function loadLeagueSlots(supabase: DB, leagueId: string): Promise<LeagueSlot[]> {
  const { data } = await supabase
    .from("league_slots")
    .select("slot_key, label, count, eligible_positions, source, sort_order")
    .eq("league_id", leagueId)
    .order("sort_order");

  if (data?.length) return (data as SlotRow[]).map(toSlot);

  const { data: league } = await supabase
    .from("leagues")
    .select("user_id, roster_slots")
    .eq("id", leagueId)
    .maybeSingle();
  if (!league) return [...DEFAULT_SLOTS];

  const codes = Array.isArray(league.roster_slots) ? (league.roster_slots as unknown[]) : [];
  const slots = codes.length
    ? slotsFromCodes(codes as (string | number)[])
    : await guessSlotsFromRosters(supabase, leagueId);
  await persist(supabase, league.user_id, leagueId, slots).catch(() => {
    // A league that cannot store its slots still works off the derived list.
  });
  return slots;
}

/**
 * Writes what the platform reported. Slots the member confirmed are left
 * exactly as they are — a sync never overwrites a person's answer.
 */
export async function syncLeagueSlots(
  supabase: DB,
  userId: string,
  leagueId: string,
  codes: readonly (string | number)[],
): Promise<LeagueSlot[]> {
  const detected = slotsFromCodes(codes);
  if (!detected.length) return loadLeagueSlots(supabase, leagueId);

  const { data: existing } = await supabase
    .from("league_slots")
    .select("slot_key, source")
    .eq("league_id", leagueId);
  const confirmed = new Set(
    (existing ?? []).filter((r) => r.source === "user").map((r) => r.slot_key),
  );

  const writable = detected.filter((s) => !confirmed.has(s.key));
  await persist(supabase, userId, leagueId, writable);

  // Slots the platform no longer reports go, unless the member set them.
  const keep = new Set([...detected.map((s) => s.key), ...confirmed]);
  const stale = (existing ?? []).filter((r) => !keep.has(r.slot_key)).map((r) => r.slot_key);
  if (stale.length) {
    await supabase.from("league_slots").delete().eq("league_id", leagueId).in("slot_key", stale);
  }

  return loadLeagueSlots(supabase, leagueId);
}

/**
 * For any slot we could not read, look at what teams actually started there
 * this season and mark the result as inferred so the league page can ask.
 */
export async function inferUnknownSlots(supabase: DB, leagueId: string): Promise<LeagueSlot[]> {
  const slots = await loadLeagueSlots(supabase, leagueId);
  const unknown = slots.filter((s) => s.source !== "user" && !s.eligible.length);
  if (!unknown.length) return slots;

  const { data: spots } = await supabase
    .from("roster_spots")
    .select("slot, position")
    .eq("league_id", leagueId);

  const observed = new Map<string, string[]>();
  for (const row of spots ?? []) {
    const key = String(row.slot ?? "").toUpperCase();
    const list = observed.get(key) ?? [];
    list.push(String(row.position ?? ""));
    observed.set(key, list);
  }

  const updated = slots.map((slot) => {
    if (!unknown.includes(slot)) return slot;
    const eligible = inferEligibility(observed.get(slot.key.toUpperCase()) ?? []);
    if (!eligible.length) return slot;
    return {
      ...slot,
      eligible,
      label: slotLabel(slot.key, eligible),
      source: "inferred" as SlotSource,
    };
  });

  const { data: league } = await supabase
    .from("leagues")
    .select("user_id")
    .eq("id", leagueId)
    .maybeSingle();
  if (league) await persist(supabase, league.user_id, leagueId, updated);
  return updated;
}

/** Everything a calculation needs to place players in slots. */
export interface SlotPlan {
  slots: LeagueSlot[];
  keys: string[];
  eligibility: Record<string, string[]>;
  positions: string[];
  labels: Record<string, string>;
  /** Slots we had to guess at and would like the member to confirm. */
  needsConfirmation: LeagueSlot[];
}

export async function loadSlotPlan(supabase: DB, leagueId: string): Promise<SlotPlan> {
  // Works out anything the platform left unsaid, then leaves it alone.
  const slots = await inferUnknownSlots(supabase, leagueId);
  const positions: string[] = [];
  for (const slot of slots) {
    for (const p of slot.eligible) if (!positions.includes(p)) positions.push(p);
  }
  return {
    slots,
    keys: lineupSlotKeys(slots),
    eligibility: slotEligibility(slots),
    positions,
    labels: slotLabels(slots),
    needsConfirmation: slots.filter((s) => s.source === "inferred"),
  };
}
