CREATE TABLE public.job_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  platform text,
  scope text,
  message text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.job_errors TO authenticated;
GRANT ALL ON public.job_errors TO service_role;
ALTER TABLE public.job_errors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read job errors" ON public.job_errors FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE INDEX job_errors_created_idx ON public.job_errors (created_at DESC);

CREATE TABLE public.defense_ranks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season integer NOT NULL,
  week integer NOT NULL,
  nfl_team text NOT NULL,
  rank integer NOT NULL,
  points_allowed numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (season, week, nfl_team)
);
GRANT SELECT ON public.defense_ranks TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.defense_ranks TO authenticated;
GRANT ALL ON public.defense_ranks TO service_role;
ALTER TABLE public.defense_ranks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "defense ranks readable" ON public.defense_ranks FOR SELECT TO authenticated USING (true);
CREATE POLICY "admins manage defense ranks" ON public.defense_ranks FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER defense_ranks_updated BEFORE UPDATE ON public.defense_ranks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.projection_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  label text NOT NULL,
  season integer NOT NULL,
  week integer,
  published boolean NOT NULL DEFAULT false,
  row_count integer NOT NULL DEFAULT 0,
  matched_count integer NOT NULL DEFAULT 0,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projection_batches TO authenticated;
GRANT ALL ON public.projection_batches TO service_role;
ALTER TABLE public.projection_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage projection batches" ON public.projection_batches FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER projection_batches_updated BEFORE UPDATE ON public.projection_batches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.unmatched_players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid REFERENCES public.projection_batches(id) ON DELETE CASCADE,
  raw_name text NOT NULL,
  position text,
  nfl_team text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open',
  resolved_player_id uuid REFERENCES public.players(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.unmatched_players TO authenticated;
GRANT ALL ON public.unmatched_players TO service_role;
ALTER TABLE public.unmatched_players ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage unmatched players" ON public.unmatched_players FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER unmatched_players_updated BEFORE UPDATE ON public.unmatched_players
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX unmatched_players_status_idx ON public.unmatched_players (status, created_at DESC);

ALTER TABLE public.leagues ADD COLUMN IF NOT EXISTS last_sync_error text;

CREATE POLICY "admins read all profiles" ON public.profiles FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins read all leagues" ON public.leagues FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins read all notifications" ON public.notification_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins read all roles" ON public.user_roles FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));