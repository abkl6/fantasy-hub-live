ALTER TABLE public.leagues
  ADD COLUMN IF NOT EXISTS format text NOT NULL DEFAULT 'redraft';

ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS stat_projections jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS age numeric,
  ADD COLUMN IF NOT EXISTS years_exp integer;

CREATE OR REPLACE FUNCTION public.leagues_format_check()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.format NOT IN ('redraft','keeper','dynasty','guillotine','best_ball') THEN
    RAISE EXCEPTION 'Invalid league format: %', NEW.format;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS leagues_format_valid ON public.leagues;
CREATE TRIGGER leagues_format_valid
BEFORE INSERT OR UPDATE ON public.leagues
FOR EACH ROW EXECUTE FUNCTION public.leagues_format_check();