CREATE TABLE public.league_slots (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  league_id uuid NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  slot_key text NOT NULL,
  label text NOT NULL,
  count integer NOT NULL DEFAULT 1,
  eligible_positions text[] NOT NULL DEFAULT '{}',
  source text NOT NULL DEFAULT 'detected',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (league_id, slot_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.league_slots TO authenticated;
GRANT ALL ON public.league_slots TO service_role;

ALTER TABLE public.league_slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own league slots"
ON public.league_slots FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE INDEX league_slots_league_idx ON public.league_slots (league_id, sort_order);

CREATE TRIGGER league_slots_updated
BEFORE UPDATE ON public.league_slots
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.league_slots_source_check()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.source NOT IN ('detected','inferred','user') THEN
    RAISE EXCEPTION 'Invalid slot source: %', NEW.source;
  END IF;
  IF NEW.count < 0 THEN
    RAISE EXCEPTION 'Slot count cannot be negative';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER league_slots_source_valid
BEFORE INSERT OR UPDATE ON public.league_slots
FOR EACH ROW EXECUTE FUNCTION public.league_slots_source_check();