CREATE TABLE public.manual_transactions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  league_id uuid NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  occurred_on date NOT NULL,
  kind text NOT NULL,
  player_name text NOT NULL,
  norm_name text NOT NULL,
  position text,
  from_team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL,
  to_team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL,
  dedupe_key text NOT NULL,
  raw_line text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.manual_transactions TO authenticated;
GRANT ALL ON public.manual_transactions TO service_role;

ALTER TABLE public.manual_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members manage their own manual transactions"
ON public.manual_transactions FOR ALL TO authenticated
USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE UNIQUE INDEX manual_transactions_dedupe
  ON public.manual_transactions (league_id, dedupe_key);

CREATE TRIGGER manual_transactions_updated
BEFORE UPDATE ON public.manual_transactions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.manual_lineups (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  league_id uuid NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  week integer NOT NULL,
  confirmed boolean NOT NULL DEFAULT false,
  slots jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.manual_lineups TO authenticated;
GRANT ALL ON public.manual_lineups TO service_role;

ALTER TABLE public.manual_lineups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members manage their own manual lineups"
ON public.manual_lineups FOR ALL TO authenticated
USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE UNIQUE INDEX manual_lineups_team_week ON public.manual_lineups (team_id, week);

CREATE TRIGGER manual_lineups_updated
BEFORE UPDATE ON public.manual_lineups
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.leagues ADD COLUMN IF NOT EXISTS last_confirmed_at timestamp with time zone;