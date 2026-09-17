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

          // Log this week's calls and grade any that are now a year old.
          let logged = 0;
          let graded = 0;
          try {
            const { logTrajectories, gradeTrajectories } = await import(
              "@/lib/fantasy/trajectory-log.server"
            );
            const now = new Date();
            const season = now.getUTCMonth() >= 2 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
            const week = Math.max(
              1,
              Math.min(18, Math.ceil((now.getTime() - Date.UTC(season, 8, 4)) / (7 * 86400000))),
            );
            logged = (await logTrajectories(supabaseAdmin, { season, week })).logged;
            graded = (await gradeTrajectories(supabaseAdmin)).graded;
          } catch (logError) {
            await supabaseAdmin.from("job_errors").insert({
              source: "trajectories",
              scope: "log",
              message: logError instanceof Error ? logError.message : "Trajectory log failed",
            });
          }

          return Response.json({ ok: true, ...result, logged, graded });
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
