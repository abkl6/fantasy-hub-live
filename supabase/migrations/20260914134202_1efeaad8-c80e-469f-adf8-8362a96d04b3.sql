ALTER TABLE public.leagues ADD COLUMN IF NOT EXISTS color text;

WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY user_id ORDER BY created_at) - 1 AS idx
  FROM public.leagues
)
UPDATE public.leagues l
SET color = (ARRAY['lime','sky','amber','violet','rose','teal'])[(r.idx % 6) + 1]
FROM ranked r
WHERE r.id = l.id AND l.color IS NULL;