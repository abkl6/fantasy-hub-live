CREATE TABLE public.analysis_cache (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  league_id uuid REFERENCES public.leagues(id) ON DELETE CASCADE,
  kind text NOT NULL,
  inputs_hash text NOT NULL,
  payload jsonb NOT NULL,
  compute_ms integer NOT NULL DEFAULT 0,
  computed_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL DEFAULT (now() + interval '15 minutes'),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX analysis_cache_key ON public.analysis_cache (user_id, coalesce(league_id, '00000000-0000-0000-0000-000000000000'::uuid), kind, inputs_hash);
CREATE INDEX analysis_cache_lookup ON public.analysis_cache (user_id, league_id, kind);
CREATE INDEX analysis_cache_computed_at ON public.analysis_cache (computed_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.analysis_cache TO authenticated;
GRANT ALL ON public.analysis_cache TO service_role;

ALTER TABLE public.analysis_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own cached results"
ON public.analysis_cache FOR ALL TO authenticated
USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER analysis_cache_updated
BEFORE UPDATE ON public.analysis_cache
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();