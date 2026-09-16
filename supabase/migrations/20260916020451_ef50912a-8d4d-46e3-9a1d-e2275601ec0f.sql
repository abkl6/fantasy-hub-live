CREATE OR REPLACE FUNCTION public.leagues_contest_format_check()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.contest_format NOT IN ('h2h','points','hybrid','vp') THEN
    RAISE EXCEPTION 'Invalid contest format: %', NEW.contest_format;
  END IF;
  RETURN NEW;
END;
$function$;

ALTER TABLE public.leagues
  ADD COLUMN IF NOT EXISTS all_play_weeks jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS sync_paused boolean NOT NULL DEFAULT false;

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS vp numeric NOT NULL DEFAULT 0;