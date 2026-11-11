/**
 * Data every league reads the same way, held in memory for a short while so a
 * page that builds several leagues — or several pages opened back to back —
 * downloads it once instead of once per feature. Server-only.
 *
 * The players table is shared reference data (every signed-in member may read
 * all of it), so one copy can safely serve every member on this server.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { fetchAllRows } from "./paginate";

type DB = SupabaseClient<Database>;
export type PlayerRow = Database["public"]["Tables"]["players"]["Row"];

/** Injury status lives on these rows and refreshes every ten minutes upstream. */
export const PLAYERS_TTL_MS = 2 * 60_000;

interface Memo<T> {
  at: number;
  value: Promise<T>;
}

let playersMemo: Memo<PlayerRow[]> | null = null;

/**
 * The full player list. Concurrent callers share one in-flight download; a
 * failed download is never kept, so the next caller retries.
 */
export function loadAllPlayers(supabase: DB, now: number = Date.now()): Promise<PlayerRow[]> {
  if (playersMemo && now - playersMemo.at < PLAYERS_TTL_MS) return playersMemo.value;
  const value = fetchAllRows<PlayerRow>((from, to) =>
    supabase.from("players").select("*").order("id").range(from, to),
  );
  const memo: Memo<PlayerRow[]> = { at: now, value };
  playersMemo = memo;
  value.catch(() => {
    if (playersMemo === memo) playersMemo = null;
  });
  return value;
}

/** Call after writing to players so the next read sees the change. */
export function invalidatePlayers(): void {
  playersMemo = null;
}
