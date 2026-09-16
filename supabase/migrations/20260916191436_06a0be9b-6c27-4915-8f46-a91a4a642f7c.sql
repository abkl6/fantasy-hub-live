CREATE TABLE public.strategy_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  category text NOT NULL,
  rule text NOT NULL,
  rationale text NOT NULL,
  weight numeric NOT NULL DEFAULT 1,
  enabled boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT ON public.strategy_rules TO authenticated;
GRANT ALL ON public.strategy_rules TO service_role;

ALTER TABLE public.strategy_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Signed-in members can read the rules"
  ON public.strategy_rules FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins manage the rules"
  ON public.strategy_rules FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER strategy_rules_updated
  BEFORE UPDATE ON public.strategy_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.strategy_rules (key, category, rule, rationale, weight, sort_order) VALUES
('stream-k-def', 'Roster construction',
 'Stream kickers and defences: never bid above the minimum, never trade for one, never roster two.',
 'Week-to-week kicker and defence scoring is close to random, so paying for one costs you a real roster spot.',
 1, 10),
('value-over-replacement', 'Ranking',
 'Rank every player by their projection minus the best available free agent at the same position in this league, recomputed on every sync.',
 'Nine points from a defence you could replace with an eight-point defence is worth one point; eight from a receiver you could only replace with six is worth two.',
 1, 20),
('waiver-proof', 'Waivers',
 'A waiver pickup only outranks a steady bench player after two strong weeks or a documented role change.',
 'One big game is usually noise. Two weeks, or a stated change in role, is the first point where the new player is genuinely the better bet.',
 1, 30),
('handcuff-top-rb', 'Roster construction',
 'Handcuff your top two running backs before adding bye-week fillers.',
 'A lead back going down costs far more than one empty week, and his backup is the only player who recovers that value.',
 1, 40),
('playoff-schedule', 'Timing',
 'For contenders in the last four regular-season weeks, count the weeks 15 to 17 schedule double.',
 'By then the only games that decide your season are the playoff weeks, so a player with an easy weeks 15 to 17 run is worth more than his season average.',
 2, 50),
('class-tiebreak', 'Team class',
 'When two ideas are level, team class breaks the tie: contenders take the one that helps now, rebuilders take age and picks.',
 'The same move is right for one team and wrong for another; the standings decide which.',
 1, 60),
('faab-reserve', 'Waivers',
 'Keep a waiver budget reserve — never spend down to nothing before the season is over.',
 'Injuries arrive late as well as early, and a manager with nothing left to bid cannot answer them.',
 1, 70),
('protect-top-wire', 'Waivers',
 'Never recommend dropping a player who would rank in the top five on the wire.',
 'If he would be the best add available the moment you cut him, he is worth more on your bench than the player you were chasing.',
 1, 80);