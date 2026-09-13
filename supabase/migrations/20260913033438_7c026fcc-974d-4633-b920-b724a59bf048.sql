
CREATE TABLE public.profiles (
  id UUID NOT NULL PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profile" ON public.profiles FOR ALL TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TABLE public.leagues (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  platform TEXT NOT NULL DEFAULT 'manual',
  external_id TEXT,
  name TEXT NOT NULL,
  season INTEGER NOT NULL DEFAULT 2026,
  current_week INTEGER NOT NULL DEFAULT 1,
  team_count INTEGER NOT NULL DEFAULT 12,
  playoff_teams INTEGER NOT NULL DEFAULT 6,
  regular_season_weeks INTEGER NOT NULL DEFAULT 14,
  scoring_type TEXT NOT NULL DEFAULT 'ppr',
  scoring_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  roster_slots JSONB NOT NULL DEFAULT '["QB","RB","RB","WR","WR","TE","FLEX","K","DEF"]'::jsonb,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leagues TO authenticated;
GRANT ALL ON public.leagues TO service_role;
ALTER TABLE public.leagues ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own leagues" ON public.leagues FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER leagues_updated BEFORE UPDATE ON public.leagues FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX leagues_user_idx ON public.leagues(user_id);

CREATE TABLE public.teams (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  league_id UUID NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  external_id TEXT,
  name TEXT NOT NULL,
  owner_name TEXT,
  is_mine BOOLEAN NOT NULL DEFAULT false,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  ties INTEGER NOT NULL DEFAULT 0,
  points_for NUMERIC NOT NULL DEFAULT 0,
  points_against NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.teams TO authenticated;
GRANT ALL ON public.teams TO service_role;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own teams" ON public.teams FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER teams_updated BEFORE UPDATE ON public.teams FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX teams_league_idx ON public.teams(league_id);

CREATE TABLE public.players (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  full_name TEXT NOT NULL,
  search_name TEXT NOT NULL,
  position TEXT NOT NULL,
  nfl_team TEXT,
  bye_week INTEGER,
  status TEXT NOT NULL DEFAULT 'Active',
  proj_points_week NUMERIC NOT NULL DEFAULT 0,
  proj_points_season NUMERIC NOT NULL DEFAULT 0,
  volatility NUMERIC NOT NULL DEFAULT 0.35,
  sleeper_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX players_search_pos_idx ON public.players(search_name, position);
GRANT SELECT ON public.players TO authenticated;
GRANT ALL ON public.players TO service_role;
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
CREATE POLICY "players readable" ON public.players FOR SELECT TO authenticated USING (true);

CREATE TABLE public.roster_spots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  league_id UUID NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  player_id UUID REFERENCES public.players(id) ON DELETE SET NULL,
  player_name TEXT NOT NULL,
  position TEXT NOT NULL,
  nfl_team TEXT,
  slot TEXT NOT NULL DEFAULT 'BN',
  is_starter BOOLEAN NOT NULL DEFAULT false,
  proj_points NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.roster_spots TO authenticated;
GRANT ALL ON public.roster_spots TO service_role;
ALTER TABLE public.roster_spots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own roster spots" ON public.roster_spots FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX roster_team_idx ON public.roster_spots(team_id);

CREATE TABLE public.matchups (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  league_id UUID NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  week INTEGER NOT NULL,
  home_team_id UUID REFERENCES public.teams(id) ON DELETE CASCADE,
  away_team_id UUID REFERENCES public.teams(id) ON DELETE CASCADE,
  home_score NUMERIC NOT NULL DEFAULT 0,
  away_score NUMERIC NOT NULL DEFAULT 0,
  is_final BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.matchups TO authenticated;
GRANT ALL ON public.matchups TO service_role;
ALTER TABLE public.matchups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own matchups" ON public.matchups FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX matchups_league_week_idx ON public.matchups(league_id, week);

CREATE TABLE public.saved_moves (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  league_id UUID NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  team_id UUID REFERENCES public.teams(id) ON DELETE CASCADE,
  move_type TEXT NOT NULL,
  label TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  win_delta NUMERIC NOT NULL DEFAULT 0,
  title_delta NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'planned',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_moves TO authenticated;
GRANT ALL ON public.saved_moves TO service_role;
ALTER TABLE public.saved_moves ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own saved moves" ON public.saved_moves FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
