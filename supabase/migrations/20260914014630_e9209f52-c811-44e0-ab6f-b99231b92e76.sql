CREATE TABLE public.player_week_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  season integer NOT NULL DEFAULT 2026,
  week integer NOT NULL,
  opponent text,
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  src_points numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (player_id, season, week)
);

GRANT SELECT ON public.player_week_stats TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.player_week_stats TO authenticated;
GRANT ALL ON public.player_week_stats TO service_role;

ALTER TABLE public.player_week_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "week stats readable" ON public.player_week_stats
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "admins insert week stats" ON public.player_week_stats
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins update week stats" ON public.player_week_stats
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins delete week stats" ON public.player_week_stats
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX player_week_stats_week_idx ON public.player_week_stats (season, week);

CREATE TRIGGER player_week_stats_updated
  BEFORE UPDATE ON public.player_week_stats
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.nfl_schedule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season integer NOT NULL DEFAULT 2026,
  week integer NOT NULL,
  nfl_team text NOT NULL,
  opponent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (season, week, nfl_team)
);

GRANT SELECT ON public.nfl_schedule TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.nfl_schedule TO authenticated;
GRANT ALL ON public.nfl_schedule TO service_role;

ALTER TABLE public.nfl_schedule ENABLE ROW LEVEL SECURITY;

CREATE POLICY "schedule readable" ON public.nfl_schedule
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "admins insert schedule" ON public.nfl_schedule
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins update schedule" ON public.nfl_schedule
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins delete schedule" ON public.nfl_schedule
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

ALTER TABLE public.roster_spots DROP CONSTRAINT roster_spots_player_id_fkey;
ALTER TABLE public.roster_spots
  ADD CONSTRAINT roster_spots_player_id_fkey
  FOREIGN KEY (player_id) REFERENCES public.players(id) ON DELETE SET NULL;

ALTER TABLE public.player_news DROP CONSTRAINT player_news_player_id_fkey;
ALTER TABLE public.player_news
  ADD CONSTRAINT player_news_player_id_fkey
  FOREIGN KEY (player_id) REFERENCES public.players(id) ON DELETE CASCADE;