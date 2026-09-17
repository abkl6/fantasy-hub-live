/**
 * Drains the background compute queue: the simulations that used to run inside
 * a page load. Protected by the cron secret, the same way live scoring is.
 */

import { createFileRoute } from "@tanstack/react-router";

import { authenticateCron } from "@/lib/cron-guard.server";

export const Route = createFileRoute("/api/public/cron/compute")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const denied = await authenticateCron(request);
        if (denied) return denied;

        try {
          const { runComputeJobs } = await import("@/lib/fantasy/jobs.server");
          const result = await runComputeJobs(supabaseAdmin, { limit: 6 });
          return Response.json({ ok: true, ...result });
        } catch (error) {
          return Response.json(
            { ok: false, error: error instanceof Error ? error.message : "Worker failed" },
            { status: 502 },
          );
        }
      },
    },
  },
});
