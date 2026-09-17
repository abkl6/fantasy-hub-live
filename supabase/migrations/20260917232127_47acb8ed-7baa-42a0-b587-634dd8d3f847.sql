CREATE TABLE public.bestball_entries (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  league_id uuid NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  tournament text NOT NULL,
  entry_id text NOT NULL,
  draft_slot integer,
  draft_id text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (league_id, entry_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bestball_entries TO authenticated;
GRANT ALL ON public.bestball_entries TO service_role;
ALTER TABLE public.bestball_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own best ball entries" ON public.bestball_entries
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER bestball_entries_updated BEFORE UPDATE ON public.bestball_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.bestball_entry_players (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  entry_id uuid NOT NULL REFERENCES public.bestball_entries(id) ON DELETE CASCADE,
  league_id uuid NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  player_id uuid REFERENCES public.players(id),
  player_name text NOT NULL,
  norm_name text NOT NULL,
  position text NOT NULL,
  nfl_team text,
  pick_number integer,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bestball_entry_players TO authenticated;
GRANT ALL ON public.bestball_entry_players TO service_role;
ALTER TABLE public.bestball_entry_players ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own best ball entry players" ON public.bestball_entry_players
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX bestball_entry_players_entry_idx ON public.bestball_entry_players(entry_id);
CREATE INDEX bestball_entry_players_league_idx ON public.bestball_entry_players(league_id);
CREATE INDEX bestball_entries_user_idx ON public.bestball_entries(user_id);