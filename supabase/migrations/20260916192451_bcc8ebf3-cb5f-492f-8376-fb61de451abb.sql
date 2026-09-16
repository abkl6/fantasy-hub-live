CREATE TABLE public.calibration_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  league_id uuid REFERENCES public.leagues(id) ON DELETE CASCADE,
  team_id uuid REFERENCES public.teams(id) ON DELETE CASCADE,
  season integer NOT NULL,
  week integer NOT NULL,
  kind text NOT NULL,
  subject text NOT NULL,
  position text,
  predicted numeric NOT NULL,
  actual numeric,
  error numeric,
  brier numeric,
  graded_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, season, week, kind, subject)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.calibration_log TO authenticated;
GRANT ALL ON public.calibration_log TO service_role;
ALTER TABLE public.calibration_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own calibration rows" ON public.calibration_log FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER calibration_log_updated BEFORE UPDATE ON public.calibration_log
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX calibration_log_season_week ON public.calibration_log (season, week, kind);

CREATE TABLE public.volatility_adjustments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  season integer NOT NULL,
  week integer NOT NULL,
  position text NOT NULL,
  previous numeric NOT NULL,
  next numeric NOT NULL,
  reason text NOT NULL,
  sample_weeks integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT ON public.volatility_adjustments TO authenticated;
GRANT ALL ON public.volatility_adjustments TO service_role;
ALTER TABLE public.volatility_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone signed in can read adjustments" ON public.volatility_adjustments
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins log adjustments" ON public.volatility_adjustments
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.player_constraints (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  league_id uuid NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  player_id uuid REFERENCES public.players(id) ON DELETE SET NULL,
  player_name text NOT NULL,
  norm_name text NOT NULL,
  tag text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, league_id, norm_name)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.player_constraints TO authenticated;
GRANT ALL ON public.player_constraints TO service_role;
ALTER TABLE public.player_constraints ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own player tags" ON public.player_constraints FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER player_constraints_updated BEFORE UPDATE ON public.player_constraints
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.leagues ADD COLUMN IF NOT EXISTS class_override text;