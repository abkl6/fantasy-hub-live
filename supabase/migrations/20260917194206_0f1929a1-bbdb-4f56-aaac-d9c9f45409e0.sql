CREATE TABLE public.trade_value_history (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  snapshot_date date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  norm_name text NOT NULL,
  display_name text NOT NULL DEFAULT '',
  position text NOT NULL,
  format text NOT NULL DEFAULT 'sf',
  value integer NOT NULL DEFAULT 0,
  overall_rank integer,
  position_rank integer,
  age numeric,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (snapshot_date, norm_name, position, format)
);
GRANT SELECT ON public.trade_value_history TO authenticated;
GRANT ALL ON public.trade_value_history TO service_role;
ALTER TABLE public.trade_value_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users can read value history" ON public.trade_value_history FOR SELECT TO authenticated USING (true);
CREATE INDEX trade_value_history_lookup ON public.trade_value_history (format, position, snapshot_date);
CREATE INDEX trade_value_history_player ON public.trade_value_history (norm_name, format, snapshot_date);

CREATE TABLE public.player_production_seasons (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  norm_name text NOT NULL,
  display_name text NOT NULL DEFAULT '',
  player_id uuid REFERENCES public.players(id) ON DELETE SET NULL,
  position text NOT NULL,
  season integer NOT NULL,
  age numeric,
  fantasy_points numeric NOT NULL DEFAULT 0,
  games integer,
  contract_end_year integer,
  uploaded_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (norm_name, season)
);
GRANT SELECT ON public.player_production_seasons TO authenticated;
GRANT ALL ON public.player_production_seasons TO service_role;
ALTER TABLE public.player_production_seasons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users can read production history" ON public.player_production_seasons FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage production history" ON public.player_production_seasons FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER player_production_seasons_updated BEFORE UPDATE ON public.player_production_seasons FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX player_production_seasons_pos ON public.player_production_seasons (position, season);

ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS draft_round integer,
  ADD COLUMN IF NOT EXISTS draft_pick integer,
  ADD COLUMN IF NOT EXISTS draft_year integer,
  ADD COLUMN IF NOT EXISTS games_missed_2y integer NOT NULL DEFAULT 0;

ALTER TABLE public.age_curves
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'market',
  ADD COLUMN IF NOT EXISTS variant text NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS dispersion jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS pair_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.age_curves DROP CONSTRAINT IF EXISTS age_curves_position_format_key;
CREATE UNIQUE INDEX IF NOT EXISTS age_curves_unique_curve ON public.age_curves ("position", format, kind, variant);

CREATE TABLE public.trajectory_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  season integer NOT NULL,
  week integer NOT NULL,
  norm_name text NOT NULL,
  display_name text NOT NULL DEFAULT '',
  position text NOT NULL,
  format text NOT NULL DEFAULT 'sf',
  classification text NOT NULL,
  uncertain boolean NOT NULL DEFAULT false,
  change1 numeric NOT NULL DEFAULT 0,
  value integer NOT NULL DEFAULT 0,
  age numeric,
  graded boolean NOT NULL DEFAULT false,
  actual_change numeric,
  correct boolean,
  graded_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (season, week, norm_name, position, format)
);
GRANT SELECT ON public.trajectory_log TO authenticated;
GRANT ALL ON public.trajectory_log TO service_role;
ALTER TABLE public.trajectory_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users can read trajectory log" ON public.trajectory_log FOR SELECT TO authenticated USING (true);
CREATE INDEX trajectory_log_grade ON public.trajectory_log (graded, season, week);