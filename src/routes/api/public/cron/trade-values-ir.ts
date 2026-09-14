/**
 * Daily top-up for players placed on injured reserve in the last three weeks:
 * their market value moves fast, so we do not wait for Wednesday.
 */

import { createFileRoute } from "@tanstack/react-router";

import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

export const Route = createFileRoute("/api/public/cron/trade-values-ir")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await authenticateCronRequest(request);
        if (denied) return denied;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { refreshTradeValues } = await import("@/lib/fantasy/ktc.server");

        try {
          const result = await refreshTradeValues(supabaseAdmin, "ir");
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
