import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { CacheStatus } from "@/components/CacheStatus";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useCachedQuery } from "@/hooks/useCachedQuery";
import type { WaiverHubPayload, WaiverHubPlayer } from "@/lib/fantasy/waiver-hub-types";
import { getWaiverHubFn } from "@/lib/fantasy.functions";
import { leagueColor } from "@/lib/league-colors";

const TITLE = "Waivers — every free agent worth a bid";
const DESCRIPTION =
  "Top-120 projected free agents across all of your leagues, with the leagues each one is still available in, your remaining FAAB and a suggested bid from past winning bids.";

export const Route = createFileRoute("/_authenticated/waivers")({
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
  component: WaiversPage,
});

function PlayerCard({ player }: { player: WaiverHubPlayer }) {
  return (
    <div className="rounded-xl bg-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">
            {player.name}{" "}
            <span className="text-xs font-normal text-muted-foreground">
              {player.position}
              {player.nflTeam ? ` · ${player.nflTeam}` : ""}
            </span>
          </p>
          <p className="text-xs text-muted-foreground">
            Free in {player.leagues.length} of your leagues
            {player.status !== "Active" ? ` · ${player.status}` : ""}
          </p>
        </div>
        <span className="shrink-0 font-display text-lg font-bold tabular-nums">
          {player.bestProj.toFixed(1)}
        </span>
      </div>

      <div className="mt-2 divide-y divide-border">
        {player.leagues.map((entry) => (
          <div key={entry.leagueId} className="flex items-center gap-3 py-2">
            <span
              className="h-8 w-[3px] shrink-0 rounded-full"
              style={{ background: leagueColor(entry.leagueColor, entry.leagueId) }}
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold">{entry.leagueName}</p>
              <p className="truncate text-[11px] text-muted-foreground">{entry.basis}</p>
              {entry.impactLabel ? (
                <p className="truncate text-[11px] text-muted-foreground tabular-nums">
                  {entry.impactLabel}
                </p>
              ) : null}
              {entry.ruleNote ? (
                <p className="truncate text-[11px] text-muted-foreground">Rule: {entry.ruleNote}</p>
              ) : null}
            </div>
            <div className="shrink-0 text-right">
              <p className="text-sm font-semibold tabular-nums">${entry.suggestedBid}</p>
              <p className="text-[11px] text-muted-foreground tabular-nums">
                {entry.faabRemaining == null ? "budget unknown" : `$${entry.faabRemaining} left`}
              </p>
            </div>
            {entry.url ? (
              <a
                href={entry.url}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 text-muted-foreground transition-colors hover:text-primary"
                aria-label={entry.urlLabel ?? "Open league"}
              >
                <ExternalLink className="size-4" />
              </a>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function WaiversPage() {
  const load = useServerFn(getWaiverHubFn);
  const [search, setSearch] = useState("");
  const { data, isLoading, error, updating, stale, lastUpdated } = useCachedQuery<WaiverHubPayload>({
    cacheKey: "waiver-hub",
    queryKey: ["waiver-hub"],
    queryFn: () => load(),
  });

  const players = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = data?.players ?? [];
    return term ? list.filter((p) => p.name.toLowerCase().includes(term)) : list;
  }, [data, search]);

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Waivers</h1>
        {data ? <span className="text-xs text-muted-foreground">Week {data.week}</span> : null}
      </div>
      <CacheStatus updating={updating} stale={stale} lastUpdated={lastUpdated} />

      <div className="relative mt-3">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search players"
          className="pl-9"
        />
      </div>

      {isLoading && !data ? (
        <div className="mt-4 space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : null}

      {error && !data ? (
        <p className="mt-6 text-sm text-destructive">Could not load the waiver board.</p>
      ) : null}

      {data && !data.players.length ? (
        <p className="mt-6 text-sm text-muted-foreground">
          Nothing in the top 120 is free in your leagues right now.
        </p>
      ) : null}

      {data?.fills?.length ? (
        <section className="mt-4 space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">Fill empty slots</h2>
          {data.fills.map((group) => (
            <div
              key={group.leagueId}
              className="rounded-xl bg-card p-3"
              style={{ borderLeft: `3px solid ${leagueColor(group.leagueColor, group.leagueId)}` }}
            >
              <p className="text-xs font-semibold">{group.leagueName}</p>
              <ul className="mt-1 space-y-1">
                {group.fills.map((fill) => (
                  <li
                    key={fill.slot + fill.playerId}
                    className="flex items-center justify-between gap-3"
                  >
                    <span className="min-w-0 truncate text-sm">
                      <span className="eyebrow mr-2 text-muted-foreground">{fill.slot}</span>
                      {fill.name}
                      <span className="ml-2 text-xs text-muted-foreground">{fill.reason}</span>
                    </span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums">${fill.bid}</span>
                  </li>
                ))}
                {group.stream ? (
                  <li className="flex items-center justify-between gap-3 border-t border-border pt-1">
                    <span className="min-w-0 truncate text-sm">
                      <span className="eyebrow mr-2 text-muted-foreground">
                        Stream {group.stream.position}
                      </span>
                      {group.stream.inName} for {group.stream.outName}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {group.stream.reason}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums">
                      ${group.stream.bid}
                    </span>
                  </li>
                ) : null}
              </ul>
            </div>
          ))}
        </section>
      ) : null}

      {data && data.players.length ? (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            {data.leagues.map((l) => (
              <Badge key={l.id} variant="secondary" className="gap-2">
                <span
                  className="size-2 rounded-full"
                  style={{ background: leagueColor(l.color, l.id) }}
                  aria-hidden="true"
                />
                {l.name}
                {l.faabRemaining == null ? "" : ` · $${l.faabRemaining}`}
              </Badge>
            ))}
          </div>
          <div className="mt-3 space-y-2">
            {players.map((player) => (
              <PlayerCard key={player.key} player={player} />
            ))}
          </div>
        </>
      ) : null}
    </main>
  );
}
