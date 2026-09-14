import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";

import { TradeBuilder } from "@/components/TradeBuilder";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { listLeagues } from "@/lib/fantasy.functions";

const TITLE = "Trade Desk — price any trade before you send it";
const DESCRIPTION =
  "Build a trade between any two teams, see market value, how likely it is to be accepted, and the playoff, title and dynasty impact for both sides.";

export const Route = createFileRoute("/_authenticated/trade-desk")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: TradeDeskPage,
});

function TradeDeskPage() {
  const load = useServerFn(listLeagues);
  const leagues = useQuery({ queryKey: ["leagues"], queryFn: () => load({}) });
  const [leagueId, setLeagueId] = useState("");

  useEffect(() => {
    const list = leagues.data ?? [];
    if (list.length && !list.some((l) => l.id === leagueId)) setLeagueId(list[0]!.id);
  }, [leagues.data, leagueId]);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Trade Desk</h1>
        <p className="text-sm text-muted-foreground">{DESCRIPTION}</p>
      </header>

      {leagues.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading your leagues…</p>
      ) : !(leagues.data ?? []).length ? (
        <p className="text-sm text-muted-foreground">Add a league first and its teams will show up here.</p>
      ) : (
        <>
          <div className="max-w-sm">
            <Select value={leagueId} onValueChange={setLeagueId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a league" />
              </SelectTrigger>
              <SelectContent>
                {(leagues.data ?? []).map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {leagueId && <TradeBuilder key={leagueId} leagueId={leagueId} />}
        </>
      )}
    </div>
  );
}
