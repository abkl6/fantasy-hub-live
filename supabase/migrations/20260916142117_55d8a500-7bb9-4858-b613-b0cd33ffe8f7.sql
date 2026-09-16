CREATE TABLE public.team_position_strength (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  season integer NOT NULL,
  nfl_team text NOT NULL,
  position_group text NOT NULL,
  multiplier numeric NOT NULL DEFAULT 1,
  source text NOT NULL DEFAULT 'computed',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (season, nfl_team, position_group)
);

GRANT SELECT ON public.team_position_strength TO authenticated;
GRANT ALL ON public.team_position_strength TO service_role;

ALTER TABLE public.team_position_strength ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone signed in can read schedule strength"
  ON public.team_position_strength FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins manage schedule strength"
  ON public.team_position_strength FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER team_position_strength_updated
  BEFORE UPDATE ON public.team_position_strength
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.leagues ADD COLUMN IF NOT EXISTS sos_adjust boolean NOT NULL DEFAULT false;