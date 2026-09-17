/**
 * Reading and (for admins) writing Premium entitlements.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { FOUNDING_EXPIRES_AT, type Entitlement } from "@/lib/entitlements";

type Row = { tier: string; source: string; expires_at: string | null };

const toEntitlement = (row: Row | null): Entitlement =>
  row
    ? {
        tier: row.tier === "premium" ? "premium" : "free",
        source: (["founding", "stripe", "admin"].includes(row.source)
          ? row.source
          : "admin") as Entitlement["source"],
        expiresAt: row.expires_at,
      }
    : { tier: "free", source: "admin", expiresAt: null };

/** The signed-in member's own entitlement. */
export const getMyEntitlement = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Entitlement> => {
    const { data } = await context.supabase
      .from("entitlements")
      .select("tier, source, expires_at")
      .eq("user_id", context.userId)
      .maybeSingle();

    if (data) return toEntitlement(data as Row);

    // Founding season: anyone without a row yet still gets Premium, and the
    // row is created so admin tools can see it.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("entitlements")
      .upsert(
        {
          user_id: context.userId,
          tier: "premium",
          source: "founding",
          expires_at: FOUNDING_EXPIRES_AT,
        },
        { onConflict: "user_id" },
      );
    return { tier: "premium", source: "founding", expiresAt: FOUNDING_EXPIRES_AT };
  });

async function assertAdmin(context: { supabase: unknown; userId: string }) {
  const { data } = await (
    context.supabase as {
      rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: boolean | null }>;
    }
  ).rpc("has_role", { _user_id: context.userId, _role: "admin" });
  if (data !== true) throw new Error("Admins only.");
}

export interface AdminUserRow {
  userId: string;
  displayName: string | null;
  tier: string;
  source: string;
  expiresAt: string | null;
  leagues: number;
}

/** Every member with their current tier, for the admin Users tab. */
export const adminListUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminUserRow[]> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: profiles }, { data: ents }, { data: leagues }] = await Promise.all([
      supabaseAdmin.from("profiles").select("id, display_name"),
      supabaseAdmin.from("entitlements").select("user_id, tier, source, expires_at"),
      supabaseAdmin.from("leagues").select("user_id"),
    ]);

    const entBy = new Map((ents ?? []).map((e) => [e.user_id as string, e as Row & { user_id: string }]));
    const counts = new Map<string, number>();
    for (const l of leagues ?? []) {
      const id = l.user_id as string;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }

    return (profiles ?? [])
      .map((p) => {
        const e = entBy.get(p.id as string);
        return {
          userId: p.id as string,
          displayName: (p.display_name as string | null) ?? null,
          tier: e?.tier ?? "free",
          source: e?.source ?? "admin",
          expiresAt: e?.expires_at ?? null,
          leagues: counts.get(p.id as string) ?? 0,
        };
      })
      .sort((a, b) => (a.displayName ?? "").localeCompare(b.displayName ?? ""));
  });

/** Admin override of somebody's tier and expiry. */
export const adminSetEntitlement = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        tier: z.enum(["free", "premium"]),
        expiresAt: z.string().nullable(),
      })
      .parse(d),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("entitlements").upsert(
      {
        user_id: data.userId,
        tier: data.tier,
        source: "admin",
        expires_at: data.expiresAt && data.expiresAt.trim() ? data.expiresAt : null,
      },
      { onConflict: "user_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });
