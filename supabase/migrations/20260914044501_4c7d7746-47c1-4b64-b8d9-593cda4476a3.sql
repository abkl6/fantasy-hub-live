ALTER TABLE public.leagues ADD COLUMN IF NOT EXISTS faab_budget integer NOT NULL DEFAULT 100;
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS faab_remaining integer;
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS faab_spent integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.faab_bids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  league_id uuid NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  team_id uuid REFERENCES public.teams(id) ON DELETE CASCADE,
  week integer NOT NULL DEFAULT 1,
  player_name text NOT NULL,
  amount integer NOT NULL,
  won boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.faab_bids TO authenticated;
GRANT ALL ON public.faab_bids TO service_role;

ALTER TABLE public.faab_bids ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own faab bids"
ON public.faab_bids FOR ALL TO authenticated
USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER faab_bids_updated BEFORE UPDATE ON public.faab_bids
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();