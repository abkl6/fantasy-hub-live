/**
 * Turns an alert into pushes for one member: honours their toggles, skips
 * anything already sent, fans out to every registered device and prunes dead
 * endpoints. Server-only.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

import { sendWebPush, type PushPayload } from "./webpush.server";

type DB = SupabaseClient<Database>;

export type PrefKey = "inactives" | "scoring_plays" | "red_zone" | "lead_change" | "lineup_lock";

export interface NotifyOptions extends PushPayload {
  kind: PrefKey;
  /** Skips the send when a row with this key already exists for the member. */
  dedupeKey?: string;
  /** Free-form grouping key used by lead-change tracking. */
  ref?: string;
  detail?: string;
}

const DEFAULT_PREFS: Record<PrefKey, boolean> = {
  inactives: true,
  scoring_plays: false,
  red_zone: false,
  lead_change: true,
  lineup_lock: true,
};

export async function loadPrefs(admin: DB, userIds: string[]) {
  const { data } = await admin
    .from("notification_prefs")
    .select("*")
    .in("user_id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]);
  const map = new Map<string, Record<PrefKey, boolean>>();
  for (const row of data ?? []) {
    map.set(row.user_id, {
      inactives: row.inactives,
      scoring_plays: row.scoring_plays,
      red_zone: row.red_zone,
      lead_change: row.lead_change,
      lineup_lock: row.lineup_lock,
    });
  }
  for (const id of userIds) if (!map.has(id)) map.set(id, { ...DEFAULT_PREFS });
  return map;
}

/** Most recent detail recorded for a kind+ref pair (used for lead changes). */
export async function lastDetail(
  admin: DB,
  userId: string,
  kind: string,
  ref: string,
): Promise<string | null> {
  const { data } = await admin
    .from("notification_log")
    .select("detail")
    .eq("user_id", userId)
    .eq("kind", kind)
    .eq("ref", ref)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.detail ?? null;
}

/** Sends one alert to every device the member has registered. */
export async function notifyUser(
  admin: DB,
  userId: string,
  prefs: Record<PrefKey, boolean>,
  options: NotifyOptions,
): Promise<boolean> {
  if (!prefs[options.kind]) return false;

  const logRow = {
    user_id: userId,
    kind: options.kind,
    ref: options.ref ?? null,
    detail: options.detail ?? null,
    dedupe_key: options.dedupeKey ?? null,
    title: options.title,
    body: options.body,
    url: options.url ?? null,
  };

  const { error: logError } = await admin.from("notification_log").insert(logRow as never);
  if (logError) return false; // duplicate dedupe key -> already sent

  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId);
  if (!subs?.length) return false;

  const dead: string[] = [];
  await Promise.all(
    subs.map(async (sub) => {
      const result = await sendWebPush(sub, {
        title: options.title,
        body: options.body,
        url: options.url,
        tag: options.tag,
        kind: options.kind,
      });
      if (result.expired) dead.push(sub.id);
    }),
  );
  if (dead.length) await admin.from("push_subscriptions").delete().in("id", dead);
  return true;
}
