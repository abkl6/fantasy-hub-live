ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS division text,
  ADD COLUMN IF NOT EXISTS playoff_seed integer;
