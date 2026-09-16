/** Reads the strategy rules out of the database. Server-only. */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

import { DEFAULT_RULES, ruleBook, type RuleBook, type StrategyRule } from "./rules";

type DB = SupabaseClient<Database>;

export async function loadStrategyRules(supabase: DB): Promise<RuleBook> {
  const { data, error } = await supabase
    .from("strategy_rules")
    .select("key, category, rule, rationale, weight, enabled")
    .order("sort_order");
  // The advice still has to work if the table cannot be read.
  if (error || !data) return ruleBook(DEFAULT_RULES);
  const rows: StrategyRule[] = data.map((r) => ({
    key: r.key,
    category: r.category,
    rule: r.rule,
    rationale: r.rationale,
    weight: Number(r.weight),
    enabled: r.enabled,
  }));
  return ruleBook(rows);
}
