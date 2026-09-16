
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, ChevronUp, ClipboardCheck, Clock, Loader2, Monitor, RefreshCw, Share2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { CacheStatus } from "@/components/CacheStatus";
import { Sparkline } from "@/components/Sparkline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCachedQuery } from "@/hooks/useCachedQuery";
import { getGameDayFn } from "@/lib/fantasy.functions";
import { countdownLabel, gameWindow, nextKickoff, pollInterval } from "@/lib/fantasy/gamewindow";
import type { LiveMatchup, LivePlayerRow } from "@/lib/fantasy/live-types";
import { leagueColor, leagueInitials } from "@/lib/league-colors";
import { shareMatchupCard } from "@/lib/share-card";

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

function prefersReducedMotion() {
  if (typeof window === "undefined") return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Tween a score up to its new value over 600ms; also reports when it changed. */
export function useCountUp(value: number, duration = 600) {
  const [display, setDisplay] = useState(value);
  const [changed, setChanged] = useState(false);
  const from = useRef(value);

  useEffect(() => {
    if (value === from.current) return;
    setChanged(true);
    const start = from.current;
    const startedAt = performance.now();
    let frame = 0;

    if (prefersReducedMotion()) {
      setDisplay(value);
      from.current = value;
    } else {
      const step = (now: number) => {
        const t = Math.min(1, (now - startedAt) / duration);
        const eased = 1 - (1 - t) * (1 - t);
        setDisplay(start + (value - start) * eased);
        if (t < 1) frame = requestAnimationFrame(step);
        else from.current = value;
      };
      frame = requestAnimationFrame(step);
    }

    const clear = setTimeout(() => setChanged(false), 950);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(clear);
    };
  }, [value, duration]);

  return { display, changed };
}

