ALTER TABLE public.team_position_strength
  ADD COLUMN IF NOT EXISTS measure numeric,
  ADD COLUMN IF NOT EXISTS games integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS prior_measure numeric,
  ADD COLUMN IF NOT EXISTS prior_games integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.player_season_projections (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  season integer NOT NULL,
  source text NOT NULL,
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  src_points numeric NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (player_id, season, source)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.player_season_projections TO authenticated;
GRANT ALL ON public.player_season_projections TO service_role;

ALTER TABLE public.player_season_projections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read shared and own season projections"
  ON public.player_season_projections FOR SELECT TO authenticated
  USING (source NOT LIKE 'user:%' OR source = 'user:' || auth.uid()::text);

CREATE POLICY "Members write their own season projections"
  ON public.player_season_projections FOR ALL TO authenticated
  USING (source = 'user:' || auth.uid()::text OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (source = 'user:' || auth.uid()::text OR public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER player_season_projections_updated
  BEFORE UPDATE ON public.player_season_projections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS player_season_projections_season_source_idx
  ON public.player_season_projections (season, source);