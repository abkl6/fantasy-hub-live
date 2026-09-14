/**
 * Inactive-starter sweep. Meant to run every 5 minutes; it only does work in
 * the two hours before kickoff and while games are on, so off-hours calls are
 * cheap no-ops. Protected by the cron secret.
 */

import { createFileRoute } from "@tanstack/react-router";

import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";
import { gameWindow, nextKickoff } from "@/lib/fantasy/gamewindow";

const TWO_HOURS = 2 * 60 * 60 * 1000;
const LOCK_WINDOW = 60 * 60 * 1000;

export const Route = createFileRoute("/api/public/cron/inactives")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await authenticateCronRequest(request);
        if (denied) return denied;

        const url = new URL(request.url);
        const force = url.searchParams.get("force") === "1";

        const now = new Date();
        const kickoff = nextKickoff(now);
        const untilKickoff = kickoff.at.getTime() - now.getTime();
        const live = gameWindow(now).live;
        const inWindow = live || untilKickoff <= TWO_HOURS;

        if (!inWindow && !force) {
          return Response.json({ ok: true, skipped: "outside the pre-kickoff window" });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runInactiveSweep, runLineupLockReminder } = await import(
          "@/lib/push/inactives.server"
        );

        try {
          // Only alert on players whose NFL team actually plays this week.
          const sweep = await runInactiveSweep(supabaseAdmin);
          const lock =
            !live && untilKickoff <= LOCK_WINDOW
              ? await runLineupLockReminder(supabaseAdmin)
              : { sent: 0 };

          return Response.json({
            ok: true,
            window: live ? "games in progress" : `${Math.round(untilKickoff / 60000)}m to kickoff`,
            ...sweep,
            lineupLockSent: lock.sent,
          });
        } catch (error) {
          return Response.json(
            { ok: false, error: error instanceof Error ? error.message : "Sweep failed" },
            { status: 502 },
          );
        }
      },
    },
  },
});
