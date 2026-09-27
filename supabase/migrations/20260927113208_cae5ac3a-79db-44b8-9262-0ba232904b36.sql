-- 1. Clear expired analysis cache (the biggest consumer: 74 MB of 131 MB)
DELETE FROM public.analysis_cache WHERE expires_at < now();

-- 2. Clear finished / stale compute jobs
DELETE FROM public.compute_jobs
WHERE status IN ('done', 'failed')
   OR (status = 'running' AND started_at < now() - interval '1 hour');

-- 3. Trim cron run history to the last 2 days
DELETE FROM cron.job_run_details WHERE end_time < now() - interval '2 days';

-- 4. Composite indexes matching the hottest query shapes on player_week_stats
CREATE INDEX IF NOT EXISTS player_week_stats_season_player_idx
  ON public.player_week_stats (season, player_id);

CREATE INDEX IF NOT EXISTS player_week_stats_season_source_player_idx
  ON public.player_week_stats (season, source, player_id);

CREATE INDEX IF NOT EXISTS player_week_stats_season_week_source_player_idx
  ON public.player_week_stats (season, week, source, player_id);

-- Cache lookup index: the exact predicate readCached/writeCached use
CREATE INDEX IF NOT EXISTS analysis_cache_lookup_idx
  ON public.analysis_cache (user_id, kind, inputs_hash, league_id);

CREATE INDEX IF NOT EXISTS analysis_cache_expires_idx
  ON public.analysis_cache (expires_at);

CREATE INDEX IF NOT EXISTS compute_jobs_status_run_after_idx
  ON public.compute_jobs (status, run_after);

-- 5. Automatic maintenance so this never re-bloats
CREATE OR REPLACE FUNCTION public.prune_maintenance_tables()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.analysis_cache WHERE expires_at < now() - interval '30 minutes';
  DELETE FROM public.compute_jobs
    WHERE (status IN ('done','failed') AND finished_at < now() - interval '1 day')
       OR (status = 'running' AND started_at < now() - interval '1 hour');
  DELETE FROM cron.job_run_details WHERE end_time < now() - interval '2 days';
END;
$$;

GRANT EXECUTE ON FUNCTION public.prune_maintenance_tables() TO service_role;

SELECT cron.schedule(
  'prune-maintenance-tables',
  '17 8 * * *',
  $$SELECT public.prune_maintenance_tables();$$
);

-- 6. Reclaim space and refresh planner statistics
ANALYZE public.analysis_cache;
ANALYZE public.player_week_stats;
ANALYZE public.compute_jobs;
