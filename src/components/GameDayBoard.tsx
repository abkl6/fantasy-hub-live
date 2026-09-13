import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getGameDayFn } from "@/lib/fantasy.functions";
import { gameWindow, pollInterval } from "@/lib/fantasy/gamewindow";
import type { LiveMatchup, LivePlayerRow } from "@/lib/fantasy/live-types";

const stateLabel: Record<LivePlayerRow["gameState"], string> = {
  pre: "Yet to play",
  in: "Playing",
  post: "Final",
};

function timeAgo(iso: string | null) {
  if (!iso) return "not yet";
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  return `${Math.round(secs / 3600)}h ago`;
}

function PlayerLine({ p, dim }: { p: LivePlayerRow; dim?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 py-1.5 text-sm ${dim ? "opacity-60" : ""}`}>
      <div className="flex min-w-0 items-center gap-2">
        <Badge variant="outline" className="w-11 justify-center text-[10px] uppercase">
          {p.slot}
        </Badge>
        <div className="min-w-0">
          <p className="truncate font-medium">{p.name}</p>
          <p className="text-[11px] text-muted-foreground">
            {p.position}
            {p.nflTeam ? ` · ${p.nflTeam}` : ""} ·{" "}
            {p.gameState === "in" && p.gameClock ? `Q live ${p.gameClock}` : stateLabel[p.gameState]}
          </p>
        </div>
      </div>
      <div className="text-right">
        <p className="font-display text-base font-bold tabular-nums">{p.livePoints.toFixed(1)}</p>
        <p className="text-[11px] text-muted-foreground tabular-nums">proj {p.projectedFinal.toFixed(1)}</p>
      </div>
    </div>
  );
}

function MatchupCard({ m }: { m: LiveMatchup }) {
  const [showBench, setShowBench] = useState(false);
  return (
    <article className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="eyebrow text-primary">
            {m.leagueName} · Week {m.week}
          </p>
          <p className="text-xs text-muted-foreground">{m.scoringLabel}</p>
        </div>
        <Badge variant="secondary" className="text-[10px] uppercase">
          {m.yetToPlay} of yours yet to play
        </Badge>
      </div>

      <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div>
          <p className="truncate text-sm font-medium">{m.myTeam}</p>
          <p className="font-display text-3xl font-bold tabular-nums">{m.myScore.toFixed(1)}</p>
          <p className="text-[11px] text-muted-foreground tabular-nums">proj {m.myProjected.toFixed(1)}</p>
        </div>
        <span className="text-xs uppercase text-muted-foreground">vs</span>
        <div className="text-right">
          <p className="truncate text-sm font-medium">{m.oppTeam ?? "No opponent this week"}</p>
          <p className="font-display text-3xl font-bold tabular-nums">{m.oppScore.toFixed(1)}</p>
          <p className="text-[11px] text-muted-foreground tabular-nums">proj {m.oppProjected.toFixed(1)}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-6 md:grid-cols-2">
        <div>
          <p className="eyebrow mb-1 text-muted-foreground">Your starters</p>
          <div className="divide-y divide-border">
            {m.starters.map((p) => (
              <PlayerLine key={`${p.name}-${p.slot}`} p={p} />
            ))}
          </div>
        </div>
        <div>
          <p className="eyebrow mb-1 text-muted-foreground">Opponent starters</p>
          <div className="divide-y divide-border">
            {m.oppStarters.length ? (
              m.oppStarters.map((p) => <PlayerLine key={`o-${p.name}-${p.slot}`} p={p} />)
            ) : (
              <p className="py-2 text-sm text-muted-foreground">No opponent lineup yet.</p>
            )}
          </div>
        </div>
      </div>

      {m.bench.length > 0 && (
        <div className="mt-4">
          <Button size="sm" variant="ghost" onClick={() => setShowBench((v) => !v)}>
            {showBench ? "Hide bench" : `Show bench (${m.bench.length})`}
          </Button>
          {showBench && (
            <div className="mt-2 divide-y divide-border">
              {m.bench.map((p) => (
                <PlayerLine key={`b-${p.name}-${p.slot}`} p={p} dim />
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

export function GameDayBoard({ leagueId }: { leagueId?: string }) {
  const fetchGameDay = useServerFn(getGameDayFn);
  const [sides, setSides] = useState<"all" | "mine">("all");
  const [leagueFilter, setLeagueFilter] = useState<string>("all");
  const window = gameWindow();
  const interval = pollInterval();

  const { data, isLoading, isFetching, refetch, error } = useQuery({
    queryKey: ["gameday", leagueId ?? "all"],
    queryFn: () => fetchGameDay({ data: { ...(leagueId ? { leagueId } : {}), refresh: true } }),
    refetchOnWindowFocus: true,
    refetchInterval: interval || false,
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    if (leagueId) setLeagueFilter("all");
  }, [leagueId]);

  const events = useMemo(() => {
    const rows = data?.events ?? [];
    return rows
      .filter((e) => (leagueFilter === "all" ? true : e.leagueId === leagueFilter))
      .filter((e) => (sides === "all" ? true : e.side === "mine"));
  }, [data, leagueFilter, sides]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-48 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border border-border p-6">
        <p className="text-sm text-muted-foreground">
          {error instanceof Error ? error.message : "Live scoring is unavailable right now."}
        </p>
        <Button className="mt-3" size="sm" onClick={() => refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={window.live ? "default" : "outline"} className="text-[10px] uppercase">
            {window.live ? `Live · ${window.label}` : window.label}
          </Badge>
          <p className="text-xs text-muted-foreground">
            Week {data.week} · stats updated {timeAgo(data.updatedAt)}
            {window.live ? " · refreshing every 45s" : ""}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          Refresh
        </Button>
      </div>

      {!data.matchups.length && (
        <p className="text-sm text-muted-foreground">
          No matchup to track yet. Import a league and make sure your own team is marked as yours.
        </p>
      )}

      <div className="grid gap-4">
        {data.matchups.map((m) => (
          <MatchupCard key={m.leagueId} m={m} />
        ))}
      </div>

      <section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-xl font-bold uppercase">Scoring log</h2>
          <div className="flex flex-wrap gap-2">
            {!leagueId && data.matchups.length > 1 && (
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant={leagueFilter === "all" ? "default" : "outline"}
                  onClick={() => setLeagueFilter("all")}
                >
                  All leagues
                </Button>
                {data.matchups.map((m) => (
                  <Button
                    key={m.leagueId}
                    size="sm"
                    variant={leagueFilter === m.leagueId ? "default" : "outline"}
                    onClick={() => setLeagueFilter(m.leagueId)}
                  >
                    {m.leagueName}
                  </Button>
                ))}
              </div>
            )}
            <div className="flex gap-1">
              <Button size="sm" variant={sides === "all" ? "default" : "outline"} onClick={() => setSides("all")}>
                Both sides
              </Button>
              <Button size="sm" variant={sides === "mine" ? "default" : "outline"} onClick={() => setSides("mine")}>
                Mine only
              </Button>
            </div>
          </div>
        </div>

        <div className="mt-3 divide-y divide-border rounded-xl border border-border">
          {!events.length && (
            <p className="p-4 text-sm text-muted-foreground">
              Nothing has scored yet. Plays show up here as soon as the games start.
            </p>
          )}
          {events.map((e) => (
            <div key={e.id} className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {e.playerName}{" "}
                  <span className="text-xs text-muted-foreground">
                    {e.position}
                    {e.nflTeam ? ` · ${e.nflTeam}` : ""}
                  </span>
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {e.description} · {e.leagueName} · {e.side === "mine" ? "your player" : "opponent"}
                </p>
              </div>
              <div className="text-right">
                <p
                  className={`font-display text-base font-bold tabular-nums ${
                    e.points >= 0 ? "text-primary" : "text-destructive"
                  }`}
                >
                  {e.points >= 0 ? "+" : ""}
                  {e.points.toFixed(1)}
                </p>
                <p className="text-[11px] text-muted-foreground tabular-nums">
                  {e.myScore.toFixed(1)}–{e.oppScore.toFixed(1)}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
