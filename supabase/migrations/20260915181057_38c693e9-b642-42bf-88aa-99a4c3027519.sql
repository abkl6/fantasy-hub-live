ALTER TABLE public.leagues
  ADD COLUMN IF NOT EXISTS contest_format text NOT NULL DEFAULT 'h2h',
  ADD COLUMN IF NOT EXISTS points_playoff_teams integer,
  ADD COLUMN IF NOT EXISTS points_playoff_week integer,
  ADD COLUMN IF NOT EXISTS weekly_high_bonus boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS weekly_high_label text;

CREATE OR REPLACE FUNCTION public.leagues_contest_format_check()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.contest_format NOT IN ('h2h','points','hybrid') THEN
    RAISE EXCEPTION 'Invalid contest format: %', NEW.contest_format;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS leagues_contest_format_valid ON public.leagues;
CREATE TRIGGER leagues_contest_format_valid
BEFORE INSERT OR UPDATE ON public.leagues
FOR EACH ROW EXECUTE FUNCTION public.leagues_contest_format_check();

UPDATE public.leagues SET contest_format = 'points' WHERE format = 'best_ball';