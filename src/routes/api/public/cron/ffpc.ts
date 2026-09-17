/**
 * Scheduled FFPC refresh. Protected by the cron secret.
 *
 * ?mode=daily — full read of league home, rules, rosters and transactions.
 *               Scheduled for 6am ET daily and 11am ET on Sunday.
 * ?mode=live  — scoreboard and lineups pass, forced.
 * default     — an every-five-minutes tick that decides for itself: the full
 *               live pass inside a game window, a lineups check every fifteen
 *               minutes in the hour before kickoff, and nothing otherwise.
 *
 * A league whose pages can't be read keeps its last-good data and is marked
 * paused rather than overwritten.
 */

import { createFileRoute } from "@tanstack/react-router";

import { authenticateCron } from "@/lib/cron-guard.server";
import { ffpcCadence } from "@/lib/fantasy/gamewindow";

export const Route = createFileRoute("/api/public/cron/ffpc")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await authenticateCron(request);
        if (denied) return denied;

        const mode = new URL(request.url).searchParams.get("mode") ?? "auto";

        let live = true;
        let scope = "live";
        if (mode === "daily") {
          live = false;
          scope = "daily";
        } else if (mode !== "live") {
          const cadence = ffpcCadence();
          if (!cadence.run) return Response.json({ ok: true, scope: "idle", refreshed: 0 });
          scope = cadence.scope;
        }

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

        // The daily pass is also when Sleeper leagues are brought forward, so
        // waiver results are already in before anyone opens the app.
        let sleeper = 0;
        if (!live) {
          const { refreshSleeperLeague } = await import("@/lib/fantasy/sleeper-sync.server");
          const { data: sleeperLeagues } = await supabaseAdmin
            .from("leagues")
            .select("id, user_id")
            .eq("platform", "sleeper");
          for (const league of sleeperLeagues ?? []) {
            try {
              await refreshSleeperLeague(supabaseAdmin, league.user_id, league.id);
              sleeper += 1;
            } catch {
              /* a platform outage must not stop the rest of the pass */
            }
          }
        }

        return Response.json({ ok: true, scope, refreshed, paused, sleeper });
      },
    },
  },
});
