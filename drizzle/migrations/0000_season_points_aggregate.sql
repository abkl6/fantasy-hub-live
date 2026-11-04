CREATE OR REPLACE FUNCTION public.player_season_points(_season integer, _sources text[] DEFAULT NULL)
RETURNS TABLE(player_id uuid, points numeric, games integer)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT s.player_id, COALESCE(SUM(s.src_points),0)::numeric, COUNT(*)::integer
  FROM public.player_week_stats s
  WHERE s.season = _season AND (_sources IS NULL OR s.source = ANY(_sources))
  GROUP BY s.player_id
$$;
GRANT EXECUTE ON FUNCTION public.player_season_points(integer, text[]) TO authenticated, service_role;
CREATE INDEX IF NOT EXISTS player_week_stats_season_source_pts_idx ON public.player_week_stats (season, source) INCLUDE (player_id, src_points);
CREATE INDEX IF NOT EXISTS player_news_player_published_idx ON public.player_news (player_id, published_at DESC);