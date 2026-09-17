/**
 * Turns a platform's transaction log into stored winning bids, then keeps each
 * team's FAAB balance in step with them.
 *
 * Two things depend on this. Bid advice reads past winning bids to learn what
 * this league actually pays, and rivals' remaining budgets set the floor a bid
 * has to clear — FFPC only publishes the manager's own balance, so everyone
 * else's is worked out from what they have spent.
 * Server-only.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type DB = SupabaseClient<Database>;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface BidRecord {
  week: number;
  teamExternalId: string | null;
  playerName: string;
  amount: number;
}

/**
 * FFPC dates a transaction but does not label its week, so the week is counted
 * back from today against the league's current week. Anything that cannot be
 * read as a date is treated as this week.
 */
export function weekOfTransaction(
  date: string | null,
  currentWeek: number,
  now: Date = new Date(),
): number {
  if (!date) return currentWeek;
  const parsed = Date.parse(date);
  if (Number.isNaN(parsed)) return currentWeek;
  const weeksAgo = Math.floor((now.getTime() - parsed) / WEEK_MS);
  if (weeksAgo <= 0) return currentWeek;
  return Math.max(1, currentWeek - weeksAgo);
}

export interface TransactionLike {
  date: string | null;
  bid: number | null;
  teamExternalId: string | null;
  addedPlayer: { name: string } | null;
}

/** Keeps only the claims that actually cost FAAB. */
export function bidsFromTransactions(
  transactions: TransactionLike[],
  currentWeek: number,
  now: Date = new Date(),
): BidRecord[] {
  const out: BidRecord[] = [];
  const seen = new Set<string>();
  for (const t of transactions) {
    const amount = t.bid == null ? null : Math.round(t.bid);
    if (amount == null || amount <= 0) continue;
    const name = t.addedPlayer?.name?.trim();
    if (!name) continue;
    const week = weekOfTransaction(t.date, currentWeek, now);
    const key = `${week}|${name.toLowerCase()}|${amount}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ week, teamExternalId: t.teamExternalId, playerName: name, amount });
  }
  return out;
}

/**
 * Stores this league's winning bids and refreshes every team's budget.
 * Re-reading the same transaction page is safe: a bid is unique per league,
 * week, player and amount.
 */
export async function recordWinningBids(
  supabase: DB,
  userId: string,
  leagueId: string,
  input: {
    transactions: TransactionLike[];
    currentWeek: number;
    faabBudget: number;
    teamByExternal: Map<string | null, string>;
    reportedTeamIds?: Set<string>;
  },
): Promise<{ stored: number }> {
  const bids = bidsFromTransactions(input.transactions, input.currentWeek);
  if (bids.length) {
    const rows = bids.map((b) => ({
      user_id: userId,
      league_id: leagueId,
      team_id: b.teamExternalId ? (input.teamByExternal.get(b.teamExternalId) ?? null) : null,
      week: b.week,
      player_name: b.playerName,
      amount: b.amount,
      won: true,
    }));
    for (let i = 0; i < rows.length; i += 200) {
      await supabase
        .from("faab_bids")
        .upsert(rows.slice(i, i + 200) as never, {
          onConflict: "league_id,week,player_name,amount",
          ignoreDuplicates: true,
        });
    }
  }

  await reconcileTeamFaab(supabase, leagueId, input.faabBudget, {
    ...(input.reportedTeamIds ? { reportedTeamIds: input.reportedTeamIds } : {}),
  });
  return { stored: bids.length };
}

/**
 * Fills in the budgets a platform does not publish. A team's own reported
 * balance always wins; the rest are the league budget minus what the
 * transaction log shows them spending.
 */
export async function reconcileTeamFaab(
  supabase: DB,
  leagueId: string,
  faabBudget: number,
  opts: { reportedTeamIds?: Set<string> } = {},
): Promise<void> {
  if (!faabBudget) return;
  const [{ data: teams }, { data: bids }] = await Promise.all([
    supabase.from("teams").select("id").eq("league_id", leagueId),
    supabase.from("faab_bids").select("team_id, amount, won").eq("league_id", leagueId),
  ]);
  if (!teams?.length) return;

  const spent = new Map<string, number>();
  for (const bid of bids ?? []) {
    if (!bid.team_id || bid.won === false) continue;
    spent.set(bid.team_id, (spent.get(bid.team_id) ?? 0) + Number(bid.amount ?? 0));
  }

  for (const team of teams) {
    if (opts.reportedTeamIds?.has(team.id)) continue;
    const used = Math.min(faabBudget, spent.get(team.id) ?? 0);
    await supabase
      .from("teams")
      .update({ faab_spent: used, faab_remaining: faabBudget - used })
      .eq("id", team.id);
  }
}
