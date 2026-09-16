/**
 * Reading and editing the strategy rules. Everyone signed in can read them
 * (the "How advice works" page); only admins can change them.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DEFAULT_RULES } from "@/lib/fantasy/rules";

type Ctx = { supabase: { rpc: Function }; userId: string };

async function assertAdmin(context: Ctx) {
  const { data } = await (
    context.supabase as never as {
      rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: boolean | null }>;
    }
  ).rpc("has_role", { _user_id: context.userId, _role: "admin" });
  if (data !== true) throw new Error("Admins only.");
}

export const listStrategyRules = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("strategy_rules")
      .select("id, key, category, rule, rationale, weight, enabled, sort_order")
      .order("sort_order");
    if (error || !data?.length) {
      return {
        rules: DEFAULT_RULES.map((r, i) => ({
          id: r.key,
          key: r.key,
          category: r.category,
          rule: r.rule,
          rationale: r.rationale,
          weight: r.weight,
          enabled: r.enabled,
          sort_order: i * 10,
        })),
      };
    }
    return { rules: data };
  });

export const updateStrategyRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        rule: z.string().min(4).max(600).optional(),
        rationale: z.string().min(4).max(600).optional(),
        weight: z.number().min(0).max(10).optional(),
        enabled: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context as unknown as Ctx);
    const patch: Record<string, unknown> = {};
    if (data.rule !== undefined) patch["rule"] = data.rule;
    if (data.rationale !== undefined) patch["rationale"] = data.rationale;
    if (data.weight !== undefined) patch["weight"] = data.weight;
    if (data.enabled !== undefined) patch["enabled"] = data.enabled;
    const { error } = await context.supabase
      .from("strategy_rules")
      .update(patch as never)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
