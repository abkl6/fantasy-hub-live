CREATE TABLE public.recommendation_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  league_id uuid NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL,
  week integer NOT NULL,
  surface text NOT NULL DEFAULT 'league',
  kind text NOT NULL,
  rec_key text NOT NULL,
  headline text NOT NULL,
  detail text,
  add_name text,
  drop_name text,
  points_delta numeric NOT NULL DEFAULT 0,
  title_delta numeric NOT NULL DEFAULT 0,
  playoff_delta numeric NOT NULL DEFAULT 0,
  dynasty_value_delta numeric NOT NULL DEFAULT 0,
  dynasty_rank_delta numeric NOT NULL DEFAULT 0,
  team_class text,
  impact_label text,
  action text NOT NULL DEFAULT 'shown',
  acted_at timestamp with time zone,
  grade text,
  grade_note text,
  graded_week integer,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, league_id, week, rec_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.recommendation_log TO authenticated;
GRANT ALL ON public.recommendation_log TO service_role;

ALTER TABLE public.recommendation_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own recommendation log"
ON public.recommendation_log FOR ALL TO authenticated
USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX recommendation_log_user_week_idx ON public.recommendation_log (user_id, league_id, week);

CREATE TRIGGER recommendation_log_updated
BEFORE UPDATE ON public.recommendation_log
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();