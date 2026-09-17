CREATE TABLE public.entitlements (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tier text NOT NULL DEFAULT 'free',
  source text NOT NULL DEFAULT 'founding',
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT entitlements_tier_check CHECK (tier IN ('free','premium')),
  CONSTRAINT entitlements_source_check CHECK (source IN ('founding','stripe','admin'))
);

GRANT SELECT ON public.entitlements TO authenticated;
GRANT ALL ON public.entitlements TO service_role;

ALTER TABLE public.entitlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own entitlement"
ON public.entitlements FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Admins read all entitlements"
ON public.entitlements FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_entitlements_updated_at
BEFORE UPDATE ON public.entitlements
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)))
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.entitlements (user_id, tier, source, expires_at)
  VALUES (NEW.id, 'premium', 'founding', '2027-02-01T00:00:00Z')
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;