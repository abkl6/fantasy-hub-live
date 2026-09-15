ALTER TABLE public.leagues ADD COLUMN IF NOT EXISTS projection_source text NOT NULL DEFAULT 'app';

UPDATE public.leagues SET projection_source = 'platform' WHERE lower(platform) IN ('sleeper','espn');

CREATE OR REPLACE FUNCTION public.leagues_projection_source_check()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.projection_source NOT IN ('platform','app','user') THEN
    RAISE EXCEPTION 'Invalid projection source: %', NEW.projection_source;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS leagues_projection_source_valid ON public.leagues;
CREATE TRIGGER leagues_projection_source_valid
BEFORE INSERT OR UPDATE ON public.leagues
FOR EACH ROW EXECUTE FUNCTION public.leagues_projection_source_check();

ALTER TABLE public.player_week_stats ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'app';

ALTER TABLE public.player_week_stats DROP CONSTRAINT IF EXISTS player_week_stats_player_id_season_week_key;
ALTER TABLE public.player_week_stats
  ADD CONSTRAINT player_week_stats_player_season_week_source_key
  UNIQUE (player_id, season, week, source);

CREATE INDEX IF NOT EXISTS player_week_stats_source_week_idx
  ON public.player_week_stats (source, season, week);

CREATE POLICY "members manage their own week stats"
  ON public.player_week_stats
  FOR ALL
  TO authenticated
  USING (source = 'user:' || auth.uid()::text)
  WITH CHECK (source = 'user:' || auth.uid()::text);