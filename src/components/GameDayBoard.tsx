import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, ChevronUp, Loader2, RefreshCw, Radio, TrendingUp } from "lucide-react";
import { useMemo, useState } from "react";

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
            {p.gameState === "in" && p.gameClock ? `In progress · ${p.gameClock}` : stateLabel[p.gameState]}
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
  const [expanded, setExpanded] = useState(false);
  const odds = m.winProbability === null ? null : Math.round(m.winProbability * 100);
  return (
    <article id={`matchup-${m.leagueId}`} className="scroll-mt-24 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow text-primary">
            {m.leagueName} · Week {m.week}
          </p>
          <p className="text-xs text-muted-foreground">
            {m.isBestBall ? `Best ball · ${m.leagueRank ?? "—"} of ${m.teamCount}` : m.scoringLabel}
          </p>
        </div>
        <Badge variant="secondary" className="text-[10px] uppercase">
          {m.gameState === "in" ? "Live" : m.gameState === "post" ? "Final" : "Upcoming"}
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
          <p className="truncate text-sm font-medium">
            {m.isBestBall ? `${m.oppTeam ?? "—"} · leader` : m.oppTeam ?? "Opponent unavailable"}
          </p>
          <p className="font-display text-3xl font-bold tabular-nums">{m.oppScore.toFixed(1)}</p>
          <p className="text-[11px] text-muted-foreground tabular-nums">proj {m.oppProjected.toFixed(1)}</p>
        </div>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium">{odds === null ? "Win chance unavailable" : `${odds}% chance to win`}</span>
          <span className="text-muted-foreground">
            {m.yetToPlay} yours · {m.oppYetToPlay} {m.isBestBall ? "leader" : "opponent"} left
          </span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-secondary">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${odds ?? 0}%` }} />
        </div>
        {(m.titleOdds !== null || m.playoffOdds !== null) && (
          <p className="mt-2 text-xs text-muted-foreground">
            {m.titleOdds !== null && <>Season title odds: {(m.titleOdds * 100).toFixed(1)}%</>}
            {m.titleOdds !== null && m.playoffOdds !== null && " · "}
            {m.playoffOdds !== null && <>Playoff odds: {(m.playoffOdds * 100).toFixed(1)}%</>}
          </p>
        )}
      </div>

      <Button className="mt-4 w-full" size="sm" variant="ghost" onClick={() => setExpanded((value) => !value)}>
        {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        {expanded ? "Hide roster breakdown" : "View roster breakdown"}
      </Button>

      {expanded && <div className="mt-3 grid gap-6 border-t border-border pt-4 md:grid-cols-2">
        <div>
          <p className="eyebrow mb-1 text-muted-foreground">Your starters</p>
          <div className="divide-y divide-border">
            {m.starters.map((p) => (
              <PlayerLine key={`${p.name}-${p.slot}`} p={p} />
            ))}
          </div>
        </div>
        <div>
            <p className="eyebrow mb-1 text-muted-foreground">{m.isBestBall ? "Leader lineup" : "Opponent starters"}</p>
          <div className="divide-y divide-border">
            {m.oppStarters.length ? (
              m.oppStarters.map((p) => <PlayerLine key={`o-${p.name}-${p.slot}`} p={p} />)
            ) : (
              <p className="py-2 text-sm text-muted-foreground">No opponent lineup yet.</p>
            )}
          </div>
        </div>
        {(m.bench.length > 0 || m.oppBench.length > 0) && <>
          <div>
            <p className="eyebrow mb-1 text-muted-foreground">Your bench</p>
            <div className="divide-y divide-border">{m.bench.map((p) => <PlayerLine key={`b-${p.name}-${p.slot}`} p={p} dim />)}</div>
          </div>
          <div>
            <p className="eyebrow mb-1 text-muted-foreground">{m.isBestBall ? "Leader bench" : "Opponent bench"}</p>
            <div className="divide-y divide-border">{m.oppBench.map((p) => <PlayerLine key={`ob-${p.name}-${p.slot}`} p={p} dim />)}</div>
          </div>
        </>}
      </div>}
    </article>
  );
}

