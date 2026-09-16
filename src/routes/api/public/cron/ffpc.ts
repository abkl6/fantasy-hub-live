/**
 * Scheduled FFPC refresh. Protected by the cron secret.
 *
 * ?mode=live  — scoreboard and lineups only; runs every 5 minutes in game windows.
 * ?mode=daily — full read of league home, rules, rosters and transactions.
 *
 * A league whose pages can't be read keeps its last-good data and is marked
 * paused rather than overwritten.
 */

import { createFileRoute } from "@tanstack/react-router";

import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

export const Route = createFileRoute("/api/public/cron/ffpc")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await authenticateCronRequest(request);
        if (denied) return denied;

        const live = new URL(request.url).searchParams.get("mode") !== "daily";

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { refreshFfpcLeague } = await import("@/lib/fantasy/ffpc-sync.server");

        const { data: leagues } = await supabaseAdmin
          .from("leagues")
          .select("id, user_id")
          .eq("platform", "ffpc");

        let refreshed = 0;
        let paused = 0;
        for (const league of leagues ?? []) {
          const result = await refreshFfpcLeague(supabaseAdmin, league.user_id, league.id, {
            live,
          });
          if (result.refreshed) refreshed += 1;
          else paused += 1;
        }

        return Response.json({ ok: true, mode: live ? "live" : "daily", refreshed, paused });
      },
    },
  },
});
