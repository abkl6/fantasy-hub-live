CREATE TABLE public.weekly_snapshots (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  league_id uuid NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  week integer NOT NULL,
  title_odds numeric NOT NULL DEFAULT 0,
  playoff_odds numeric NOT NULL DEFAULT 0,
  proj_wins numeric NOT NULL DEFAULT 0,
  proj_losses numeric NOT NULL DEFAULT 0,
  power_score numeric NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (league_id, team_id, week)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.weekly_snapshots TO authenticated;
GRANT ALL ON public.weekly_snapshots TO service_role;

ALTER TABLE public.weekly_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own weekly snapshots"
ON public.weekly_snapshots
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.draft_picks (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  league_id uuid NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  pick_number integer NOT NULL,
  round integer,
  player_name text NOT NULL,
  position text NOT NULL,
  nfl_team text,
  proj_points_season numeric NOT NULL DEFAULT 0,
  value_vs_adp numeric NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.draft_picks TO authenticated;
GRANT ALL ON public.draft_picks TO service_role;

ALTER TABLE public.draft_picks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own draft picks"
ON public.draft_picks
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.player_news (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  player_id uuid REFERENCES public.players(id) ON DELETE SET NULL,
  player_name text NOT NULL,
  position text NOT NULL,
  status text NOT NULL DEFAULT 'Active',
  injury_body_part text,
  news_text text,
  source text,
  published_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.player_news TO authenticated;
GRANT ALL ON public.player_news TO service_role;

ALTER TABLE public.player_news ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read all player news"
ON public.player_news
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Users can manage their own player news"
ON public.player_news
FOR ALL
TO authenticated
USING (auth.uid() = player_id)
WITH CHECK (auth.uid() = player_id);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER draft_picks_updated
BEFORE UPDATE ON public.draft_picks
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
