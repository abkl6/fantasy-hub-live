/** Daily pull of this week's and next week's Vegas team totals. */

import { createFileRoute } from "@tanstack/react-router";

import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

export const Route = createFileRoute("/api/public/cron/implied-totals")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await authenticateCronRequest(request);
        if (denied) return denied;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { currentLiveWeek } = await import("@/lib/fantasy/live.server");
        const { refreshImpliedTotals } = await import("@/lib/fantasy/implied.server");

        try {
          const { season, week } = await currentLiveWeek();
          const weeks = [week, week + 1].filter((w) => w >= 1 && w <= 18);
          const result = await refreshImpliedTotals(supabaseAdmin, season, weeks);
          return Response.json({ ok: true, season, weeks, ...result });
        } catch (error) {
          return Response.json(
            { ok: false, error: error instanceof Error ? error.message : "Odds pull failed" },
            { status: 502 },
          );
        }
      },
    },
  },
});
