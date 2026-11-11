-- One round trip fingerprints everything a league's stored results depend on,
-- instead of five separate reads per league. Runs as the caller, so row
-- security still decides which leagues are visible.
CREATE OR REPLACE FUNCTION public.league_inputs_digest(_league_ids uuid[] DEFAULT NULL, _user_id uuid DEFAULT NULL)
RETURNS TABLE (league_id uuid, digest text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT l.id,
    md5(concat_ws('#',
      l.id::text, l.projection_source, l.scoring_type, l.scoring_rules::text, l.roster_slots::text,
      l.eligible_positions::text, l.sos_adjust::text, l.class_override, l.current_week::text,
      l.contest_format, l.format, l.variant,
      (SELECT max(w.week)::text FROM public.player_week_stats w WHERE w.season = l.season),
      (SELECT md5(coalesce(string_agg(concat_ws('|', s.team_id, s.player_id, s.player_name, s.position, s.slot, s.is_starter::text), ',' ORDER BY s.team_id, s.player_name, s.slot), ''))
         FROM public.roster_spots s WHERE s.league_id = l.id),
      (SELECT md5(coalesce(string_agg(concat_ws('|', t.id, t.name, t.wins, t.losses, t.ties, t.points_for, t.points_against, t.faab_remaining, t.vp, t.eliminated_week), ',' ORDER BY t.id), ''))
         FROM public.teams t WHERE t.league_id = l.id),
      (SELECT md5(coalesce(string_agg(concat_ws('|', m.week, m.home_team_id, m.away_team_id, m.home_score, m.away_score, m.is_final::text), ',' ORDER BY m.week, m.home_team_id, m.away_team_id), ''))
         FROM public.matchups m WHERE m.league_id = l.id)
    ))
  FROM public.leagues l
  WHERE (_league_ids IS NULL OR l.id = ANY(_league_ids))
    AND (_user_id IS NULL OR l.user_id = _user_id);
$$;

REVOKE ALL ON FUNCTION public.league_inputs_digest(uuid[], uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.league_inputs_digest(uuid[], uuid) TO authenticated, service_role;