ALTER TABLE public.leagues
  ADD COLUMN IF NOT EXISTS playoff_week_start integer,
  ADD COLUMN IF NOT EXISTS playoff_weeks jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS playoff_byes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS third_place_game boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS consolation jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS waiver_type text,
  ADD COLUMN IF NOT EXISTS waiver_run_times jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS divisions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS playoff_seed_type text,
  ADD COLUMN IF NOT EXISTS rules_text text,
  ADD COLUMN IF NOT EXISTS settings_source jsonb NOT NULL DEFAULT '{}'::jsonb;