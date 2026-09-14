-- 1. Drop the index that depends on the old name cleaner
DROP INDEX IF EXISTS public.players_norm_name_position_key;

-- 2. Stronger name cleaner: accents, punctuation, hyphens, defense aliases,
--    and stacked/numeric generational suffixes. Mirrors src/lib/fantasy/names.ts
CREATE OR REPLACE FUNCTION public.norm_player_name(name text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  base text;
  prev text;
BEGIN
  base := lower(coalesce(name, ''));
  base := translate(base,
    'áàâäãåéèêëíìîïóòôöõúùûüñçýÿ',
    'aaaaaaeeeeiiiiooooouuuuncyy');
  base := regexp_replace(base, '[.,''`’]', '', 'g');
  base := regexp_replace(base, '[-/\\]', ' ', 'g');
  base := regexp_replace(base, '[^a-z0-9 ]', ' ', 'g');
  base := btrim(regexp_replace(base, '\s+', ' ', 'g'));
  base := regexp_replace(base, '\m(dst|d st|def|defense|defence|special teams)\M', 'dst', 'g');
  base := btrim(regexp_replace(base, '\s+', ' ', 'g'));

  prev := '';
  WHILE prev <> base LOOP
    prev := base;
    base := btrim(regexp_replace(base, '\s+(jr|sr|ii|iii|iv|v|vi|vii|viii|2nd|3rd|4th|5th)$', ''));
  END LOOP;

  RETURN base;
END;
$$;

-- 3. Merge any duplicate player rows under the new cleaner
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
    bye_week = COALESCE(p.bye_week, d.bye),
    sleeper_id = COALESCE(p.sleeper_id, d.sid),
    age = COALESCE(p.age, d.age),
    years_exp = COALESCE(p.years_exp, d.yexp)
FROM (
  SELECT m.keep_id,
         max(x.proj_points_season) AS s,
         max(x.proj_points_week) AS w,
         max(x.bye_week) AS bye,
         min(x.sleeper_id) AS sid,
         max(x.age) AS age,
         max(x.years_exp) AS yexp
  FROM dup_map m
  JOIN public.players x ON x.id = m.dup_id
  GROUP BY m.keep_id
) d
WHERE p.id = d.keep_id;

-- Remap dependents, dropping rows that would collide with the survivor
DELETE FROM public.player_week_stats s
USING dup_map m
WHERE s.player_id = m.dup_id
  AND EXISTS (
    SELECT 1 FROM public.player_week_stats k
    WHERE k.player_id = m.keep_id AND k.season = s.season AND k.week = s.week
  );
UPDATE public.player_week_stats s SET player_id = m.keep_id FROM dup_map m WHERE s.player_id = m.dup_id;

DELETE FROM public.player_projection_overrides o
USING dup_map m
WHERE o.player_id = m.dup_id
  AND EXISTS (
    SELECT 1 FROM public.player_projection_overrides k
    WHERE k.player_id = m.keep_id AND k.user_id = o.user_id
  );
UPDATE public.player_projection_overrides o SET player_id = m.keep_id FROM dup_map m WHERE o.player_id = m.dup_id;

UPDATE public.live_player_stats l SET player_id = m.keep_id FROM dup_map m WHERE l.player_id = m.dup_id;
UPDATE public.scoring_events e SET player_id = m.keep_id FROM dup_map m WHERE e.player_id = m.dup_id;
UPDATE public.roster_spots rs SET player_id = m.keep_id FROM dup_map m WHERE rs.player_id = m.dup_id;
UPDATE public.player_news n SET player_id = m.keep_id FROM dup_map m WHERE n.player_id = m.dup_id;

DELETE FROM public.players p USING dup_map m WHERE p.id = m.dup_id;

-- 4. Point rosters and draft picks at the surviving player and spelling
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

UPDATE public.players SET search_name = public.norm_player_name(full_name)
WHERE search_name IS DISTINCT FROM public.norm_player_name(full_name);

-- 5. Guard rail against re-introducing a second spelling
CREATE UNIQUE INDEX IF NOT EXISTS players_norm_name_position_key
  ON public.players (public.norm_player_name(full_name), upper(position));