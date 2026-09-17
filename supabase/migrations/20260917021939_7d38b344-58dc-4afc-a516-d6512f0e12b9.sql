ALTER TABLE public.leagues
  ADD COLUMN IF NOT EXISTS abbrev text,
  ADD COLUMN IF NOT EXISTS strip_order integer,
  ADD COLUMN IF NOT EXISTS open_count integer NOT NULL DEFAULT 0;