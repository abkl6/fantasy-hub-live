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
    <article className="rounded-xl border border-border bg-card p-5">
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

function pct(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function OddsRow({ m }: { m: LiveMatchup }) {
  const win = m.winProbability === null ? null : Math.round(m.winProbability * 100);
  const history = m.oddsHistory;
  const previous = history.length > 1 ? history[history.length - 2] : null;
  const swing = previous && m.titleOdds !== null ? m.titleOdds - previous.titleOdds : null;

  return (
    <a href={`#matchup-${m.leagueId}`} className="block rounded-lg border border-border p-3 transition-colors hover:bg-secondary/40">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{m.leagueName}</p>
          <p className="truncate text-xs text-muted-foreground">
            {m.isBestBall ? `vs league leader ${m.oppTeam ?? "—"}` : `vs ${m.oppTeam ?? "opponent TBD"}`} · week {m.week}
          </p>
        </div>
        <div className="flex items-center gap-4 text-right text-xs">
          <div>
            <p className="text-muted-foreground">Playoffs</p>
            <p className="font-display font-bold tabular-nums">{m.playoffOdds === null ? "—" : pct(m.playoffOdds)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Title</p>
            <p className="font-display font-bold tabular-nums">{m.titleOdds === null ? "—" : pct(m.titleOdds)}</p>
          </div>
          {swing !== null && (
            <Badge variant={swing >= 0 ? "default" : "destructive"}>
              {swing >= 0 ? "+" : ""}{(swing * 100).toFixed(1)}% wk
            </Badge>
          )}
        </div>
      </div>

      <div className="mt-2">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium">{win === null ? "Win chance unavailable" : `${win}% chance to win this week`}</span>
          <span className="text-muted-foreground tabular-nums">
            {m.myProjected.toFixed(1)} – {m.oppProjected.toFixed(1)} projected
          </span>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-secondary">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${win ?? 0}%` }} />
        </div>
      </div>

      {history.length > 1 && (
        <div className="mt-3">
          <div className="flex items-end gap-1">
            {history.map((point) => (
              <div key={point.week} className="flex-1">
                <div className="flex h-12 items-end gap-[2px]">
                  <div className="w-1/2 rounded-t bg-primary" style={{ height: `${Math.max(2, point.titleOdds * 100)}%` }} />
                  <div className="w-1/2 rounded-t bg-muted-foreground/40" style={{ height: `${Math.max(2, point.playoffOdds * 100)}%` }} />
                </div>
                <p className="mt-1 text-center text-[10px] text-muted-foreground">{point.week}</p>
              </div>
            ))}
          </div>
          <p className="mt-1 text-[10px] uppercase text-muted-foreground">Solid = title · faded = playoffs, by week</p>
        </div>
      )}
    </a>
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
    return showAllEvents ? rows : rows.slice(0, 5);
  }, [data, showAllEvents]);

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

      <section className="overflow-hidden rounded-xl border border-primary/30 bg-card">
        <div className="flex items-center justify-between border-b border-border bg-primary/5 px-4 py-3">
          <div className="flex items-center gap-2">
            <Radio className="size-4 text-primary" />
            <h2 className="font-display text-lg font-bold uppercase">Live updates</h2>
          </div>
          <Badge variant="outline">{data.events.length} plays</Badge>
        </div>
        {!events.length && <p className="p-4 text-sm text-muted-foreground">No scoring updates yet. New plays will appear here first.</p>}
        <div className="divide-y divide-border">
          {events.map((e) => (
            <div key={`${e.leagueId}-${e.id}`} className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{e.playerName} <span className="text-xs text-muted-foreground">· {e.leagueName}</span></p>
                <p className="truncate text-xs text-muted-foreground">{e.description} · {e.side === "mine" ? "your player" : "opponent"}</p>
              </div>
              <p className={`font-display text-lg font-bold tabular-nums ${e.points >= 0 ? "text-primary" : "text-destructive"}`}>{e.points >= 0 ? "+" : ""}{e.points.toFixed(1)}</p>
            </div>
          ))}
        </div>
        {data.events.length > 5 && <Button className="w-full rounded-none border-t" variant="ghost" onClick={() => setShowAllEvents((value) => !value)}>
          {showAllEvents ? "Show latest 5" : `Show all ${data.events.length} updates`}
        </Button>}
      </section>

      {!!data.matchups.length && (
        <section className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="size-4 text-primary" />
              <h2 className="font-display text-lg font-bold uppercase">Weekly odds</h2>
            </div>
            <Badge variant="outline">{data.matchups.length} {data.matchups.length === 1 ? "league" : "leagues"}</Badge>
          </div>
          <div className="space-y-2 p-3">
            {data.matchups.map((m) => (
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
