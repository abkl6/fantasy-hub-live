ALTER TABLE public.players ADD COLUMN IF NOT EXISTS espn_id text;
ALTER TABLE public.players ADD COLUMN IF NOT EXISTS yahoo_id text;
ALTER TABLE public.players ADD COLUMN IF NOT EXISTS ktc_slug text;
CREATE INDEX IF NOT EXISTS players_espn_id_idx ON public.players (espn_id) WHERE espn_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS players_yahoo_id_idx ON public.players (yahoo_id) WHERE yahoo_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS players_ktc_slug_idx ON public.players (ktc_slug) WHERE ktc_slug IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.player_blend_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  season integer NOT NULL,
  source text NOT NULL DEFAULT 'app',
  per_game jsonb NOT NULL DEFAULT '{}'::jsonb,
  blend_weight numeric NOT NULL DEFAULT 0,
  games_played integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (player_id, season, source)
);
GRANT SELECT ON public.player_blend_rates TO authenticated;
GRANT ALL ON public.player_blend_rates TO service_role;
ALTER TABLE public.player_blend_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Blend rates readable by members" ON public.player_blend_rates FOR SELECT TO authenticated USING (true);
CREATE TRIGGER player_blend_rates_updated BEFORE UPDATE ON public.player_blend_rates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.score_reconciliation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  league_id uuid NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  team_id uuid REFERENCES public.teams(id) ON DELETE CASCADE,
  season integer NOT NULL,
  week integer NOT NULL,
  computed numeric NOT NULL DEFAULT 0,
  reported numeric NOT NULL DEFAULT 0,
  diff numeric NOT NULL DEFAULT 0,
  top_player_name text,
  top_player_diff numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (league_id, team_id, week)
);
GRANT SELECT ON public.score_reconciliation TO authenticated;
GRANT ALL ON public.score_reconciliation TO service_role;
ALTER TABLE public.score_reconciliation ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members read their own reconciliation" ON public.score_reconciliation FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER score_reconciliation_updated BEFORE UPDATE ON public.score_reconciliation FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.team_implied_totals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season integer NOT NULL,
  week integer NOT NULL,
  nfl_team text NOT NULL,
  implied numeric NOT NULL,
  source text NOT NULL DEFAULT 'odds',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (season, week, nfl_team)
);
GRANT SELECT ON public.team_implied_totals TO authenticated;
GRANT ALL ON public.team_implied_totals TO service_role;
ALTER TABLE public.team_implied_totals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Implied totals readable by members" ON public.team_implied_totals FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage implied totals" ON public.team_implied_totals FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER team_implied_totals_updated BEFORE UPDATE ON public.team_implied_totals FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();