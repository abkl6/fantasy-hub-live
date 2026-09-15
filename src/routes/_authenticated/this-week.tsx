import { Link, createFileRoute, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, ArrowRight, ClipboardCheck, Clock, Repeat2, Sparkles, Ticket } from "lucide-react";
import { useMemo, useState } from "react";

import { CacheStatus } from "@/components/CacheStatus";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCachedQuery } from "@/hooks/useCachedQuery";
import type { ThisWeekItem, ThisWeekPayload } from "@/lib/fantasy/this-week-types";
import { countdownLabel, gameWindow } from "@/lib/fantasy/gamewindow";
import { getThisWeekFn } from "@/lib/fantasy.functions";
import { leagueColor } from "@/lib/league-colors";

export const Route = createFileRoute("/_authenticated/this-week")({
  // Once the games start, Game Day takes over.
  beforeLoad: () => {
    if (gameWindow().live) throw redirect({ to: "/gameday" });
  },
  head: () => ({
    meta: [
      { title: "This week — Gridiron Edge" },
      {
        name: "description",
        content:
          "Everything to handle before kickoff: waiver clocks and pending claims, hurt or bye-week starters with the best replacement, open trade offers and rising free agents across all of your leagues.",
      },
      { property: "og:title", content: "This week — Gridiron Edge" },
      {
        property: "og:description",
        content: "One prioritized list of every fantasy move to make before the first kickoff.",
      },
    ],
  }),
  component: ThisWeekPage,
});

const ICONS = {
  lineup: AlertTriangle,
  claim: Ticket,
  "trade-offer": Repeat2,
  "waiver-deadline": Clock,
  rising: Sparkles,
} as const;

const GROUPS: { kind: ThisWeekItem["kind"]; label: string }[] = [
  { kind: "lineup", label: "Lineup risks" },
  { kind: "claim", label: "Pending claims" },
  { kind: "trade-offer", label: "Trade offers" },
  { kind: "waiver-deadline", label: "Waiver clock" },
  { kind: "rising", label: "Trending and available" },
];

function ItemRow({ item }: { item: ThisWeekItem }) {
  const Icon = ICONS[item.kind];
  return (
    <Link
      to="/league/$leagueId"
      params={{ leagueId: item.leagueId }}
      search={{
        tab: item.tab,
        ...(item.swap ? { swap: item.swap } : {}),
        ...(item.replacement ? { with: item.replacement } : {}),
      }}
      className="flex items-center gap-3 px-3 py-3 transition-colors hover:bg-accent"
      style={{ borderLeft: `3px solid ${leagueColor(item.leagueColor, item.leagueId)}` }}
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{item.title}</p>
        <p className="truncate text-xs text-muted-foreground">
          {item.leagueName} · {item.detail}
        </p>
      </div>
      {item.meta ? (
        <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{item.meta}</span>
      ) : null}
      <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </Link>
  );
}

function ThisWeekPage() {
  const load = useServerFn(getThisWeekFn);
  const [now] = useState(() => new Date());
  const { data, isLoading, error, updating, stale, lastUpdated } = useCachedQuery<ThisWeekPayload>({
    cacheKey: "this-week",
    queryKey: ["this-week"],
    queryFn: () => load(),
  });

  const grouped = useMemo(() => {
    const items = data?.items ?? [];
    return GROUPS.map((group) => ({
      ...group,
      rows: items.filter((item) => item.kind === group.kind),
    })).filter((group) => group.rows.length > 0);
  }, [data]);

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">This week</h1>
        <div className="flex items-center gap-2">
        <Button asChild size="sm" variant="secondary">
          <Link to="/lineup-check">
            <ClipboardCheck className="size-4" aria-hidden="true" />
            Lineup check
          </Link>
        </Button>
        {data ? (
          <span className="text-xs text-muted-foreground">
            {data.kickoffLabel} in {countdownLabel(new Date(data.kickoffAt), now)}
          </span>
        ) : null}
        </div>
      </div>
      <CacheStatus updating={updating} stale={stale} lastUpdated={lastUpdated} />

      {isLoading && !data ? (
        <div className="mt-4 space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      ) : null}

      {error && !data ? (
        <p className="mt-6 text-sm text-destructive">Could not load this week's list.</p>
      ) : null}

      {data && data.leagues.length === 0 ? (
        <div className="mt-6 rounded-xl bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">No leagues yet.</p>
          <Button asChild size="sm" className="mt-3">
            <Link to="/connect">Add a league</Link>
          </Button>
        </div>
      ) : null}

      {data && data.leagues.length > 0 ? (
        <>
          {grouped.map((group) => (
            <section key={group.kind} className="mt-5">
              <h2 className="mb-2 text-sm font-semibold text-muted-foreground">{group.label}</h2>
              <div className="divide-y divide-border overflow-hidden rounded-xl bg-card">
                {group.rows.map((item) => (
                  <ItemRow key={item.id} item={item} />
                ))}
              </div>
            </section>
          ))}

          <section className="mt-6">
            <h2 className="mb-2 text-sm font-semibold text-muted-foreground">By league</h2>
            <div className="space-y-2">
              {data.leagues.map((league) => (
                <div
                  key={league.id}
                  className="flex items-center justify-between gap-3 rounded-xl bg-card px-3 py-3"
                  style={{ borderLeft: `3px solid ${leagueColor(league.color, league.id)}` }}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{league.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {league.teamName} · {league.record}
                    </p>
                  </div>
                  {league.items.length === 0 ? (
                    <Badge variant="secondary">Nothing to do</Badge>
                  ) : (
                    <Link
                      to="/league/$leagueId"
                      params={{ leagueId: league.id }}
                      search={{ tab: "moves" }}
                      className="shrink-0 text-xs font-semibold text-primary"
                    >
                      {league.items.length} to handle
                    </Link>
                  )}
                </div>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </main>
  );
}
