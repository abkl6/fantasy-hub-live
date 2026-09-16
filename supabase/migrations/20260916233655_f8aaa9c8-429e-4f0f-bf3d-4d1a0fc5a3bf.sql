CREATE TABLE public.compute_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  league_id uuid,
  kind text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  priority integer NOT NULL DEFAULT 100,
  status text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  error text,
  run_after timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  compute_ms integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.compute_jobs TO authenticated;
GRANT ALL ON public.compute_jobs TO service_role;

ALTER TABLE public.compute_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read their own compute jobs"
ON public.compute_jobs FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE UNIQUE INDEX compute_jobs_queued_unique
ON public.compute_jobs (user_id, coalesce(league_id, '00000000-0000-0000-0000-000000000000'::uuid), kind)
WHERE status IN ('queued', 'running');

CREATE INDEX compute_jobs_claim_idx ON public.compute_jobs (status, priority, run_after);
CREATE INDEX compute_jobs_created_idx ON public.compute_jobs (created_at DESC);

CREATE TRIGGER compute_jobs_updated
BEFORE UPDATE ON public.compute_jobs
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();