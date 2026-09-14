-- Market values per player, per league format
CREATE TABLE public.player_trade_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid REFERENCES public.players(id) ON DELETE SET NULL,
  norm_name text NOT NULL,
  display_name text NOT NULL,
  position text NOT NULL,
  format text NOT NULL CHECK (format IN ('1qb','sf')),
  value integer NOT NULL DEFAULT 0,
  tier integer,
  overall_rank integer,
  position_rank integer,
  age numeric,
  nfl_team text,
  source text NOT NULL DEFAULT 'ktc',
  fetched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (norm_name, position, format)
);
CREATE INDEX player_trade_values_player_idx ON public.player_trade_values (player_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.player_trade_values TO authenticated;
GRANT ALL ON public.player_trade_values TO service_role;
ALTER TABLE public.player_trade_values ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users can read trade values"
  ON public.player_trade_values FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage trade values"
  ON public.player_trade_values FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER player_trade_values_updated BEFORE UPDATE ON public.player_trade_values
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Future draft pick values
CREATE TABLE public.pick_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season integer NOT NULL,
  round integer NOT NULL,
  slot text NOT NULL DEFAULT 'mid' CHECK (slot IN ('early','mid','late','unknown')),
  format text NOT NULL CHECK (format IN ('1qb','sf')),
  value integer NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'ktc',
  fetched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (season, round, slot, format)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pick_values TO authenticated;
GRANT ALL ON public.pick_values TO service_role;
ALTER TABLE public.pick_values ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users can read pick values"
  ON public.pick_values FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage pick values"
  ON public.pick_values FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER pick_values_updated BEFORE UPDATE ON public.pick_values
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Pick inventory per team
CREATE TABLE public.team_draft_picks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  league_id uuid NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  original_team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL,
  season integer NOT NULL,
  round integer NOT NULL,
  slot text NOT NULL DEFAULT 'mid' CHECK (slot IN ('early','mid','late','unknown')),
  count integer NOT NULL DEFAULT 1 CHECK (count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX team_draft_picks_unique
  ON public.team_draft_picks (league_id, team_id, season, round, COALESCE(original_team_id, team_id));
CREATE INDEX team_draft_picks_league_idx ON public.team_draft_picks (league_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_draft_picks TO authenticated;
GRANT ALL ON public.team_draft_picks TO service_role;
ALTER TABLE public.team_draft_picks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own draft picks"
  ON public.team_draft_picks FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER team_draft_picks_updated BEFORE UPDATE ON public.team_draft_picks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Refresh history
CREATE TABLE public.trade_value_refresh_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'ktc',
  scope text NOT NULL DEFAULT 'full',
  rows_upserted integer NOT NULL DEFAULT 0,
  picks_upserted integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'ok',
  error text
);
GRANT SELECT ON public.trade_value_refresh_log TO authenticated;
GRANT ALL ON public.trade_value_refresh_log TO service_role;
ALTER TABLE public.trade_value_refresh_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users can read refresh history"
  ON public.trade_value_refresh_log FOR SELECT TO authenticated USING (true);

-- Track when a player landed on IR so values can refresh daily for 3 weeks
ALTER TABLE public.players ADD COLUMN IF NOT EXISTS ir_since timestamptz;