/** Server functions backing notification settings. */

import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface NotificationPrefs {
  inactives: boolean;
  scoring_plays: boolean;
  red_zone: boolean;
  lead_change: boolean;
  lineup_lock: boolean;
}

const DEFAULTS: NotificationPrefs = {
  inactives: true,
  scoring_plays: false,
  red_zone: false,
  lead_change: true,
  lineup_lock: true,
};

/** The public signing key browsers need to create a subscription. */
export const getPushPublicKey = createServerFn({ method: "GET" }).handler(async () => ({
  publicKey: process.env["VAPID_PUBLIC_KEY"] ?? "",
}));

export const savePushSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { endpoint: string; p256dh: string; auth: string; userAgent?: string }) => {
    if (!input?.endpoint || !input.p256dh || !input.auth) throw new Error("Invalid subscription");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("push_subscriptions").upsert(
      {
        user_id: context.userId,
        endpoint: data.endpoint,
        p256dh: data.p256dh,
        auth: data.auth,
        user_agent: data.userAgent ?? null,
      } as never,
      { onConflict: "endpoint" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const removePushSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { endpoint: string }) => input)
  .handler(async ({ data, context }) => {
    await context.supabase.from("push_subscriptions").delete().eq("endpoint", data.endpoint);
    return { ok: true };
  });

export const getNotificationPrefs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("notification_prefs")
      .select("*")
      .eq("user_id", context.userId)
      .maybeSingle();
    const { data: devices } = await context.supabase
      .from("push_subscriptions")
      .select("id, endpoint, user_agent, created_at")
      .eq("user_id", context.userId);
    const prefs: NotificationPrefs = data
      ? {
          inactives: data.inactives,
          scoring_plays: data.scoring_plays,
          red_zone: data.red_zone,
          lead_change: data.lead_change,
          lineup_lock: data.lineup_lock,
        }
      : DEFAULTS;
    return { prefs, devices: devices ?? [] };
  });

export const saveNotificationPrefs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: Partial<NotificationPrefs>) => input ?? {})
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("notification_prefs").upsert(
      {
        user_id: context.userId,
        ...DEFAULTS,
        ...data,
      } as never,
      { onConflict: "user_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });
