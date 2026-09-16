/**
 * Background job queue. Every simulation-heavy build runs here rather than
 * inside a page load: a sync or a live poll queues work, the scheduled worker
 * drains it, and the screens only ever read stored results.
 * Server-only.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

import { cachedWithMeta, componentHashes, leagueInputsHash, allLeaguesInputsHash } from "./cache.server";

type DB = SupabaseClient<Database>;

export type JobKind = "league" | "impact" | "this-week";

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2 * 60_000;

interface JobRow {
  id: string;
  user_id: string;
  league_id: string | null;
  kind: string;
  attempts: number;
}

type JobsTable = {
  from: (table: "compute_jobs") => any;
};

function jobs(supabase: DB) {
  return (supabase as unknown as JobsTable).from("compute_jobs");
}

/**
 * Queues the work a league needs after a sync. The partial unique index means
 * a second sync while a job is still waiting does not create a duplicate.
 */
export async function enqueueLeagueJobs(
  supabase: DB,
  userId: string,
  leagueId: string,
  opts: { priority?: number } = {},
): Promise<void> {
  const priority = opts.priority ?? 100;
  const rows = [
    { user_id: userId, league_id: leagueId, kind: "league", priority },
    { user_id: userId, league_id: leagueId, kind: "impact", priority: priority + 10 },
    { user_id: userId, league_id: null, kind: "this-week", priority: priority + 20 },
  ];
  for (const row of rows) {
    await jobs(supabase)
      .insert({ ...row, status: "queued", run_after: new Date().toISOString() })
      .then(
        () => undefined,
        () => undefined,
      );
  }
}

/** Queue depth and recent failures, for the admin Overview. */
export async function queueStats(supabase: DB): Promise<{
  queued: number;
  running: number;
  failed: number;
  lastRunAt: string | null;
}> {
  const [{ count: queued }, { count: running }, { count: failed }, { data: last }] = await Promise.all([
    jobs(supabase).select("id", { count: "exact", head: true }).eq("status", "queued"),
    jobs(supabase).select("id", { count: "exact", head: true }).eq("status", "running"),
    jobs(supabase).select("id", { count: "exact", head: true }).eq("status", "failed"),
    jobs(supabase)
      .select("finished_at")
      .eq("status", "done")
      .order("finished_at", { ascending: false })
      .limit(1),
  ]);
  return {
    queued: queued ?? 0,
    running: running ?? 0,
    failed: failed ?? 0,
    lastRunAt: last?.[0]?.finished_at ?? null,
  };
}

async function runLeagueJob(admin: DB, userId: string, leagueId: string) {
  const [hash, parts] = await Promise.all([
    leagueInputsHash(admin, leagueId),
    componentHashes(admin, leagueId),
  ]);
  const { buildAnalysis } = await import("./analysis.server");
  const { buildGameDay } = await import("./live.server");
  const { loadPlayoffPicture } = await import("./playoff.server");

  await cachedWithMeta(admin, { userId, leagueId, kind: "analysis", force: true }, hash, () =>
    buildAnalysis(admin, leagueId),
  );
  await cachedWithMeta(admin, { userId, leagueId, kind: "gameday", force: true }, hash, () =>
    buildGameDay(admin, { leagueId }),
  );
  await cachedWithMeta(admin, { userId, leagueId, kind: "playoff", force: true }, parts.sim, () =>
    loadPlayoffPicture(admin, leagueId),
  );
}

/**
 * Scores the free agents and trade targets a member is most likely to look at,
 * so the waiver board and Trade Finder are reads rather than simulations.
 */
async function runImpactJob(admin: DB, userId: string, leagueId: string) {
  const parts = await componentHashes(admin, leagueId);
  const { buildWaiverBoard } = await import("./waivers.server");
  const { buildTradeFinder } = await import("./trade-finder.server");

  await cachedWithMeta(
    admin,
    { userId, leagueId, kind: "impact", suffix: "waivers", force: true },
    parts.sim,
    () => buildWaiverBoard(admin, leagueId, { limit: 60, deep: true }),
  );
  await cachedWithMeta(
    admin,
    { userId, leagueId, kind: "impact", suffix: "trades", force: true },
    parts.sim,
    () => buildTradeFinder(admin, leagueId),
  );
}

async function runThisWeekJob(admin: DB, userId: string) {
  const { buildThisWeek } = await import("./this-week.server");
  const hash = await allLeaguesInputsHash(admin);
  await cachedWithMeta(admin, { userId, kind: "this-week", force: true }, hash, () =>
    buildThisWeek(admin),
  );
}

async function runJob(admin: DB, job: JobRow) {
  if (job.kind === "league" && job.league_id) return runLeagueJob(admin, job.user_id, job.league_id);
  if (job.kind === "impact" && job.league_id) return runImpactJob(admin, job.user_id, job.league_id);
  if (job.kind === "this-week") return runThisWeekJob(admin, job.user_id);
}

/**
 * Claims and runs up to `limit` queued jobs. Safe to call concurrently: a job
 * is only picked up when its status still reads queued at claim time.
 */
export async function runComputeJobs(
  admin: DB,
  opts: { limit?: number } = {},
): Promise<{ ran: number; failed: number }> {
  const limit = opts.limit ?? 6;
  const { data } = await jobs(admin)
    .select("id, user_id, league_id, kind, attempts")
    .eq("status", "queued")
    .lte("run_after", new Date().toISOString())
    .order("priority", { ascending: true })
    .order("run_after", { ascending: true })
    .limit(limit);

  let ran = 0;
  let failed = 0;

  for (const job of (data ?? []) as JobRow[]) {
    const { data: claimed } = await jobs(admin)
      .update({ status: "running", started_at: new Date().toISOString(), attempts: job.attempts + 1 })
      .eq("id", job.id)
      .eq("status", "queued")
      .select("id");
    if (!claimed?.length) continue;

    const started = Date.now();
    try {
      await runJob(admin, job);
      await jobs(admin)
        .update({
          status: "done",
          error: null,
          finished_at: new Date().toISOString(),
          compute_ms: Date.now() - started,
        })
        .eq("id", job.id);
      ran += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Job failed";
      const retry = job.attempts + 1 < MAX_ATTEMPTS;
      await jobs(admin)
        .update({
          status: retry ? "queued" : "failed",
          error: message,
          run_after: new Date(Date.now() + RETRY_DELAY_MS).toISOString(),
          finished_at: retry ? null : new Date().toISOString(),
          compute_ms: Date.now() - started,
        })
        .eq("id", job.id);
      failed += 1;
    }
  }

  return { ran, failed };
}
