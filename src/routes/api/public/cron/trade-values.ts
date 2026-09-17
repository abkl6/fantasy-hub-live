/**
 * Weekly (Wednesday) refresh of every Keep Trade Cut dynasty value.
 * Protected by the cron secret.
 */

import { createFileRoute } from "@tanstack/react-router";

import { authenticateCron } from "@/lib/cron-guard.server";

export const Route = createFileRoute("/api/public/cron/trade-values")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await authenticateCron(request);
        if (denied) return denied;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { refreshTradeValues } = await import("@/lib/fantasy/ktc.server");

        try {
          const result = await refreshTradeValues(supabaseAdmin, "full");
          return Response.json({ ok: true, ...result });
        } catch (error) {
          return Response.json(
            { ok: false, error: error instanceof Error ? error.message : "Refresh failed" },
            { status: 502 },
          );
        }
      },
    },
  },
});
