/**
 * Drains the background compute queue: the simulations that used to run inside
 * a page load. Protected by the cron secret, the same way live scoring is.
 */

import { createFileRoute } from "@tanstack/react-router";

import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

export const Route = createFileRoute("/api/public/cron/compute")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // The database scheduler presents the key held in cron_keys instead of
        // the platform cron secret, so accept either.
        const denied = await authenticateCronRequest(request);
        if (denied) {
          const token = /^Bearer ([^\s,]+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
          const { data } = await (supabaseAdmin as unknown as {
            from: (t: string) => {
              select: (c: string) => {
                eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data: { token?: string } | null }> };
              };
            };
          })
            .from("cron_keys")
            .select("token")
            .eq("name", "live-scoring")
            .maybeSingle();
          if (!token || !data?.token || token !== data.token) return denied;
        }

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
