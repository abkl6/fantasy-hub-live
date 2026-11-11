-- Members cannot write the job queue directly, so a sync they trigger used to
-- queue nothing (the insert was refused), and a repeat sync hit the
-- one-waiting-job-per-kind rule and failed. This queues the work in one call,
-- skips anything already waiting, and only for the caller's own leagues.
CREATE OR REPLACE FUNCTION public.enqueue_compute_jobs(_user_id uuid, _league_id uuid DEFAULT NULL, _priority integer DEFAULT 100)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND auth.uid() IS DISTINCT FROM _user_id THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF _league_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.leagues WHERE id = _league_id AND user_id = _user_id
  ) THEN
    RETURN;
  END IF;

  IF _league_id IS NOT NULL THEN
    INSERT INTO public.compute_jobs (user_id, league_id, kind, priority, status, run_after)
    VALUES (_user_id, _league_id, 'league', _priority, 'queued', now()),
           (_user_id, _league_id, 'impact', _priority + 10, 'queued', now())
    ON CONFLICT DO NOTHING;
  END IF;
  INSERT INTO public.compute_jobs (user_id, league_id, kind, priority, status, run_after)
  VALUES (_user_id, NULL, 'this-week', _priority + 20, 'queued', now())
  ON CONFLICT DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_compute_jobs(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enqueue_compute_jobs(uuid, uuid, integer) TO authenticated, service_role;