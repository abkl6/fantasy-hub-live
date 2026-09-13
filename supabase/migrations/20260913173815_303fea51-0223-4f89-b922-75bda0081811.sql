-- 1. Shared name normaliser (case, punctuation and Jr./Sr./II-V suffixes)
CREATE OR REPLACE FUNCTION public.norm_player_name(name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT btrim(
    regexp_replace(
      regexp_replace(
        regexp_replace(lower(coalesce(name, '')), '[^a-z0-9 ]', '', 'g'),
        '\s+', ' ', 'g'
      ),
      ' (jr|sr|ii|iii|iv|v)$', ''
    )
  )
$$;

-- 2. Merge duplicate player rows
CREATE TEMP TABLE dup_map ON COMMIT DROP AS
WITH grouped AS (
  SELECT public.norm_player_name(full_name) AS base,
         upper(position) AS pos,
         (array_agg(id ORDER BY (sleeper_id IS NOT NULL) DESC, proj_points_season DESC, created_at))[1] AS keep_id,
         array_agg(id) AS all_ids
  FROM public.players
  GROUP BY 1, 2
  HAVING count(*) > 1
)
SELECT g.keep_id, u.id AS dup_id
FROM grouped g, unnest(g.all_ids) AS u(id)
WHERE u.id <> g.keep_id;

UPDATE public.players p
SET proj_points_season = GREATEST(p.proj_points_season, d.s),
    proj_points_week = GREATEST(p.proj_points_week, d.w),
    bye_week = COALESCE(p.bye_week, d.bye)
FROM (
  SELECT m.keep_id,
         max(x.proj_points_season) AS s,
         max(x.proj_points_week) AS w,
         max(x.bye_week) AS bye
  FROM dup_map m
  JOIN public.players x ON x.id = m.dup_id
  GROUP BY m.keep_id
) d
WHERE p.id = d.keep_id;

UPDATE public.roster_spots rs SET player_id = m.keep_id FROM dup_map m WHERE rs.player_id = m.dup_id;
UPDATE public.player_news n SET player_id = m.keep_id FROM dup_map m WHERE n.player_id = m.dup_id;

DELETE FROM public.players p USING dup_map m WHERE p.id = m.dup_id;

-- 3. Point every roster row at the surviving player and spelling
UPDATE public.roster_spots rs
SET player_id = p.id,
    player_name = p.full_name,
    nfl_team = COALESCE(p.nfl_team, rs.nfl_team)
FROM public.players p
WHERE public.norm_player_name(rs.player_name) = public.norm_player_name(p.full_name)
  AND upper(rs.position) = upper(p.position)
  AND (rs.player_id IS DISTINCT FROM p.id OR rs.player_name <> p.full_name);

UPDATE public.draft_picks dp
SET player_name = p.full_name
FROM public.players p
WHERE public.norm_player_name(dp.player_name) = public.norm_player_name(p.full_name)
  AND upper(dp.position) = upper(p.position)
  AND dp.player_name <> p.full_name;

-- 4. Guard rail against re-introducing a second spelling
CREATE UNIQUE INDEX IF NOT EXISTS players_norm_name_position_key
  ON public.players (public.norm_player_name(full_name), upper(position));

-- 5. Live stat snapshots
CREATE TABLE public.live_player_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  sleeper_id text,
  season integer NOT NULL,
  week integer NOT NULL,
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  game_state text NOT NULL DEFAULT 'pre',
  game_clock text,
  opponent text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (player_id, season, week)
);

GRANT SELECT ON public.live_player_stats TO authenticated;
GRANT ALL ON public.live_player_stats TO service_role;
ALTER TABLE public.live_player_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Live stats readable by signed-in users"
  ON public.live_player_stats FOR SELECT TO authenticated USING (true);

CREATE TRIGGER live_player_stats_updated
  BEFORE UPDATE ON public.live_player_stats
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 6. Scoring event log
CREATE TABLE public.scoring_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  player_name text NOT NULL,
  position text NOT NULL,
  nfl_team text,
  season integer NOT NULL,
  week integer NOT NULL,
  delta jsonb NOT NULL DEFAULT '{}'::jsonb,
  description text NOT NULL,
  dedupe_key text NOT NULL UNIQUE,
  occurred_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT ON public.scoring_events TO authenticated;
GRANT ALL ON public.scoring_events TO service_role;
ALTER TABLE public.scoring_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Scoring events readable by signed-in users"
  ON public.scoring_events FOR SELECT TO authenticated USING (true);

CREATE INDEX scoring_events_week_idx ON public.scoring_events (season, week, occurred_at DESC);