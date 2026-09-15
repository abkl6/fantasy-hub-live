import { Link, createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowUpRight, Check, CircleAlert, CircleCheck, CircleX, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCachedQuery } from "@/hooks/useCachedQuery";
import { getLineupCheckFn } from "@/lib/fantasy.functions";
import type { LineupCheckLeague, LineupCheckPayload, LineupState } from "@/lib/fantasy/lineup-check-types";
import { leagueColor } from "@/lib/league-colors";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/lineup-check")({
  head: () => ({
    meta: [
      { title: "Lineup check — Gridiron Edge" },
      {
        name: "description",
        content:
          "Check every fantasy lineup before kickoff: out and bye-week starters, bench players projected to score more, and the swap to make in each league.",
      },
      { property: "og:title", content: "Lineup check — Gridiron Edge" },
      {
        property: "og:description",
        content: "One screen that flags every lineup problem across your leagues and names the swap.",
      },
    ],
  }),
  component: LineupCheckPage,
});

const STATE_META: Record<LineupState, { label: string; icon: typeof CircleCheck; className: string }> = {
  green: { label: "All set", icon: CircleCheck, className: "text-primary" },
  yellow: { label: "Worth a look", icon: CircleAlert, className: "text-amber-400" },
  red: { label: "Needs a change", icon: CircleX, className: "text-destructive" },
};

const DONE_KEY = "lineup-check-done";

function useDone() {
  const [done, setDone] = useState<string[]>([]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DONE_KEY);
      if (raw) setDone(JSON.parse(raw) as string[]);
    } catch {
      /* ignore unreadable storage */
    }
  }, []);
  const toggle = (id: string) => {
    setDone((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      try {
        localStorage.setItem(DONE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };
  return { done, toggle };
}

function LeagueCard({
  league,
  done,
  toggle,
}: {
  league: LineupCheckLeague;
  done: string[];
  toggle: (id: string) => void;
}) {
  const meta = STATE_META[league.state];
  const Icon = meta.icon;
  const openIssues = league.issues.filter((i) => !done.includes(i.id));

  return (
    <article
      className="rounded-xl bg-card"
      style={{ borderLeft: `3px solid ${leagueColor(league.color, league.id)}` }}
    >
      <div className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Icon className={cn("size-4", meta.className)} aria-hidden="true" />
            <h2 className="truncate font-bold">{league.name}</h2>
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {league.teamName} · week {league.week} · {openIssues.length ? league.summary : "Nothing to do"}
          </p>
        </div>
        {league.externalUrl ? (
          <Button asChild size="sm" variant="secondary">
            <a href={league.externalUrl} target="_blank" rel="noreferrer">
              {league.externalLabel}
              <ArrowUpRight className="size-4" aria-hidden="true" />
            </a>
          </Button>
        ) : null}
      </div>

      {league.issues.length ? (
        <div className="divide-y divide-border border-t border-border">
          {league.issues.map((issue) => {
            const isDone = done.includes(issue.id);
            return (
              <div key={issue.id} className={cn("flex items-center gap-3 px-4 py-3", isDone && "opacity-50")}>
                <button
                  type="button"
                  onClick={() => toggle(issue.id)}
                  aria-label={isDone ? `Mark ${issue.starter} not done` : `Mark ${issue.starter} done`}
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-md border border-border",
                    isDone && "bg-primary text-primary-foreground",
                  )}
                >
                  {isDone ? <Check className="size-4" aria-hidden="true" /> : null}
                </button>
                <div className="min-w-0 flex-1">
                  <p className={cn("truncate text-sm font-semibold", isDone && "line-through")}>
                    {issue.slot}: {issue.starter} — {issue.problem}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {issue.replacement
                      ? `Start ${issue.replacement} (${issue.replacementPosition})${
                          issue.gain !== null && issue.gain > 0 ? ` · +${issue.gain} proj` : ""
                        }`
                      : "No eligible bench replacement."}
                  </p>
                </div>
                <Badge variant={issue.severity === "red" ? "destructive" : "secondary"}>
                  {issue.severity === "red" ? "Fix" : "Check"}
                </Badge>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">Nothing to do.</p>
      )}

      <div className="px-4 pb-3">
        <Link
          to="/league/$leagueId"
          params={{ leagueId: league.id }}
          search={{ tab: "lineup" }}
          className="text-xs font-semibold text-primary"
        >
          Open league lineup
        </Link>
      </div>
    </article>
  );
}

function LineupCheckPage() {
  const load = useServerFn(getLineupCheckFn);
  const { done, toggle } = useDone();
  const { data, isLoading, isFetching, error, refetch } = useCachedQuery<LineupCheckPayload>({
    cacheKey: "lineup-check",
    queryKey: ["lineup-check"],
    queryFn: () => load(),
  });

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Lineup check</h1>
        <Button size="sm" variant="ghost" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={cn("size-4", isFetching && "animate-spin")} aria-hidden="true" />
          Refresh
        </Button>
      </div>

      {isLoading && !data ? (
        <div className="mt-4 space-y-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      ) : null}

      {error && !data ? <p className="mt-6 text-sm text-destructive">Could not run the lineup check.</p> : null}

      {data && data.leagues.length === 0 ? (
        <div className="mt-6 rounded-xl bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">No leagues yet.</p>
          <Button asChild size="sm" className="mt-3">
            <Link to="/connect">Add a league</Link>
          </Button>
        </div>
      ) : null}

      <div className="mt-4 space-y-3">
        {(data?.leagues ?? []).map((league) => (
          <LeagueCard key={league.id} league={league} done={done} toggle={toggle} />
        ))}
      </div>
    </main>
  );
}
