/**
 * Canonical player identifiers. Every import matches on a platform's own id
 * first and on the name only as a fallback — and when a name match succeeds we
 * write the id back, so that player is never matched by name again.
 * Server-only.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

import type { PlatformIdField } from "./names";

type DB = SupabaseClient<Database>;

/** Save newly learnt identifiers. Existing values are never overwritten. */
export async function writeBackPlatformIds(
  supabase: DB,
  field: PlatformIdField,
  learnt: Map<string, string>,
): Promise<{ written: number }> {
  if (!learnt.size) return { written: 0 };
  let written = 0;
  for (const [playerId, value] of learnt) {
    const { error } = await supabase
      .from("players")
      .update({ [field]: value } as never)
      .eq("id", playerId)
      .is(field, null);
    if (!error) written += 1;
  }
  return { written };
}