function PlayerLine({ p, dim }: { p: LivePlayerRow; dim?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 py-1.5 text-sm ${dim ? "opacity-60" : ""}`}>
      <div className="flex min-w-0 items-center gap-2">
        <span className="w-10 shrink-0 text-[11px] font-medium text-muted-foreground">{p.slot}</span>
        <div className="min-w-0">
          <p className="truncate font-medium">{p.name}</p>
          <p className="text-[11px] text-muted-foreground">
            {p.position}
            {p.nflTeam ? ` · ${p.nflTeam}` : ""}
            {p.opponent ? ` vs ${p.opponent}` : ""}
            {p.opponent && p.matchup && p.matchup !== "neutral"
              ? ` (${p.matchup === "easy" ? "easy" : "tough"})`
              : ""}{" "}
            ·{" "}
            {p.gameState === "in" && p.gameClock ? `In progress · ${p.gameClock}` : stateLabel[p.gameState]}
          </p>

        </div>
      </div>
      <div className="text-right">
        <p className="stat-num text-base font-bold">{p.livePoints.toFixed(1)}</p>
        <p className="text-[11px] tabular-nums text-muted-foreground">proj {p.projectedFinal.toFixed(1)}</p>
      </div>
    </div>
  );
}

export function ordinal(n: number) {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/** Total-points leagues have no opponent: the score sits beside my standing. */
function PointsRaceScore({ m, display }: { m: LiveMatchup; display: number }) {
  const race = m.pointsRace;
  return (
    <div className="mt-4 grid grid-cols-[1fr_1fr] items-center gap-4">
      <div className="min-w-0">
        <p className="truncate text-[12px] text-muted-foreground">{m.myTeam}</p>
        <p className="stat-num text-5xl font-bold leading-none">{display.toFixed(1)}</p>
        <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">proj {m.myProjected.toFixed(1)}</p>
      </div>
      <div className="min-w-0 space-y-1 text-right text-[12px] text-muted-foreground">
        {race ? (
          <>
            <p>
              <span className="stat-num text-base font-bold text-foreground">
                {ordinal(race.rankThisWeek)}
              </span>{" "}
              this week
            </p>
            <p>
              {ordinal(race.seasonRank)} of {race.teamCount} on the season ·{" "}
              <span className="tabular-nums">{race.seasonTotal.toFixed(1)}</span>
            </p>
            <p className="tabular-nums">
              {race.gapAbove ? `${race.gapAbove.points.toFixed(1)} behind ${race.gapAbove.name}` : "Leading the league"}
            </p>
            <p className="tabular-nums">
              {race.gapBelow ? `${race.gapBelow.points.toFixed(1)} ahead of ${race.gapBelow.name}` : "Last place"}
            </p>
            <p className="tabular-nums">
              {race.playersLeft} left to play · proj {race.projectedRemaining.toFixed(1)} more
            </p>
          </>
        ) : (
          <p>Standing unavailable.</p>
        )}
      </div>
    </div>
  );
}

function MatchupCard({ m }: { m: LiveMatchup }) {
  const [expanded, setExpanded] = useState(false);
  const [sharing, setSharing] = useState(false);
  const odds = m.winProbability === null ? null : Math.round(m.winProbability * 100);
  const mine = useCountUp(m.myScore);
  const theirs = useCountUp(m.oppScore);
  const color = leagueColor(m.color, m.leagueId);
  const live = m.gameState === "in";
  const final = m.gameState === "post";
  const history = m.oddsHistory ?? [];
  const pointsOnly = m.contestFormat === "points";

  return (
    <article
      id={`matchup-${m.leagueId}`}
      className={`scroll-mt-28 overflow-hidden rounded-xl bg-card p-5 transition-opacity ${
        final ? "opacity-70" : ""
      } ${live ? "shadow-lg shadow-black/25 ring-1 ring-primary/20" : ""} ${
        mine.changed || theirs.changed ? "row-flash" : ""
      }`}
      style={{ borderLeft: `3px solid ${color}` }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {live && <span className="live-dot size-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />}
          <p className="truncate text-sm font-medium" style={{ color }}>
            {m.leagueName}
          </p>
          <span className="shrink-0 text-xs text-muted-foreground">Week {m.week}</span>
          {m.weeklyHigh?.leading && (
            <Badge variant="secondary" className="shrink-0 text-[10px]">
              Weekly high
            </Badge>
          )}
        </div>
        <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          {m.isBestBall ? `Best ball · ${m.leagueRank ?? "—"} of ${m.teamCount}` : m.scoringLabel}
          <Button
            size="icon"
            variant="ghost"
            className="size-7 text-muted-foreground"
            aria-label={`Share ${m.leagueName} matchup`}
            disabled={sharing}
            onClick={async () => {
              setSharing(true);
              try {
                const result = await shareMatchupCard({
                  leagueName: m.leagueName,
                  week: m.week,
                  myTeam: m.myTeam,
                  oppTeam: m.oppTeam ?? "Opponent",
                  myScore: m.myScore,
                  oppScore: m.oppScore,
                  winProbability: m.winProbability,
                  color,
                });
                if (result === "downloaded") toast.success("Image saved to your downloads.");
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Could not create the image.");
              } finally {
                setSharing(false);
              }
            }}
          >
            {sharing ? <Loader2 className="size-4 animate-spin" /> : <Share2 className="size-4" />}
          </Button>
        </span>
      </div>

      {pointsOnly ? (
        <PointsRaceScore m={m} display={mine.display} />
      ) : (
        <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-4">
          <div className="min-w-0">
            <p className="truncate text-[12px] text-muted-foreground">{m.myTeam}</p>
            <p className="stat-num text-5xl font-bold leading-none">{mine.display.toFixed(1)}</p>
            <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">proj {m.myProjected.toFixed(1)}</p>
          </div>

          <div className="w-16 sm:w-24">
            <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
              <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${odds ?? 0}%` }} />
            </div>
            <p className="mt-1 text-center text-[11px] tabular-nums text-muted-foreground">
              {odds === null ? "—" : `${odds}%`}
            </p>
          </div>

          <div className="min-w-0 text-right">
            <p className="truncate text-[12px] text-muted-foreground">
              {m.isBestBall ? `${m.oppTeam ?? "—"} · leader` : m.oppTeam ?? "Opponent unavailable"}
            </p>
            <p className="stat-num text-5xl font-bold leading-none">{theirs.display.toFixed(1)}</p>
            <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">proj {m.oppProjected.toFixed(1)}</p>
          </div>
        </div>
      )}

      {m.needLine && !pointsOnly && (
        <p className="mt-3 text-center text-[12px] text-muted-foreground">{m.needLine}</p>
      )}

      {m.contestFormat === "hybrid" && m.pointsRace && (
        <p className="mt-2 text-center text-[12px] text-muted-foreground">
          Points race: {ordinal(m.pointsRace.seasonRank)} of {m.pointsRace.teamCount} ·{" "}
          {Math.round(m.pointsRace.firstOdds * 100)}% to win it
          {m.pointsRace.topN
            ? ` · ${Math.round((m.pointsRace.topNOdds ?? 0) * 100)}% top ${m.pointsRace.topN}`
            : ""}
        </p>
      )}

      {m.weeklyHigh && m.gameState !== "post" && (
        <p className="mt-2 text-center text-[12px] text-muted-foreground">
          Weekly high{m.weeklyHigh.label ? ` (${m.weeklyHigh.label})` : ""}:{" "}
          {Math.round(m.weeklyHigh.probability * 100)}% ·{" "}
          {m.weeklyHigh.leading
            ? `you lead ${m.weeklyHigh.leaderName} by ${Math.abs(m.weeklyHigh.gap).toFixed(1)}`
            : `you're ${m.weeklyHigh.gap.toFixed(1)} behind ${m.weeklyHigh.leaderName}`}
        </p>
      )}

      <Button className="mt-4 w-full" size="sm" variant="ghost" onClick={() => setExpanded((value) => !value)}>
        {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        {expanded ? "Hide details" : "Details"}
      </Button>

      {expanded && (
        <div className="mt-3 space-y-6 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>
              {m.yetToPlay} yours
              {pointsOnly ? " left to play" : ` · ${m.oppYetToPlay} ${m.isBestBall ? "leader" : "opponent"} left to play`}
            </span>
            <span className="flex items-center gap-3">
              {pointsOnly && m.pointsRace ? (
                <>
                  <span>1st {(m.pointsRace.firstOdds * 100).toFixed(1)}%</span>
                  <span>Top 3 {(m.pointsRace.topThreeOdds * 100).toFixed(1)}%</span>
                  {m.pointsRace.topN !== null && (
                    <span>
                      Top {m.pointsRace.topN} {((m.pointsRace.topNOdds ?? 0) * 100).toFixed(1)}%
                    </span>
                  )}
                </>
              ) : (
                <>
                  {m.titleOdds !== null && <span>Title {(m.titleOdds * 100).toFixed(1)}%</span>}
                  {m.playoffOdds !== null && <span>Playoffs {(m.playoffOdds * 100).toFixed(1)}%</span>}
                </>
              )}
              {history.length > 1 && (
                <Sparkline
                  values={history.map((h) => h.titleOdds)}
                  color={color}
                  label="Title odds by week"
                  width={80}
                  height={20}
                />
              )}
            </span>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <p className="eyebrow mb-1 text-muted-foreground">Your starters</p>
              <div className="divide-y divide-border/60">
                {m.starters.map((p) => (
                  <PlayerLine key={`${p.name}-${p.slot}`} p={p} />
                ))}
              </div>
            </div>
            {!pointsOnly && (
              <div>
                <p className="eyebrow mb-1 text-muted-foreground">{m.isBestBall ? "Leader lineup" : "Opponent starters"}</p>
                <div className="divide-y divide-border/60">
                  {m.oppStarters.length ? (
                    m.oppStarters.map((p) => <PlayerLine key={`o-${p.name}-${p.slot}`} p={p} />)
                  ) : (
                    <p className="py-2 text-sm text-muted-foreground">No opponent lineup yet.</p>
                  )}
                </div>
              </div>
            )}
            {(m.bench.length > 0 || m.oppBench.length > 0) && (
              <>
                <div>
                  <p className="eyebrow mb-1 text-muted-foreground">Your bench</p>
                  <div className="divide-y divide-border/60">
                    {m.bench.map((p) => (
                      <PlayerLine key={`b-${p.name}-${p.slot}`} p={p} dim />
                    ))}
                  </div>
                </div>
                {!pointsOnly && (
                  <div>
                    <p className="eyebrow mb-1 text-muted-foreground">{m.isBestBall ? "Leader bench" : "Opponent bench"}</p>
                    <div className="divide-y divide-border/60">
                      {m.oppBench.map((p) => (
                        <PlayerLine key={`ob-${p.name}-${p.slot}`} p={p} dim />
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

function ScoreboardStrip({ matchups }: { matchups: LiveMatchup[] }) {
  if (!matchups.length) return null;
  return (
    <div className="sticky top-14 z-20 -mx-6 bg-background/90 px-6 py-2 backdrop-blur">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {matchups.map((m) => {
          const color = leagueColor(m.color, m.leagueId);
          const win = m.winProbability === null ? 0 : Math.round(m.winProbability * 100);
          return (
            <a
              key={`tile-${m.leagueId}`}
              href={`#matchup-${m.leagueId}`}
              className={`min-w-[112px] shrink-0 rounded-lg bg-card p-2 transition-opacity hover:opacity-90 ${
                m.gameState === "post" ? "opacity-70" : ""
              }`}
              style={{ borderLeft: `3px solid ${color}` }}
            >
              <div className="flex items-center gap-1.5">
                {m.gameState === "in" && <span className="live-dot size-1.5 rounded-full bg-primary" aria-hidden="true" />}
                <span className="text-[11px] font-semibold" style={{ color }}>
                  {leagueInitials(m.leagueName)}
                </span>
              </div>
              <p className="stat-num mt-0.5 text-sm font-bold">
                {m.myScore.toFixed(1)} <span className="text-muted-foreground">–</span> {m.oppScore.toFixed(1)}
              </p>
              <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-secondary">
                <div className="h-full rounded-full" style={{ width: `${win}%`, backgroundColor: color }} />
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}

/** A league needs attention when a starter is not playing, or a bench player clearly beats one. */
function hasLineupAlert(m: LiveMatchup) {
  const pending = m.starters.filter((p) => p.gameState === "pre");
  if (pending.some((p) => p.projectedFinal <= 0)) return true;
  const bestBench = Math.max(0, ...m.bench.filter((p) => p.gameState === "pre").map((p) => p.projectedFinal));
  return pending.some((p) => bestBench - p.projectedFinal >= 2);
}

function ReadinessBar({ matchups, kickoffAt }: { matchups: LiveMatchup[]; kickoffAt?: string | null | undefined }) {
  const fallback = useMemo(() => nextKickoff(), []);
  const alerts = matchups.filter((m) => !m.isBestBall && hasLineupAlert(m)).length;
  const at = kickoffAt ? new Date(kickoffAt) : fallback.at;
  const label = kickoffAt
    ? at.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })
    : fallback.label;

  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-card px-4 py-3">
      <div className="flex items-center gap-2">
        <Clock className="size-4 text-muted-foreground" />
        <div>
          <p className="text-sm font-semibold tabular-nums">{countdownLabel(at)} to next kickoff</p>
          <p className="text-[11px] text-muted-foreground">{label}</p>
        </div>
      </div>

      <Badge variant={alerts ? "destructive" : "secondary"} className="text-[11px]">
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

  const { data, isLoading, isFetching, refetch, error, updating, stale, lastUpdated } = useCachedQuery({
    cacheKey: `gameday:${leagueId ?? "all"}`,
    queryKey: ["gameday", leagueId ?? "all"],
    queryFn: () => fetchGameDay({ data: { ...(leagueId ? { leagueId } : {}), refresh: true } }),
    refetchOnWindowFocus: true,
    refetchInterval: interval || false,
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
      <div className="rounded-xl bg-card p-6">
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
    <div className="space-y-5">
      <CacheStatus updating={updating} stale={stale} lastUpdated={lastUpdated} />
      <ScoreboardStrip matchups={sortedMatchups} />

      <section className="overflow-hidden rounded-lg bg-card">
        <div className="flex items-center gap-2 px-3 py-1.5">
          <span
            className={`size-2 shrink-0 rounded-full ${window.live ? "live-dot bg-primary" : "bg-muted-foreground/50"}`}
            aria-hidden="true"
          />
          <span className="shrink-0 text-[11px] font-medium text-muted-foreground">Live</span>
          <div className="min-w-0 flex-1 divide-y divide-border/50">
            {!events.length && (
              <p className="truncate py-1 text-xs text-muted-foreground">No scoring updates yet — new plays appear here first.</p>
            )}
            {events.map((e) => (
              <p
                key={`${e.leagueId}-${e.id}`}
                className="ticker-in flex items-baseline gap-1.5 truncate py-1 text-xs leading-tight"
              >
                <span
                  className={`stat-num shrink-0 font-bold ${
                    e.side === "opponent" ? "text-destructive" : e.points >= 0 ? "text-primary" : "text-destructive"
                  }`}
                >
                  {e.points >= 0 ? "+" : ""}
                  {e.points.toFixed(1)}
                </span>
                <span className="shrink-0 font-medium">{e.playerName}</span>
                <span className="truncate text-muted-foreground">
                  {e.description} · {e.leagueName}
                </span>
              </p>
            ))}
          </div>
          {data.events.length > 3 && (
            <button
              className="shrink-0 text-[11px] font-medium text-muted-foreground hover:text-foreground"
              onClick={() => setShowAllEvents((value) => !value)}
            >
              {showAllEvents ? "Less" : `All ${data.events.length}`}
            </button>
          )}
        </div>
      </section>

      <ReadinessBar matchups={sortedMatchups} kickoffAt={data.nextKickoff} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Week {data.week} · stats updated {timeAgo(data.updatedAt)}
          {window.live ? " · refreshing every 45s" : ""}
        </p>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="secondary" asChild>
            <Link to="/lineup-check">
              <ClipboardCheck className="size-4" aria-hidden="true" />
              Lineup check
            </Link>
          </Button>
          <Button size="sm" variant="ghost" asChild>
            <Link to="/tv">
              <Monitor className="size-4" aria-hidden="true" />
              On TV
            </Link>
          </Button>
          <Button size="sm" variant="ghost" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Refresh
          </Button>
        </div>
      </div>

      {!data.matchups.length && (
        <p className="text-sm text-muted-foreground">
          No matchup to track yet. Import a league and make sure your own team is marked as yours.
        </p>
      )}

      <div className="grid gap-4">
        {sortedMatchups.map((m) => (
          <MatchupCard key={m.leagueId} m={m} />
        ))}
      </div>
    </div>
  );
}