/** A league needs attention when a starter is not playing, or a bench player clearly beats one. */
function hasLineupAlert(m: LiveMatchup) {
  const pending = m.starters.filter((p) => p.gameState === "pre");
  if (pending.some((p) => p.projectedFinal <= 0)) return true;
  const bestBench = Math.max(0, ...m.bench.filter((p) => p.gameState === "pre").map((p) => p.projectedFinal));
  return pending.some((p) => bestBench - p.projectedFinal >= 2);
}

function ReadinessBar({ matchups }: { matchups: LiveMatchup[] }) {
  const kickoff = useMemo(() => nextKickoff(), []);
  const alerts = matchups.filter((m) => !m.isBestBall && hasLineupAlert(m)).length;

  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex items-center gap-2">
        <Clock className="size-4 text-primary" />
        <div>
          <p className="text-sm font-semibold tabular-nums">{countdownLabel(kickoff.at)} to first kickoff</p>
          <p className="text-[11px] text-muted-foreground">{kickoff.label}</p>
        </div>
      </div>
      <Badge variant={alerts ? "destructive" : "secondary"} className="text-[10px] uppercase">
        {alerts
          ? `${alerts} ${alerts === 1 ? "league needs" : "leagues need"} a lineup fix`
          : "All lineups look set"}
      </Badge>
    </section>
  );
}

export function GameDayBoard({ leagueId }: { leagueId?: string }) {
  const fetchGameDay = useServerFn(getGameDayFn);
  const [showAllEvents, setShowAllEvents] = useState(false);
  const window = gameWindow();
  const interval = pollInterval();

  const { data, isLoading, isFetching, refetch, error } = useQuery({
    queryKey: ["gameday", leagueId ?? "all"],
    queryFn: () => fetchGameDay({ data: { ...(leagueId ? { leagueId } : {}), refresh: true } }),
    refetchOnWindowFocus: true,
    refetchInterval: interval || false,
    refetchIntervalInBackground: false,
  });

  const events = useMemo(() => {
    const rows = data?.events ?? [];
    return showAllEvents ? rows : rows.slice(0, 3);
  }, [data, showAllEvents]);

  const sortedMatchups = useMemo(() => {
    const rows = [...(data?.matchups ?? [])];
    return rows.sort((a, b) => (b.winProbability ?? -1) - (a.winProbability ?? -1));
  }, [data]);

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

      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex items-center gap-2 px-3 py-1.5">
          <Radio className={`size-3.5 shrink-0 ${window.live ? "animate-pulse text-primary" : "text-muted-foreground"}`} />
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Live</span>
          <div className="min-w-0 flex-1 divide-y divide-border/60">
            {!events.length && (
              <p className="truncate py-1 text-xs text-muted-foreground">No scoring updates yet — new plays appear here first.</p>
            )}
            {events.map((e) => (
              <p key={`${e.leagueId}-${e.id}`} className="flex items-baseline gap-1.5 truncate py-1 text-xs leading-tight">
                <span className={`shrink-0 font-display font-bold tabular-nums ${e.side === "opponent" ? "text-destructive" : e.points >= 0 ? "text-primary" : "text-destructive"}`}>
                  {e.points >= 0 ? "+" : ""}{e.points.toFixed(1)}
                </span>
                <span className="shrink-0 font-medium">{e.playerName}</span>
                <span className="truncate text-muted-foreground">{e.description} · {e.leagueName}</span>
              </p>
            ))}
          </div>
          {data.events.length > 3 && (
            <button
              className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground"
              onClick={() => setShowAllEvents((value) => !value)}
            >
              {showAllEvents ? "Less" : `All ${data.events.length}`}
            </button>
          )}
        </div>
      </section>

      {!!sortedMatchups.length && (
        <section className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="size-4 text-primary" />
              <h2 className="font-display text-lg font-bold uppercase">Weekly odds</h2>
            </div>
            <Badge variant="outline">{sortedMatchups.length} {sortedMatchups.length === 1 ? "league" : "leagues"}</Badge>
          </div>
          <div className="space-y-2 p-3">
            {sortedMatchups.map((m) => (
              <OddsRow key={`odds-${m.leagueId}`} m={m} />
            ))}
          </div>
        </section>
      )}

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

    </div>
  );
}
