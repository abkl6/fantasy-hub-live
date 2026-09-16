ALTER TABLE public.leagues
  ADD COLUMN IF NOT EXISTS league_type text NOT NULL DEFAULT 'redraft',
  ADD COLUMN IF NOT EXISTS variant text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS type_source text NOT NULL DEFAULT 'inferred';

UPDATE public.leagues
SET league_type = CASE WHEN format IN ('dynasty','keeper') THEN format ELSE 'redraft' END,
    variant = CASE WHEN format = 'guillotine' THEN 'guillotine' ELSE 'none' END,
    type_source = 'inferred';

CREATE OR REPLACE FUNCTION public.leagues_league_type_check()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.league_type NOT IN ('redraft','keeper','dynasty') THEN
    RAISE EXCEPTION 'Invalid league type: %', NEW.league_type;
  END IF;
  IF NEW.variant NOT IN ('none','empire','guillotine') THEN
    RAISE EXCEPTION 'Invalid league variant: %', NEW.variant;
  END IF;
  IF NEW.type_source NOT IN ('detected','inferred','user') THEN
    RAISE EXCEPTION 'Invalid type source: %', NEW.type_source;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS leagues_league_type_valid ON public.leagues;
CREATE TRIGGER leagues_league_type_valid
BEFORE INSERT OR UPDATE ON public.leagues
FOR EACH ROW EXECUTE FUNCTION public.leagues_league_type_check();