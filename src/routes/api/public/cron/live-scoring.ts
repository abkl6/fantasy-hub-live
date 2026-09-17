/**
 * Keeps the live scoring log filling during games even when nobody has the
 * app open, then fans out game-day pushes. Protected by the cron secret.
 */

import { createFileRoute } from "@tanstack/react-router";

import { authenticateCron } from "@/lib/cron-guard.server";

export const Route = createFileRoute("/api/public/cron/live-scoring")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const denied = await authenticateCron(request);
        if (denied) return denied;

        const { refreshLiveScoring } = await import("@/lib/fantasy/live.server");
        const { redZoneTeams, sendLiveAlerts } = await import("@/lib/push/live-alerts.server");

        try {
          const result = await refreshLiveScoring(supabaseAdmin);
          const redZone = await redZoneTeams(result.week);
          const alerts = await sendLiveAlerts(supabaseAdmin, {
            season: result.season,
            week: result.week,
            redZone,
          });
          return Response.json({ ok: true, ...result, alerts });
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
