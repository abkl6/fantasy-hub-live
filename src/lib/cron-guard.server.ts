/**
 * Shared gate for every scheduled endpoint.
 *
 * Two callers reach these routes: the hosting platform's scheduler, which
 * presents LOVABLE_CRON_SECRET, and the database scheduler, which presents the
 * key held in cron_keys. Both are legitimate, so both are accepted here rather
 * than route by route — a route that only knew about one of them silently
 * rejected every run.
 */

import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

type KeyRow = { token?: string } | null;

export async function authenticateCron(request: Request): Promise<Response | null> {
  const denied = await authenticateCronRequest(request);
  if (!denied) return null;

  const token = /^Bearer ([^\s,]+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!token) return denied;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await (
    supabaseAdmin as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data: KeyRow }> };
        };
      };
    }
  )
    .from("cron_keys")
    .select("token")
    .eq("name", "live-scoring")
    .maybeSingle();

  if (!data?.token || token !== data.token) {
    // A rejected scheduled run is silent otherwise: it is logged so the admin
    // Overview can show that jobs are being turned away.
    await (supabaseAdmin as unknown as { from: (t: string) => { insert: (r: unknown) => Promise<unknown> } })
      .from("job_errors")
      .insert({
        source: "cron-auth",
        message: `Scheduled run rejected: ${new URL(request.url).pathname}`,
        detail: {},
      })
      .catch(() => undefined);
    return denied;
  }
  return null;
}
