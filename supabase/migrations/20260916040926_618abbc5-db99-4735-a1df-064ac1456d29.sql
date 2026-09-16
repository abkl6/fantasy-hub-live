CREATE TABLE public.age_curves (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  position text NOT NULL,
  format text NOT NULL DEFAULT 'sf',
  points jsonb NOT NULL DEFAULT '[]'::jsonb,
  sample_size integer NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'ktc',
  fitted_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (position, format)
);

GRANT SELECT ON public.age_curves TO authenticated;
GRANT ALL ON public.age_curves TO service_role;

ALTER TABLE public.age_curves ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Signed-in users can read age curves"
  ON public.age_curves FOR SELECT TO authenticated USING (true);

CREATE TRIGGER age_curves_updated
  BEFORE UPDATE ON public.age_curves
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();