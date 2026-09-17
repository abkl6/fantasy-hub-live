/**
 * Injury and status feed. Sleeper's player list is the single source of
 * availability for every league, whatever platform it lives on — a platform's
 * own status is only used when Sleeper has no entry for that player.
 *
 * Scheduled every two minutes: it works every time inside the three hours
 * before kickoff and while games are on, and only every tenth minute
 * otherwise, so quiet days stay cheap.
 */

import { createFileRoute } from "@tanstack/react-router";

import { authenticateCron } from "@/lib/cron-guard.server";
import { gameWindow, nextKickoff } from "@/lib/fantasy/gamewindow";

const THREE_HOURS = 3 * 60 * 60 * 1000;

export const Route = createFileRoute("/api/public/cron/injuries")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await authenticateCron(request);
        if (denied) return denied;

        const force = new URL(request.url).searchParams.get("force") === "1";
        const now = new Date();
        const untilKickoff = nextKickoff(now).at.getTime() - now.getTime();
        const busy = gameWindow(now).live || untilKickoff <= THREE_HOURS;

        if (!force && !busy && now.getUTCMinutes() % 10 >= 2) {
          return Response.json({ ok: true, skipped: "checked within the last ten minutes" });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { syncPlayerNews } = await import("@/lib/fantasy/sleeper.server");

        try {
          const result = await syncPlayerNews(supabaseAdmin);
          return Response.json({ ok: true, cadence: busy ? "2m" : "10m", ...result });
        } catch (error) {
          return Response.json(
            { ok: false, error: error instanceof Error ? error.message : "Injury sync failed" },
            { status: 502 },
          );
        }
      },
    },
  },
});
