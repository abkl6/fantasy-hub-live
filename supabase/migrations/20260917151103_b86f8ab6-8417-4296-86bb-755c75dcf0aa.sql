DELETE FROM public.faab_bids a USING public.faab_bids b
WHERE a.ctid > b.ctid
  AND a.league_id = b.league_id
  AND a.week = b.week
  AND a.player_name = b.player_name
  AND a.amount = b.amount;

CREATE UNIQUE INDEX IF NOT EXISTS faab_bids_unique_claim
  ON public.faab_bids (league_id, week, player_name, amount);