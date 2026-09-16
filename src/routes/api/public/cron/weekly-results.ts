/**
 * Once a week's games are finished: store what actually happened, rebuild the
 * rest-of-season blend, re-measure how steady each player is, and check every
 * league's scoreboard against our own maths.
 */

import { createFileRoute } from "@tanstack/react-router";

import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

export const Route = createFileRoute("/api/public/cron/weekly-results")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await authenticateCronRequest(request);
        if (denied) return denied;

        const params = new URL(request.url).searchParams;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { currentLiveWeek } = await import("@/lib/fantasy/live.server");
        const { runWeeklyResultsJob } = await import("@/lib/fantasy/weekly-jobs.server");

        try {
          const live = await currentLiveWeek();
          const season = Number(params.get("season")) || live.season;
          const week = Number(params.get("week")) || live.week;
          const result = await runWeeklyResultsJob(supabaseAdmin, season, week);
          return Response.json({ ok: true, season, week, ...result });
        } catch (error) {
          return Response.json(
            { ok: false, error: error instanceof Error ? error.message : "Weekly job failed" },
            { status: 502 },
          );
        }
      },
    },
  },
});
